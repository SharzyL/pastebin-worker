import { base64VariantDecode, base64VariantEncode } from "./encryption.js"
import { NICKNAME_PARTS } from "./nicknames.js"

// The secret in the URL fragment is never sent to the server. Three values are
// derived from it with HKDF: the room id, which the server uses for routing,
// the room key, which encrypts every frame, and the pre-shared key mixed into
// the pairwise keys of liveSession.ts. HKDF is one-way, so knowing the room id
// reveals nothing about the others. See doc/crypto.md.
export const LIVE_SECRET_BYTES = 32

// Oldest posts are dropped once the page holds more than this
export const LIVE_MAX_PAGE_BYTES = 128 * 1024 * 1024

const HKDF_ROOM_INFO = "pb-live-room-v1"
const HKDF_KEY_INFO = "pb-live-key-v1"
const HKDF_PSK_INFO = "pb-live-psk-v2"

export interface LivePost {
  author: string
  kind: "text" | "file"
  filename?: string
  lang?: string
  mime?: string
  // UTF-8 text for text posts, raw content for files
  body: Uint8Array
}

export interface LiveMessage extends LivePost {
  id: string
  ts: number
}

type LiveHeader = Omit<LiveMessage, "body">

export interface LiveKeys {
  roomId: string
  // AES-GCM, encrypts the outer layer of every frame
  roomKey: CryptoKey
  // salt of the pairwise key derivation
  psk: Uint8Array
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function genLiveSecret(): string {
  return base64VariantEncode(crypto.getRandomValues(new Uint8Array(LIVE_SECRET_BYTES)))
}

export function genMessageId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(8)))
}

let nicknames: string[] | undefined

// Default nickname such as "ホキ5000"
export function genNickname(): string {
  nicknames ??= Object.entries(NICKNAME_PARTS).flatMap(([prefix, numbers]) => numbers.split(" ").map((n) => prefix + n))
  return nicknames[crypto.getRandomValues(new Uint32Array(1))[0] % nicknames.length]
}

export async function deriveLiveKeys(secret: string): Promise<LiveKeys> {
  const raw = base64VariantDecode(secret)
  if (raw.length !== LIVE_SECRET_BYTES) {
    throw new Error(
      `Live room key must decode to ${LIVE_SECRET_BYTES} bytes, got ${raw.length} bytes. ` +
        `Make sure the URL fragment after "#" was copied in full.`,
    )
  }
  const master = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, ["deriveBits", "deriveKey"])
  const hkdf = (info: string) => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(),
    info: new TextEncoder().encode(info),
  })
  const roomBits = await crypto.subtle.deriveBits(hkdf(HKDF_ROOM_INFO), master, 128)
  const roomKey = await crypto.subtle.deriveKey(hkdf(HKDF_KEY_INFO), master, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
  const psk = new Uint8Array(await crypto.subtle.deriveBits(hkdf(HKDF_PSK_INFO), master, 256))
  return { roomId: toHex(new Uint8Array(roomBits)), roomKey, psk }
}

// Post plaintext layout: 4-byte big-endian header length, JSON header, body
export function encodePost(msg: LiveMessage): Uint8Array {
  const { body, ...header } = msg
  const headerBytes = new TextEncoder().encode(JSON.stringify(header satisfies LiveHeader))
  const plaintext = new Uint8Array(4 + headerBytes.length + body.length)
  new DataView(plaintext.buffer).setUint32(0, headerBytes.length)
  plaintext.set(headerBytes, 4)
  plaintext.set(body, 4 + headerBytes.length)
  return plaintext
}

function optionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string"
}

// Returns null for anything that does not look like a message
export function decodePost(plaintext: Uint8Array): LiveMessage | null {
  if (plaintext.length < 4) return null
  const headerLen = new DataView(plaintext.buffer, plaintext.byteOffset).getUint32(0)
  if (4 + headerLen > plaintext.length) return null
  let v: unknown
  try {
    v = JSON.parse(new TextDecoder().decode(plaintext.subarray(4, 4 + headerLen)))
  } catch {
    return null
  }
  if (typeof v !== "object" || v === null) return null
  const h = v as Record<string, unknown>
  if (typeof h.id !== "string" || typeof h.ts !== "number" || typeof h.author !== "string") return null
  if (h.kind !== "text" && h.kind !== "file") return null
  if (!optionalString(h.filename) || !optionalString(h.lang) || !optionalString(h.mime)) return null
  return {
    id: h.id,
    ts: h.ts,
    author: h.author,
    kind: h.kind,
    ...(h.filename !== undefined ? { filename: h.filename } : {}),
    ...(h.lang !== undefined ? { lang: h.lang } : {}),
    ...(h.mime !== undefined ? { mime: h.mime } : {}),
    // a view, not a copy: the header bytes before it are tiny
    body: plaintext.subarray(4 + headerLen),
  }
}

// Append a message unless one with its id is already there (e.g. a replayed
// frame), dropping the oldest ones beyond LIVE_MAX_PAGE_BYTES
export function appendMessage<T extends LiveMessage>(msgs: T[], msg: T): T[] {
  if (msgs.some((m) => m.id === msg.id)) return msgs
  const next = [...msgs, msg]
  let total = next.reduce((sum, m) => sum + m.body.length, 0)
  let start = 0
  while (total > LIVE_MAX_PAGE_BYTES && start < next.length - 1) {
    total -= next[start].body.length
    start += 1
  }
  return next.slice(start)
}
