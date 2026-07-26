import type { P2PIceServer } from "../../shared/interfaces.js"
import { isP2PIceServer } from "../../shared/p2pSignal.js"
import { jsonResponse, WorkerError } from "../common.js"
import { checkTurnCredentials } from "../turnHealth.js"

export const MIN_TURN_CREDENTIALS_REMAINING_MS = 6 * 60 * 60 * 1000
const TURN_CACHE_KEY = "turnCredentials"
const TURN_CREDENTIALS_TTL_SECONDS = 48 * 60 * 60
const TURN_CREDENTIALS_CACHE_SKEW_MS = 60 * 1000
const SELF_HOSTED_TURN_USER_ID = "p2p"

export interface P2PIceServersBundle {
  iceServers?: P2PIceServer[]
  expiresAt?: number
}

interface P2PTurnConfig {
  urls: string[]
  sharedSecret: string
}

interface P2PCfTurnConfig {
  turnId: string
  apiSecret: string
}

interface P2PTurnCredentials {
  iceServers: P2PIceServer[]
  expiresAt: number
  cacheKey: string
}

function turnCacheStub(env: { P2P_ROOM: DurableObjectNamespace }): DurableObjectStub {
  return env.P2P_ROOM.get(env.P2P_ROOM.idFromName("__turn_credentials_cache"))
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function parseTurnUrls(raw: unknown): string[] {
  const urls: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : typeof raw === "string" ? raw.split(",") : []
  return urls
    .filter((url): url is string => typeof url === "string")
    .map((url) => url.trim())
    .filter((url) => /^(stun|turns?):/i.test(url))
}

function isStunUrl(url: string): boolean {
  return /^stun:/i.test(url)
}

function isTurnUrl(url: string): boolean {
  return /^turns?:/i.test(url)
}

function getTurnConfig(env: Env): P2PTurnConfig | null {
  const vars = env as Env & {
    TURN_URLS?: string | string[]
    TURN_SHARED_SECRET?: string
  }
  const urls = parseTurnUrls(vars.TURN_URLS)
  const sharedSecret = vars.TURN_SHARED_SECRET?.trim()
  if (urls.length === 0 && !sharedSecret) return null
  if (urls.length === 0) {
    console.warn("TURN_SHARED_SECRET is set but TURN_URLS is empty; falling back to default STUN")
    return null
  }
  if (urls.some(isTurnUrl) && !sharedSecret) {
    console.warn(
      "TURN_URLS contains turn: or turns: URLs but TURN_SHARED_SECRET is empty; falling back to default STUN",
    )
    return null
  }
  return {
    urls,
    sharedSecret: sharedSecret ?? "",
  }
}

function getCfTurnConfig(env: Env): P2PCfTurnConfig | null {
  const vars = env as Env & { CF_TURN_ID?: string; CF_TURN_API_SECRET?: string }
  const turnId = vars.CF_TURN_ID?.trim()
  const apiSecret = vars.CF_TURN_API_SECRET?.trim()
  if ((turnId && !apiSecret) || (!turnId && apiSecret)) {
    console.warn("CF_TURN_ID and CF_TURN_API_SECRET must be set together; falling back to self-hosted TURN or STUN")
  }
  return turnId && apiSecret ? { turnId, apiSecret } : null
}

async function hmacSha1Base64(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ])
  return bytesToBase64(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function selfHostedTurnCredentialsCacheKey(urls: string[], sharedSecret: string): Promise<string> {
  return `self:v2:${await sha256Hex(sharedSecret)}:${urls.join(",")}`
}

function isTurnCredentials(value: unknown, cacheKey: string, minRemainingMs = 0): value is P2PTurnCredentials {
  if (typeof value !== "object" || value === null) return false
  const credentials = value as P2PTurnCredentials
  return (
    Array.isArray(credentials.iceServers) &&
    credentials.iceServers.every(isP2PIceServer) &&
    credentials.cacheKey === cacheKey &&
    typeof credentials.expiresAt === "number" &&
    credentials.expiresAt - Date.now() > minRemainingMs
  )
}

async function getCachedTurnCredentials(env: Env, cacheKey: string): Promise<P2PTurnCredentials | null> {
  const response = await turnCacheStub(env).fetch("https://p2p-room/turn-cache")
  if (!response.ok) return null
  const cached: unknown = await response.json()
  return isTurnCredentials(cached, cacheKey, MIN_TURN_CREDENTIALS_REMAINING_MS) ? cached : null
}

async function setCachedTurnCredentials(env: Env, credentials: P2PTurnCredentials): Promise<void> {
  const response = await turnCacheStub(env).fetch("https://p2p-room/turn-cache", {
    method: "POST",
    body: JSON.stringify(credentials),
  })
  if (!response.ok) throw new WorkerError(502, `failed to cache TURN credentials: ${await response.text()}`)
}

async function generateCfTurnCredentials(env: Env, config: P2PCfTurnConfig): Promise<P2PTurnCredentials> {
  const cacheKey = `cf:${config.turnId}`
  const cached = await getCachedTurnCredentials(env, cacheKey)
  if (cached) return cached

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${config.turnId}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: TURN_CREDENTIALS_TTL_SECONDS }),
    },
  )
  if (!response.ok) {
    throw new WorkerError(502, `failed to generate Cloudflare TURN credentials: ${await response.text()}`)
  }

  const body: unknown = await response.json()
  const iceServers = (body as { iceServers?: unknown }).iceServers
  if (!Array.isArray(iceServers) || !iceServers.every(isP2PIceServer)) {
    throw new WorkerError(502, "failed to generate Cloudflare TURN credentials: invalid response")
  }

  const credentials = {
    iceServers,
    expiresAt: Date.now() + TURN_CREDENTIALS_TTL_SECONDS * 1000 - TURN_CREDENTIALS_CACHE_SKEW_MS,
    cacheKey,
  }
  await setCachedTurnCredentials(env, credentials)
  return credentials
}

