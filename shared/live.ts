// Wire protocol between live-channel clients and the relaying Durable Object.
//
// Posts travel as binary frames holding AES-GCM ciphertext produced with a key
// derived from the URL fragment, so the server never sees plaintext. The
// server forwards every binary frame as is to all other peers in the channel and
// keeps nothing. Text frames carry control messages from the server.

export const LIVE_PAGE_PATH = "/live"
export const LIVE_WS_PATH_PREFIX = "/live/ws/"

// Channel ids are 128-bit HKDF outputs, hex encoded
export const LIVE_CHANNEL_ID_REGEX = /^[0-9a-f]{32}$/

// Text frame answered by the server without waking the Durable Object up
export const LIVE_PING = "ping"
export const LIVE_PONG = "pong"

// Largest post body; a frame adds the header and encryption overhead to it
export const LIVE_MAX_BODY_BYTES = 10 * 1024 * 1024
export const LIVE_MAX_FRAME_BYTES = LIVE_MAX_BODY_BYTES + 64 * 1024
export const LIVE_MAX_PEERS = 64

export type LiveControlFrame = { t: "peers"; n: number } | { t: "error"; msg: string }

export function parseControlFrame(raw: string): LiveControlFrame | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== "object" || v === null) return null
  const f = v as Record<string, unknown>
  if (f.t === "peers" && typeof f.n === "number") return { t: "peers", n: f.n }
  if (f.t === "error" && typeof f.msg === "string") return { t: "error", msg: f.msg }
  return null
}
