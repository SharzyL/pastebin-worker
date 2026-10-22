import { LIVE_MAX_PEERS } from "../../shared/live.js"
import { base64VariantDecode, base64VariantEncode } from "./encryption.js"
import type { LiveKeys, LiveMessage } from "./live.js"
import { decodePost, encodePost, toHex } from "./live.js"

// Forward secret encryption for one connection to a live room, see doc/live-crypto.md.
//
// Every connection makes an ephemeral ECDH key pair that only lives in memory.
// Peers exchange public keys (hello, proof) and derive a pairwise key from
// their ECDH secret and the pre-shared key. A post body is encrypted once under
// a fresh content key, which is wrapped for each confirmed peer under the
// pairwise key. Once both pages drop their key pairs, a recorded post cannot be
// decrypted again, even by someone who learns the room link.
//
// Frame layout: 4-byte big-endian outer length, outer, body. The outer part is
// a JSON control message sealed under the room key; the body, only present in
// posts, is sealed under the content key. Sealed data is a 12-byte IV followed
// by AES-GCM ciphertext.

const FRAME_VERSION = 2
const IV_BYTES = 12
const NONCE_BYTES = 16
const SID_BYTES = 16

const PAIR_WRAP_INFO = "pb-live-pair-wrap-v2"
const PAIR_PROOF_INFO = "pb-live-pair-proof-v2"
const PROOF_LABEL = "pb-live-proof-v2"
const WRAP_AAD = "pb-live-wrap-v2"
const BODY_AAD = "pb-live-body-v2"

// Peers not heard from for this long are forgotten; they announce themselves
// more often than that with alive()
export const LIVE_PEER_TIMEOUT_MS = 75_000

const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" }

const utf8 = new TextEncoder()

type Outer =
  | { v: 2; t: "hello"; pub: string; nonce: string }
  | { v: 2; t: "proof"; pub: string; nonce: string; seq: number; to: string; tag: string }
  | { v: 2; t: "alive"; from: string; seq: number }
  | { v: 2; t: "bye"; from: string }
  | { v: 2; t: "post"; from: string; wraps: { to: string; key: string }[] }

interface Peer {
  nonce: Uint8Array
  wrapKey: CryptoKey
  proofKey: CryptoKey
  // answered a proof over our nonce, so it holds its private key right now
  confirmed: boolean
  sentProof: boolean
  // highest sequence number seen, so replayed proofs and alives are ignored
  seq: number
  lastHeardAt: number
}

export interface LiveReceived {
  // frames to send back, in order
  replies: Uint8Array[]
  message?: LiveMessage
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return compareBytes(a, b) === 0
}

async function seal(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return concat(iv, new Uint8Array(ct))
}

async function unseal(key: CryptoKey, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.length < IV_BYTES) return null
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES) as BufferSource, additionalData: aad as BufferSource },
      key,
      sealed.subarray(IV_BYTES) as BufferSource,
    )
    return new Uint8Array(pt)
  } catch {
    return null
  }
}

async function sidOf(pub: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", pub as BufferSource))
  return toHex(digest.subarray(0, SID_BYTES))
}

function decodeBytes(v: unknown): Uint8Array | null {
  if (typeof v !== "string") return null
  try {
    return base64VariantDecode(v)
  } catch {
    return null
  }
}

function isSid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{32}$/.test(v)
}

function isSeq(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0
}

// Checks the shape of a decrypted outer message; null for anything unexpected
function parseOuter(plaintext: Uint8Array): Outer | null {
  let v: unknown
  try {
    v = JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    return null
  }
  if (typeof v !== "object" || v === null) return null
  const o = v as Record<string, unknown>
  if (o.v !== FRAME_VERSION) return null
  switch (o.t) {
    case "hello":
      return typeof o.pub === "string" && typeof o.nonce === "string" ? (o as Outer) : null
    case "proof":
      return typeof o.pub === "string" &&
        typeof o.nonce === "string" &&
        isSeq(o.seq) &&
        isSid(o.to) &&
        typeof o.tag === "string"
        ? (o as Outer)
        : null
    case "alive":
      return isSid(o.from) && isSeq(o.seq) ? (o as Outer) : null
    case "bye":
      return isSid(o.from) ? (o as Outer) : null
    case "post":
      return isSid(o.from) &&
        Array.isArray(o.wraps) &&
        o.wraps.length <= LIVE_MAX_PEERS &&
        o.wraps.every(
          (w: unknown) =>
            typeof w === "object" &&
            w !== null &&
            isSid((w as { to: unknown }).to) &&
            typeof (w as { key: unknown }).key === "string",
        )
        ? (o as Outer)
        : null
    default:
      return null
  }
}