async function generateSelfHostedTurnCredentials(env: Env, config: P2PTurnConfig): Promise<P2PTurnCredentials> {
  const cacheKey = await selfHostedTurnCredentialsCacheKey(config.urls, config.sharedSecret)
  const cached = await getCachedTurnCredentials(env, cacheKey)
  if (cached) return cached

  const expiresAtUnix = Math.floor(Date.now() / 1000) + TURN_CREDENTIALS_TTL_SECONDS
  const username = `${expiresAtUnix}:${SELF_HOSTED_TURN_USER_ID}`
  const credential = await hmacSha1Base64(config.sharedSecret, username)
  const credentials = {
    iceServers: [
      {
        urls: config.urls,
        username,
        credential,
      },
    ],
    expiresAt: expiresAtUnix * 1000 - TURN_CREDENTIALS_CACHE_SKEW_MS,
    cacheKey,
  }

  await checkTurnCredentials(config.urls, username, credential)
  await setCachedTurnCredentials(env, credentials)
  return credentials
}

export async function getTurnIceServers(env: Env): Promise<P2PIceServersBundle> {
  const cfTurnConfig = getCfTurnConfig(env)
  if (cfTurnConfig) {
    try {
      const credentials = await generateCfTurnCredentials(env, cfTurnConfig)
      return { iceServers: credentials.iceServers, expiresAt: credentials.expiresAt }
    } catch (error) {
      console.warn("Failed to use Cloudflare TURN credentials, falling back:", error)
    }
  }

  const config = getTurnConfig(env)
  if (!config) return {}
  if (config.urls.every(isStunUrl)) {
    return { iceServers: [{ urls: config.urls }] }
  }

  try {
    const credentials = await generateSelfHostedTurnCredentials(env, config)
    return { iceServers: credentials.iceServers, expiresAt: credentials.expiresAt }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`Self-hosted TURN health check failed; omitting ICE servers: ${reason}`)
    return {}
  }
}

export async function handleTurnCredentialCacheRequest(state: DurableObjectState, request: Request): Promise<Response> {
  if (request.method === "GET") {
    const cached = await state.storage.get<P2PTurnCredentials>(TURN_CACHE_KEY)
    return jsonResponse(cached ?? null)
  }
  if (request.method === "POST") {
    const credentials: unknown = await request.json()
    if (
      typeof credentials !== "object" ||
      credentials === null ||
      !isTurnCredentials(credentials, (credentials as P2PTurnCredentials).cacheKey)
    ) {
      return new Response("invalid turn credentials", { status: 400 })
    }
    await state.storage.put(TURN_CACHE_KEY, credentials)
    await state.storage.setAlarm(credentials.expiresAt)
    return jsonResponse({ ok: true })
  }
  return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } })
}
