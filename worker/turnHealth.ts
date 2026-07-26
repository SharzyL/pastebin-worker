import { connect } from "cloudflare:sockets"

const STUN_HEADER_BYTES = 20
const STUN_MAGIC_COOKIE = 0x2112a442
const STUN_ALLOCATE_REQUEST = 0x0003
const STUN_ALLOCATE_SUCCESS = 0x0103
const STUN_ALLOCATE_ERROR = 0x0113
const STUN_ATTR_USERNAME = 0x0006
const STUN_ATTR_MESSAGE_INTEGRITY = 0x0008
const STUN_ATTR_ERROR_CODE = 0x0009
const STUN_ATTR_REALM = 0x0014
const STUN_ATTR_NONCE = 0x0015
const STUN_ATTR_REQUESTED_TRANSPORT = 0x0019
const TURN_REQUESTED_RELAY_PROTOCOL_UDP = 17
const DEFAULT_TURN_HEALTH_TIMEOUT_MS = 5_000

interface TurnHealthTarget {
  hostname: string
  port: number
  secure: boolean
  label: string
}

interface StunMessage {
  type: number
  transactionId: Uint8Array
  attributes: Map<number, Uint8Array>
}

type TurnSocketConnect = (address: SocketAddress, options: SocketOptions) => Socket

export interface TurnHealthCheckOptions {
  connect?: TurnSocketConnect
  timeoutMs?: number
}

export class TurnHealthCheckError extends Error {}

function concatBytes(...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function stunAttribute(type: number, value: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil(value.byteLength / 4) * 4
  const bytes = new Uint8Array(4 + paddedLength)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, type)
  view.setUint16(2, value.byteLength)
  bytes.set(value, 4)
  return bytes
}

const REQUESTED_TRANSPORT_ATTRIBUTE = stunAttribute(
  STUN_ATTR_REQUESTED_TRANSPORT,
  new Uint8Array([TURN_REQUESTED_RELAY_PROTOCOL_UDP, 0, 0, 0]),
)

function stunHeader(type: number, bodyLength: number, transactionId: Uint8Array): Uint8Array {
  if (transactionId.byteLength !== 12) throw new TurnHealthCheckError("invalid STUN transaction ID")
  const header = new Uint8Array(STUN_HEADER_BYTES)
  const view = new DataView(header.buffer)
  view.setUint16(0, type)
  view.setUint16(2, bodyLength)
  view.setUint32(4, STUN_MAGIC_COOKIE)
  header.set(transactionId, 8)
  return header
}

function transactionId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

export function buildInitialAllocateRequest(id = transactionId()): Uint8Array {
  return concatBytes(
    stunHeader(STUN_ALLOCATE_REQUEST, REQUESTED_TRANSPORT_ATTRIBUTE.byteLength, id),
    REQUESTED_TRANSPORT_ATTRIBUTE,
  )
}

async function hmacSha1(
  keyBytes: Uint8Array<ArrayBufferLike>,
  value: Uint8Array<ArrayBufferLike>,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new Uint8Array(value)))
}

export async function deriveTurnLongTermKey(
  username: string,
  realm: string,
  credential: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const value = new TextEncoder().encode(`${username}:${realm}:${credential}`)
  return new Uint8Array(await crypto.subtle.digest("MD5", value))
}

export async function buildAuthenticatedAllocateRequest(
  username: string,
  credential: string,
  realm: string,
  nonce: string,
  id = transactionId(),
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const attributes = concatBytes(
    REQUESTED_TRANSPORT_ATTRIBUTE,
    stunAttribute(STUN_ATTR_USERNAME, encoder.encode(username)),
    stunAttribute(STUN_ATTR_REALM, encoder.encode(realm)),
    stunAttribute(STUN_ATTR_NONCE, encoder.encode(nonce)),
  )
  const messageLengthThroughIntegrity = attributes.byteLength + 4 + 20
  const integrityInput = concatBytes(stunHeader(STUN_ALLOCATE_REQUEST, messageLengthThroughIntegrity, id), attributes)
  const integrityKey = await deriveTurnLongTermKey(username, realm, credential)
  const integrity = await hmacSha1(integrityKey, integrityInput)
  return concatBytes(integrityInput, stunAttribute(STUN_ATTR_MESSAGE_INTEGRITY, integrity))
}