export class LiveSession {
  private peers = new Map<string, Peer>()
  private seq = 0

  private constructor(
    private keys: LiveKeys,
    private privateKey: CryptoKey,
    private pub: Uint8Array,
    readonly sid: string,
    private nonce: Uint8Array,
  ) {}

  static async create(keys: LiveKeys): Promise<LiveSession> {
    // the private key cannot be exported, so it is gone once this object is
    const pair = await crypto.subtle.generateKey(ECDH_PARAMS, false, ["deriveBits"])
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
    return new LiveSession(keys, pair.privateKey, pub, await sidOf(pub), nonce)
  }

  // Peers that proved they are online, the recipients of the next post
  get confirmedCount(): number {
    let n = 0
    for (const peer of this.peers.values()) if (peer.confirmed) n += 1
    return n
  }

  async hello(): Promise<Uint8Array> {
    return await this.frame({
      v: 2,
      t: "hello",
      pub: base64VariantEncode(this.pub),
      nonce: base64VariantEncode(this.nonce),
    })
  }

  async alive(): Promise<Uint8Array> {
    return await this.frame({ v: 2, t: "alive", from: this.sid, seq: this.nextSeq() })
  }

  async bye(): Promise<Uint8Array> {
    return await this.frame({ v: 2, t: "bye", from: this.sid })
  }

  // Forget peers that have been silent for too long
  prune(now: number = Date.now()) {
    for (const [sid, peer] of this.peers) {
      if (now - peer.lastHeardAt > LIVE_PEER_TIMEOUT_MS) this.peers.delete(sid)
    }
  }

  // Encrypts a post for the confirmed peers; null when there are none
  async encryptPost(msg: LiveMessage): Promise<Uint8Array | null> {
    const recipients = [...this.peers].filter(([, peer]) => peer.confirmed)
    if (recipients.length === 0) return null
    const contentKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"])
    const body = await seal(contentKey, encodePost(msg), utf8.encode(BODY_AAD))
    const wraps = await Promise.all(
      recipients.map(async ([sid, peer]) => {
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
        const wrapped = await crypto.subtle.wrapKey("raw", contentKey, peer.wrapKey, {
          name: "AES-GCM",
          iv,
          additionalData: this.wrapAad(this.sid, sid) as BufferSource,
        })
        return { to: sid, key: base64VariantEncode(concat(iv, new Uint8Array(wrapped))) }
      }),
    )
    return await this.frame({ v: 2, t: "post", from: this.sid, wraps }, body)
  }

  // Handles one frame from the relay. Frames that fail to decrypt or verify
  // are ignored.
  async receive(data: Uint8Array, now: number = Date.now()): Promise<LiveReceived> {
    const none: LiveReceived = { replies: [] }
    if (data.length < 4) return none
    const outerLen = new DataView(data.buffer, data.byteOffset).getUint32(0)
    if (4 + outerLen > data.length) return none
    const outerPlain = await unseal(this.keys.roomKey, data.subarray(4, 4 + outerLen), new Uint8Array())
    const outer = outerPlain && parseOuter(outerPlain)
    if (!outer) return none
    const body = data.subarray(4 + outerLen)

    switch (outer.t) {
      case "hello": {
        const pub = decodeBytes(outer.pub)
        const nonce = decodeBytes(outer.nonce)
        if (!pub || nonce?.length !== NONCE_BYTES) return none
        const sid = await sidOf(pub)
        // a known sid is a replay or a duplicate
        if (sid === this.sid || this.peers.has(sid)) return none
        const peer = await this.addPeer(sid, pub, nonce, now)
        if (!peer) return none
        return { replies: [await this.proof(sid, peer)] }
      }
      case "proof": {
        if (outer.to !== this.sid) return none
        const pub = decodeBytes(outer.pub)
        const nonce = decodeBytes(outer.nonce)
        if (!pub || nonce?.length !== NONCE_BYTES) return none
        const sid = await sidOf(pub)
        if (sid === this.sid) return none
        const peer = this.peers.get(sid) ?? (await this.addPeer(sid, pub, nonce, now))
        if (!peer || !bytesEqual(peer.nonce, nonce) || outer.seq <= peer.seq) return none
        const tag = decodeBytes(outer.tag)
        if (!tag) return none
        const ok = await crypto.subtle.verify(
          "HMAC",
          peer.proofKey,
          tag as BufferSource,
          this.proofInput(sid, this.sid, this.nonce, peer.nonce) as BufferSource,
        )
        if (!ok) return none
        peer.confirmed = true
        peer.seq = outer.seq
        peer.lastHeardAt = now
        return { replies: peer.sentProof ? [] : [await this.proof(sid, peer)] }
      }
      case "alive": {
        const peer = this.peers.get(outer.from)
        if (peer?.confirmed && outer.seq > peer.seq) {
          peer.seq = outer.seq
          peer.lastHeardAt = now
        }
        return none
      }
      case "bye": {
        this.peers.delete(outer.from)
        return none
      }
      case "post": {
        const peer = this.peers.get(outer.from)
        const wrap = outer.wraps.find((w) => w.to === this.sid)
        // a post sent before the sender knew us
        if (!peer || !wrap) return none
        const sealedKey = decodeBytes(wrap.key)
        if (!sealedKey || sealedKey.length < IV_BYTES) return none
        let contentKey: CryptoKey
        try {
          contentKey = await crypto.subtle.unwrapKey(
            "raw",
            sealedKey.subarray(IV_BYTES) as BufferSource,
            peer.wrapKey,
            {
              name: "AES-GCM",
              iv: sealedKey.subarray(0, IV_BYTES) as BufferSource,
              additionalData: this.wrapAad(outer.from, this.sid) as BufferSource,
            },
            { name: "AES-GCM" },
            false,
            ["decrypt"],
          )
        } catch {
          return none
        }
        const plaintext = await unseal(contentKey, body, utf8.encode(BODY_AAD))
        const message = plaintext && decodePost(plaintext)
        return message ? { replies: [], message } : none
      }
    }
  }

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  private async frame(outer: Outer, body: Uint8Array = new Uint8Array()): Promise<Uint8Array> {
    const sealed = await seal(this.keys.roomKey, utf8.encode(JSON.stringify(outer)), new Uint8Array())
    const out = new Uint8Array(4 + sealed.length + body.length)
    new DataView(out.buffer).setUint32(0, sealed.length)
    out.set(sealed, 4)
    out.set(body, 4 + sealed.length)
    return out
  }

