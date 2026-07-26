import { genRandStr, jsonResponse, WorkerError } from "./common.js"
import { verifyAuth } from "./pages/auth.js"
import { pasteNameAvailable } from "./storage/storage.js"
import { PASTE_NAME_LEN } from "../shared/constants.js"
import { parseExpiration, parseExpirationReadable } from "../shared/parsers.js"
import { parseReadLimit } from "../shared/verify.js"
import type { P2PCreateResponse } from "../shared/interfaces.js"
import { getTurnIceServers } from "./p2p/turnCredentials.js"
import type { P2PRoomInit, P2PRoomStatus, P2PRoomUpdate } from "./p2p/roomState.js"

export { P2PRoom } from "./p2p/room.js"
export { getTurnIceServers, selfHostedTurnCredentialsCacheKey } from "./p2p/turnCredentials.js"

const P2P_SENDER_TOKEN_LEN = 32

function roomStub(env: { P2P_ROOM: DurableObjectNamespace }, name: string): DurableObjectStub {
  return env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
}

export async function getP2PRoomStatus(env: Env, name: string): Promise<P2PRoomStatus> {
  const response = await roomStub(env, name).fetch("https://p2p-room/status")
  if (!response.ok) return { active: false, joinable: false, hasSender: false, hasReceiver: false }
  return await response.json()
}

interface P2PCreateOptions {
  expire?: string
  maxTransfers?: string | number
}

async function readP2PCreateOptions(request: Request): Promise<P2PCreateOptions> {
  const url = new URL(request.url)
  const expire = url.searchParams.get("expire")
  const maxTransfers = url.searchParams.get("maxTransfers")
  if (expire !== null || maxTransfers !== null) {
    return {
      ...(expire !== null ? { expire } : {}),
      ...(maxTransfers !== null ? { maxTransfers } : {}),
    }
  }

  try {
    const body: unknown = await request.json()
    if (typeof body !== "object" || body === null) return {}
    const bodyExpire = (body as { expire?: unknown }).expire
    const bodyMaxTransfers = (body as { maxTransfers?: unknown }).maxTransfers
    return {
      ...(typeof bodyExpire === "string" ? { expire: bodyExpire } : {}),
      ...(typeof bodyMaxTransfers === "string" || typeof bodyMaxTransfers === "number"
        ? { maxTransfers: bodyMaxTransfers }
        : {}),
    }
  } catch {
    return {}
  }
}

function getP2PExpirationSeconds(options: P2PCreateOptions, env: Env): number {
  const expire = options.expire ?? env.DEFAULT_P2P_EXPIRATION
  const parsed = parseExpiration(expire)
  if (parsed === null) {
    throw new WorkerError(400, `‘${expire}’ is not a valid expiration specification`)
  }

  const maxExpirationSeconds = parseExpiration(env.MAX_P2P_EXPIRATION)!
  if (parsed > maxExpirationSeconds) {
    throw new WorkerError(400, `Exceed max P2P expiration (${parseExpirationReadable(env.MAX_P2P_EXPIRATION)!})`)
  }
  return parsed
}

function getP2PMaxTransfers(options: P2PCreateOptions, env: Env): number {
  const parsed = parseReadLimit(options.maxTransfers ?? env.DEFAULT_P2P_TRANSFERS)
  if (parsed === null) {
    throw new WorkerError(400, "Transfers must be a non-negative integer")
  }
  return parsed
}

export async function handleP2PCreate(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== "/p2p/create") return null
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } })
  }

  const authResponse = verifyAuth(request, env)
  if (authResponse !== null) return authResponse
  const options = await readP2PCreateOptions(request)
  const expirationSeconds = getP2PExpirationSeconds(options, env)
  const maxTransfers = getP2PMaxTransfers(options, env)

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const name = genRandStr(PASTE_NAME_LEN)
    const [isPasteNameAvailable, status] = await Promise.all([
      pasteNameAvailable(env, name),
      getP2PRoomStatus(env, name),
    ])
    if (!isPasteNameAvailable || status.active) continue

    const iceServerBundle = await getTurnIceServers(env)
    const senderToken = genRandStr(P2P_SENDER_TOKEN_LEN)
    const expiresAt = Date.now() + expirationSeconds * 1000
    const response = await roomStub(env, name).fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({
        iceServers: iceServerBundle.iceServers,
        iceServersExpiresAt: iceServerBundle.expiresAt,
        senderToken,
        expiresAt,
        maxTransfers,
      } satisfies P2PRoomInit),
    })
    if (!response.ok) continue

    const accessUrl = `${env.DEPLOY_URL}/p/${name}`
    const created: P2PCreateResponse = {
      name,
      url: accessUrl,
      displayUrl: accessUrl,
      senderToken,
      expireAt: new Date(expiresAt).toISOString(),
      expirationSeconds,
    }
    return jsonResponse(created)
  }

  throw new WorkerError(503, "unable to allocate a P2P room")
}

export async function handleP2PUpdate(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const match = /^\/p2p\/update\/([^/]+)$/.exec(url.pathname)
  if (!match) return null
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } })
  }

  const authResponse = verifyAuth(request, env)
  if (authResponse !== null) return authResponse

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== "object" || parsed === null) throw new Error("invalid body")
    body = parsed as Record<string, unknown>
  } catch {
    throw new WorkerError(400, "invalid P2P update request")
  }
  if (typeof body.senderToken !== "string" || body.senderToken.length === 0) {
    throw new WorkerError(403, "invalid sender token")
  }

  const options: P2PCreateOptions = {
    ...(typeof body.expire === "string" ? { expire: body.expire } : {}),
    ...(typeof body.maxTransfers === "string" || typeof body.maxTransfers === "number"
      ? { maxTransfers: body.maxTransfers }
      : {}),
  }
  const expirationSeconds = getP2PExpirationSeconds(options, env)
  const maxTransfers = getP2PMaxTransfers(options, env)
  const expiresAt = Date.now() + expirationSeconds * 1000
  const roomResponse = await roomStub(env, match[1]).fetch("https://p2p-room/update", {
    method: "POST",
    body: JSON.stringify({
      senderToken: body.senderToken,
      expiresAt,
      expirationSeconds,
      maxTransfers,
    } satisfies P2PRoomUpdate),
  })
  return new Response(roomResponse.body, {
    status: roomResponse.status,
    statusText: roomResponse.statusText,
    headers: new Headers(roomResponse.headers),
  })
}

export async function handleP2PWebSocket(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const match = /^\/p2p\/ws\/([^/]+)$/.exec(url.pathname)
  if (!match) return null
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected websocket", { status: 426 })
  }

  const role = url.searchParams.get("role")
  if (role !== "sender" && role !== "receiver") {
    throw new WorkerError(400, "role must be sender or receiver")
  }

  return await roomStub(env, match[1]).fetch(request)
}