export function parseStunMessage(raw: Uint8Array): StunMessage {
  if (raw.byteLength < STUN_HEADER_BYTES) throw new TurnHealthCheckError("truncated STUN response")
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const type = view.getUint16(0)
  const bodyLength = view.getUint16(2)
  if ((type & 0xc000) !== 0 || view.getUint32(4) !== STUN_MAGIC_COOKIE) {
    throw new TurnHealthCheckError("invalid STUN response header")
  }
  if (bodyLength % 4 !== 0 || STUN_HEADER_BYTES + bodyLength !== raw.byteLength) {
    throw new TurnHealthCheckError("invalid STUN response length")
  }

  const attributes = new Map<number, Uint8Array>()
  let offset = STUN_HEADER_BYTES
  while (offset < raw.byteLength) {
    if (offset + 4 > raw.byteLength) throw new TurnHealthCheckError("truncated STUN attribute")
    const attributeLength = view.getUint16(offset + 2)
    const valueOffset = offset + 4
    const paddedEnd = valueOffset + Math.ceil(attributeLength / 4) * 4
    if (paddedEnd > raw.byteLength) throw new TurnHealthCheckError("invalid STUN attribute length")
    attributes.set(view.getUint16(offset), raw.slice(valueOffset, valueOffset + attributeLength))
    offset = paddedEnd
  }

  return {
    type,
    transactionId: raw.slice(8, 20),
    attributes,
  }
}

function textAttribute(message: StunMessage, type: number): string | undefined {
  const value = message.attributes.get(type)
  return value ? new TextDecoder("utf-8", { fatal: true }).decode(value) : undefined
}

function errorDetails(message: StunMessage): { code?: number; reason?: string } {
  const value = message.attributes.get(STUN_ATTR_ERROR_CODE)
  if (!value || value.byteLength < 4) return {}
  const code = (value[2] & 0x07) * 100 + value[3]
  const reason = value.byteLength > 4 ? new TextDecoder().decode(value.subarray(4)).trim() : undefined
  return { code, reason }
}

function sameTransaction(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right)
}

function parseTurnHealthTarget(url: string): TurnHealthTarget | null {
  const match = /^(turns?):(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?(?:\?transport=([a-z0-9_-]+))?$/i.exec(url.trim())
  if (!match) {
    if (/^turns?:/i.test(url)) throw new TurnHealthCheckError(`invalid TURN URL: ${url}`)
    return null
  }
  if (match[4]?.toLowerCase() !== "tcp") return null

  const secure = match[1].toLowerCase() === "turns"
  const hostnameValue = match[2]
  const hostname = hostnameValue.startsWith("[") ? hostnameValue.slice(1, -1) : hostnameValue
  const port = match[3] ? Number(match[3]) : secure ? 5349 : 3478
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TurnHealthCheckError(`invalid TURN port in ${url}`)
  }
  return {
    hostname,
    port,
    secure,
    label: `${secure ? "turns" : "turn"}:${hostnameValue}:${port}?transport=tcp`,
  }
}

export function getTurnHealthTargets(urls: string[]): TurnHealthTarget[] {
  const targets = new Map<string, TurnHealthTarget>()
  for (const url of urls) {
    const target = parseTurnHealthTarget(url)
    if (target) targets.set(`${target.secure}:${target.hostname}:${target.port}`, target)
  }
  return [...targets.values()]
}

function beforeDeadline<T>(promise: Promise<T>, deadline: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TurnHealthCheckError(message)), Math.max(0, deadline - Date.now()))
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

async function readStunMessage(reader: ReadableStreamDefaultReader, deadline: number): Promise<StunMessage> {
  let buffered = new Uint8Array()
  while (true) {
    const result = await beforeDeadline(reader.read(), deadline, "timed out waiting for TURN response")
    if (result.done) throw new TurnHealthCheckError("TURN server closed the connection")
    if (!(result.value instanceof Uint8Array)) throw new TurnHealthCheckError("invalid TURN response bytes")
    buffered = concatBytes(buffered, result.value)
    if (buffered.byteLength < STUN_HEADER_BYTES) continue
    const bodyLength = new DataView(buffered.buffer, buffered.byteOffset, buffered.byteLength).getUint16(2)
    const messageLength = STUN_HEADER_BYTES + bodyLength
    if (buffered.byteLength >= messageLength) return parseStunMessage(buffered.slice(0, messageLength))
  }
}