  private async proof(to: string, peer: Peer): Promise<Uint8Array> {
    peer.sentProof = true
    const tag = await crypto.subtle.sign(
      "HMAC",
      peer.proofKey,
      this.proofInput(this.sid, to, peer.nonce, this.nonce) as BufferSource,
    )
    return await this.frame({
      v: 2,
      t: "proof",
      pub: base64VariantEncode(this.pub),
      nonce: base64VariantEncode(this.nonce),
      seq: this.nextSeq(),
      to,
      tag: base64VariantEncode(new Uint8Array(tag)),
    })
  }

  // A proof from `from` to `to` covers the nonce of `to`, so it cannot be
  // answered without the private key of `from` at the time
  private proofInput(from: string, to: string, toNonce: Uint8Array, fromNonce: Uint8Array): Uint8Array {
    return concat(utf8.encode(`${PROOF_LABEL}|${from}|${to}|`), toNonce, fromNonce)
  }

  private wrapAad(from: string, to: string): Uint8Array {
    return utf8.encode(`${WRAP_AAD}|${from}|${to}`)
  }

  private async addPeer(sid: string, pub: Uint8Array, nonce: Uint8Array, now: number): Promise<Peer | null> {
    if (this.peers.size >= LIVE_MAX_PEERS) return null
    let peerKey: CryptoKey
    try {
      // rejects points that are not on the curve
      peerKey = await crypto.subtle.importKey("raw", pub as BufferSource, ECDH_PARAMS, true, [])
    } catch {
      return null
    }
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: peerKey }, this.privateKey, 256)
    const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"])
    // both public keys, in a fixed order, so the key belongs to this pair only
    const [lo, hi] = compareBytes(this.pub, pub) < 0 ? [this.pub, pub] : [pub, this.pub]
    const hkdf = (label: string) => ({
      name: "HKDF",
      hash: "SHA-256",
      salt: this.keys.psk as BufferSource,
      info: concat(utf8.encode(label), lo, hi) as BufferSource,
    })
    const wrapKey = await crypto.subtle.deriveKey(hkdf(PAIR_WRAP_INFO), ikm, { name: "AES-GCM", length: 256 }, false, [
      "wrapKey",
      "unwrapKey",
    ])
    const proofKey = await crypto.subtle.deriveKey(
      hkdf(PAIR_PROOF_INFO),
      ikm,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    )
    // re-check: another frame may have added the peer while deriving
    const existing = this.peers.get(sid)
    if (existing) return existing
    const peer: Peer = { nonce, wrapKey, proofKey, confirmed: false, sentProof: false, seq: 0, lastHeardAt: now }
    this.peers.set(sid, peer)
    return peer
  }
}
