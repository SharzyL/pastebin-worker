import { describe, expect, it } from "vitest"
import {
  TurnHealthCheckError,
  buildInitialAllocateRequest,
  checkTurnCredentials,
  deriveTurnLongTermKey,
  getTurnHealthTargets,
  parseStunMessage,
} from "../turnHealth.js"

const STUN_MAGIC_COOKIE = 0x2112a442
const STUN_ALLOCATE_SUCCESS = 0x0103
const STUN_ALLOCATE_ERROR = 0x0113
const STUN_ATTR_USERNAME = 0x0006
const STUN_ATTR_MESSAGE_INTEGRITY = 0x0008
const STUN_ATTR_ERROR_CODE = 0x0009
const STUN_ATTR_REALM = 0x0014
const STUN_ATTR_NONCE = 0x0015
const STUN_ATTR_REQUESTED_TRANSPORT = 0x0019

function concatBytes(...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function attribute(type: number, value: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(4 + Math.ceil(value.byteLength / 4) * 4)
  const view = new DataView(result.buffer)
  view.setUint16(0, type)
  view.setUint16(2, value.byteLength)
  result.set(value, 4)
  return result
}

function header(type: number, bodyLength: number, transactionId: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(20)
  const view = new DataView(result.buffer)
  view.setUint16(0, type)
  view.setUint16(2, bodyLength)
  view.setUint32(4, STUN_MAGIC_COOKIE)
  result.set(transactionId, 8)
  return result
}

async function hmacSha1(keyBytes: Uint8Array, value: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ])
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new Uint8Array(value)))
}

function errorCode(code: number, reason: string): Uint8Array<ArrayBuffer> {
  const reasonBytes = new TextEncoder().encode(reason)
  return concatBytes(new Uint8Array([0, 0, Math.floor(code / 100), code % 100]), reasonBytes)
}

function plainResponse(type: number, transactionId: Uint8Array, attributes: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concatBytes(...attributes)
  return concatBytes(header(type, body.byteLength, transactionId), body)
}

function textValue(message: ReturnType<typeof parseStunMessage>, type: number): string | undefined {
  const value = message.attributes.get(type)
  return value ? new TextDecoder().decode(value) : undefined
}

async function requestHasValidIntegrity(
  raw: Uint8Array,
  username: string,
  realm: string,
  credential: string,
): Promise<boolean> {
  const message = parseStunMessage(raw)
  const integrity = message.attributes.get(STUN_ATTR_MESSAGE_INTEGRITY)
  if (!integrity || raw.byteLength < 24) return false
  const key = await deriveTurnLongTermKey(username, realm, credential)
  const expected = await hmacSha1(key, raw.slice(0, raw.byteLength - 24))
  return expected.byteLength === integrity.byteLength && crypto.subtle.timingSafeEqual(expected, integrity)
}

function mockTurnConnect(
  expectedCredential: string,
  options: { allowUnauthenticated?: boolean; writeDelayMs?: number } = {},
): {
  connect: (address: SocketAddress, socketOptions: SocketOptions) => Socket
  calls: { address: SocketAddress; options: SocketOptions }[]
} {
  const calls: { address: SocketAddress; options: SocketOptions }[] = []
  const encoder = new TextEncoder()
  const realm = "turn.example.com"
  const nonce = "test-nonce"

  return {
    calls,
    connect: (address, socketOptions) => {
      calls.push({ address, options: socketOptions })
      let controller: ReadableStreamDefaultController<Uint8Array>
      let requestCount = 0
      let resolveClosed: () => void = () => undefined
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve
      })
      const readable = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
        },
      })
      const writable = new WritableStream<Uint8Array>({
        async write(chunk) {
          if (options.writeDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, options.writeDelayMs))
          }
          const request = parseStunMessage(new Uint8Array(chunk))
          if (requestCount === 0) {
            requestCount += 1
            if (options.allowUnauthenticated) {
              controller.enqueue(plainResponse(STUN_ALLOCATE_SUCCESS, request.transactionId, []))
              return
            }
            controller.enqueue(
              plainResponse(STUN_ALLOCATE_ERROR, request.transactionId, [
                attribute(STUN_ATTR_ERROR_CODE, errorCode(401, "Unauthenticated")),
                attribute(STUN_ATTR_REALM, encoder.encode(realm)),
                attribute(STUN_ATTR_NONCE, encoder.encode(nonce)),
              ]),
            )
            return
          }

          const username = textValue(request, STUN_ATTR_USERNAME) ?? ""
          const requestRealm = textValue(request, STUN_ATTR_REALM) ?? ""
          const requestNonce = textValue(request, STUN_ATTR_NONCE) ?? ""
          const hasValidIntegrity = await requestHasValidIntegrity(
            new Uint8Array(chunk),
            username,
            requestRealm,
            expectedCredential,
          )
          if (!hasValidIntegrity || requestRealm !== realm || requestNonce !== nonce) {
            controller.enqueue(
              plainResponse(STUN_ALLOCATE_ERROR, request.transactionId, [
                attribute(STUN_ATTR_ERROR_CODE, errorCode(401, "Unauthenticated")),
                attribute(STUN_ATTR_REALM, encoder.encode(realm)),
                attribute(STUN_ATTR_NONCE, encoder.encode(nonce)),
              ]),
            )
            return
          }
          controller.enqueue(plainResponse(STUN_ALLOCATE_SUCCESS, request.transactionId, []))
        },
      })

      return {
        readable,
        writable,
        opened: Promise.resolve({ remoteAddress: `${address.hostname}:${address.port}` }),
        closed,
        upgraded: false,
        secureTransport: socketOptions.secureTransport === "on" ? "on" : "off",
        close: () => {
          controller.close()
          resolveClosed()
          return Promise.resolve()
        },
        startTls: () => {
          throw new Error("not implemented")
        },
      }
    },
  }
}