function describeError(message: StunMessage): string {
  const error = errorDetails(message)
  return error.code === undefined
    ? `unexpected STUN response type 0x${message.type.toString(16)}`
    : `TURN error ${error.code}${error.reason ? ` (${error.reason})` : ""}`
}

async function probeTurnTarget(
  target: TurnHealthTarget,
  username: string,
  credential: string,
  socketConnect: TurnSocketConnect,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const socket = socketConnect(
    { hostname: target.hostname, port: target.port },
    { secureTransport: target.secure ? "on" : "off", allowHalfOpen: false },
  )
  void socket.closed.catch(() => undefined)
  let reader: ReadableStreamDefaultReader | undefined
  let writer: WritableStreamDefaultWriter | undefined
  try {
    await beforeDeadline(socket.opened, deadline, `timed out connecting to ${target.label}`)
    reader = socket.readable.getReader()
    writer = socket.writable.getWriter()

    const initialRequest = buildInitialAllocateRequest()
    await beforeDeadline(writer.write(initialRequest), deadline, `timed out writing to ${target.label}`)
    const challenge = await readStunMessage(reader, deadline)
    if (!sameTransaction(challenge.transactionId, initialRequest.subarray(8, 20))) {
      throw new TurnHealthCheckError("TURN challenge transaction ID does not match")
    }
    if (challenge.type === STUN_ALLOCATE_SUCCESS) {
      throw new TurnHealthCheckError("TURN server accepted an unauthenticated allocation")
    }
    const challengeError = errorDetails(challenge)
    const realm = textAttribute(challenge, STUN_ATTR_REALM)
    const nonce = textAttribute(challenge, STUN_ATTR_NONCE)
    if (challenge.type !== STUN_ALLOCATE_ERROR || challengeError.code !== 401 || !realm || !nonce) {
      throw new TurnHealthCheckError(`expected TURN authentication challenge, received ${describeError(challenge)}`)
    }

    const authenticatedRequest = await buildAuthenticatedAllocateRequest(username, credential, realm, nonce)
    await beforeDeadline(
      writer.write(authenticatedRequest),
      deadline,
      `timed out writing credentials to ${target.label}`,
    )
    const response = await readStunMessage(reader, deadline)
    if (!sameTransaction(response.transactionId, authenticatedRequest.subarray(8, 20))) {
      throw new TurnHealthCheckError("authenticated TURN response transaction ID does not match")
    }

    if (response.type !== STUN_ALLOCATE_SUCCESS) {
      throw new TurnHealthCheckError(describeError(response))
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new TurnHealthCheckError(`${target.label}: ${reason}`)
  } finally {
    reader?.releaseLock()
    writer?.releaseLock()
    await socket.close().catch(() => undefined)
  }
}

export async function checkTurnCredentials(
  urls: string[],
  username: string,
  credential: string,
  options: TurnHealthCheckOptions = {},
): Promise<void> {
  const targets = getTurnHealthTargets(urls)
  if (targets.length === 0) {
    throw new TurnHealthCheckError(
      "Worker-side TURN health checks require at least one turn: or turns: URL with ?transport=tcp",
    )
  }
  const socketConnect = options.connect ?? connect
  const timeoutMs = options.timeoutMs ?? DEFAULT_TURN_HEALTH_TIMEOUT_MS
  if (targets.length === 1) {
    await probeTurnTarget(targets[0], username, credential, socketConnect, timeoutMs)
    return
  }

  try {
    await Promise.any(targets.map((target) => probeTurnTarget(target, username, credential, socketConnect, timeoutMs)))
  } catch (error) {
    if (!(error instanceof AggregateError)) throw error
    const reasons = error.errors.map((reason) => (reason instanceof Error ? reason.message : String(reason)))
    throw new TurnHealthCheckError(`all TURN endpoints failed: ${reasons.join("; ")}`)
  }
}