describe("TURN health target parsing", () => {
  it("selects and deduplicates only explicit TCP TURN endpoints", () => {
    expect(
      getTurnHealthTargets([
        "stun:turn.example.com:3478",
        "turn:turn.example.com:3478?transport=udp",
        "turn:turn.example.com:3478?transport=tcp",
        "turn:turn.example.com:3478?transport=tcp",
        "turns:[2001:db8::1]:5349?transport=tcp",
      ]),
    ).toStrictEqual([
      {
        hostname: "turn.example.com",
        port: 3478,
        secure: false,
        label: "turn:turn.example.com:3478?transport=tcp",
      },
      {
        hostname: "2001:db8::1",
        port: 5349,
        secure: true,
        label: "turns:[2001:db8::1]:5349?transport=tcp",
      },
    ])
  })
})

describe("TURN long-term authentication", () => {
  it("sends only the required transport attribute in the initial Allocate request", () => {
    const request = parseStunMessage(buildInitialAllocateRequest())
    expect([...request.attributes.keys()]).toStrictEqual([STUN_ATTR_REQUESTED_TRANSPORT])
  })

  it("derives the RFC 8489 MD5 long-term credential key", async () => {
    const key = await deriveTurnLongTermKey("user", "realm", "pass")
    expect([...key].map((byte) => byte.toString(16).padStart(2, "0")).join("")).toStrictEqual(
      "8493fbc53ba582fb4c044c456bdc40eb",
    )
  })

  it("accepts a minimal authenticated Allocate success over Worker TCP sockets", async () => {
    const server = mockTurnConnect("temporary-credential")
    await expect(
      checkTurnCredentials(["turn:turn.example.com:3478?transport=tcp"], "2000000000:p2p", "temporary-credential", {
        connect: server.connect,
      }),
    ).resolves.toBeUndefined()
    expect(server.calls).toStrictEqual([
      {
        address: { hostname: "turn.example.com", port: 3478 },
        options: { secureTransport: "off", allowHalfOpen: false },
      },
    ])
  })

  it("accepts multiple TURN endpoints when any one target succeeds", async () => {
    const unavailableServer = mockTurnConnect("different-credential")
    const availableServer = mockTurnConnect("temporary-credential")
    const connect = (address: SocketAddress, options: SocketOptions) =>
      address.hostname === "unavailable.example.com"
        ? unavailableServer.connect(address, options)
        : availableServer.connect(address, options)

    await expect(
      checkTurnCredentials(
        ["turn:unavailable.example.com:3478?transport=tcp", "turn:available.example.com:3478?transport=tcp"],
        "2000000000:p2p",
        "temporary-credential",
        { connect },
      ),
    ).resolves.toBeUndefined()
    expect(unavailableServer.calls).toHaveLength(1)
    expect(availableServer.calls).toHaveLength(1)
  })

  it("reports every failed target when no TURN endpoint succeeds", async () => {
    const firstServer = mockTurnConnect("first-server-credential")
    const secondServer = mockTurnConnect("second-server-credential")
    const connect = (address: SocketAddress, options: SocketOptions) =>
      address.hostname === "first.example.com"
        ? firstServer.connect(address, options)
        : secondServer.connect(address, options)

    await expect(
      checkTurnCredentials(
        ["turn:first.example.com:3478?transport=tcp", "turn:second.example.com:3478?transport=tcp"],
        "2000000000:p2p",
        "worker-credential",
        { connect },
      ),
    ).rejects.toThrow(
      "all TURN endpoints failed: turn:first.example.com:3478?transport=tcp: TURN error 401 (Unauthenticated); " +
        "turn:second.example.com:3478?transport=tcp: TURN error 401 (Unauthenticated)",
    )
  })

  it("rejects credentials that do not match the TURN server", async () => {
    const server = mockTurnConnect("server-credential")
    await expect(
      checkTurnCredentials(["turns:turn.example.com:5349?transport=tcp"], "2000000000:p2p", "worker-credential", {
        connect: server.connect,
      }),
    ).rejects.toThrow("TURN error 401")
    expect(server.calls[0]?.options.secureTransport).toStrictEqual("on")
  })

  it("uses one timeout budget for the complete Allocate exchange", async () => {
    const server = mockTurnConnect("temporary-credential", { writeDelayMs: 30 })
    await expect(
      checkTurnCredentials(["turn:turn.example.com:3478?transport=tcp"], "2000000000:p2p", "temporary-credential", {
        connect: server.connect,
        timeoutMs: 50,
      }),
    ).rejects.toThrow("timed out writing credentials")
  })

  it("rejects a TURN server that does not enforce authentication", async () => {
    const server = mockTurnConnect("unused", { allowUnauthenticated: true })
    await expect(
      checkTurnCredentials(["turn:turn.example.com:3478?transport=tcp"], "2000000000:p2p", "temporary-credential", {
        connect: server.connect,
      }),
    ).rejects.toThrow("accepted an unauthenticated allocation")
  })

  it("requires a TCP endpoint for a Worker-side health check", async () => {
    await expect(
      checkTurnCredentials(["turn:turn.example.com:3478?transport=udp"], "2000000000:p2p", "temporary-credential"),
    ).rejects.toBeInstanceOf(TurnHealthCheckError)
  })
})
