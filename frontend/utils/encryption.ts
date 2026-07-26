import {
  createEncryptionHeader,
  decryptChunk,
  encryptChunk,
  encryptedFileSize,
  encryptionChunkBounds,
  encryptionChunkCount,
  ENCRYPTION_HEADER_SIZE,
  ENCRYPTION_TAG_SIZE,
  parseEncryptionHeader,
  type ChunkedEncryptionHeader,
} from "./encryptionCore.js"
import { CHUNKED_ENCRYPTION_SCHEME, type EncryptionScheme } from "../../shared/constants.js"

export { CHUNKED_ENCRYPTION_SCHEME, type EncryptionScheme } from "../../shared/constants.js"

const cryptoWorkerThreshold = 1024 * 1024

interface WorkerResult {
  id: number
  data?: ArrayBuffer
  error?: string
}

interface PendingTransform {
  resolve: (data: ArrayBuffer) => void
  reject: (error: Error) => void
}

function asWorkerError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  return new Error(typeof error === "string" && error.length > 0 ? error : fallback)
}

export class ChunkCryptoSession {
  private readonly worker?: Worker
  private readonly pending = new Map<number, PendingTransform>()
  private nextId = 1
  private closed = false
  private terminalError?: Error

  constructor(
    private readonly key: CryptoKey,
    readonly header: ChunkedEncryptionHeader,
    useWorker = true,
  ) {
    if (useWorker && typeof window !== "undefined" && typeof Worker !== "undefined") {
      const worker = new Worker(new URL("./encryption.worker.ts", import.meta.url), { type: "module" })
      this.worker = worker
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const result = event.data
        const pending = this.pending.get(result.id)
        if (!pending) return
        this.pending.delete(result.id)
        if (result.data) pending.resolve(result.data)
        else pending.reject(new Error(result.error || "Encryption worker failed"))
      }
      worker.onerror = (event) => {
        event.preventDefault()
        this.failWorker(new Error(event.message || "Encryption worker failed"))
      }
      worker.onmessageerror = () => {
        this.failWorker(new Error("Encryption worker returned an invalid message"))
      }
      try {
        worker.postMessage({ type: "initialize", key, header })
      } catch (error) {
        const workerError = asWorkerError(error, "Encryption worker initialization failed")
        this.failWorker(workerError)
        throw workerError
      }
    }
  }

  encrypt(index: number, plaintext: ArrayBuffer): Promise<ArrayBuffer> {
    return this.transform("encrypt", index, plaintext)
  }

  decrypt(index: number, ciphertext: ArrayBuffer): Promise<ArrayBuffer> {
    return this.transform("decrypt", index, ciphertext)
  }

  close(): void {
    this.shutdown(new DOMException("Encryption session was closed", "AbortError"))
  }

  private transform(type: "encrypt" | "decrypt", index: number, data: ArrayBuffer): Promise<ArrayBuffer> {
    if (this.closed) {
      return Promise.reject(this.terminalError ?? new DOMException("Encryption session was closed", "AbortError"))
    }
    if (!this.worker) {
      return type === "encrypt"
        ? encryptChunk(this.key, this.header, index, data)
        : decryptChunk(this.key, this.header, index, data)
    }

    const id = this.nextId++
    return new Promise<ArrayBuffer>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker!.postMessage({ type, id, index, data }, [data])
      } catch (error) {
        this.failWorker(asWorkerError(error, "Encryption worker request failed"))
      }
    })
  }

  private failWorker(error: Error): void {
    this.shutdown(error)
  }

  private shutdown(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.terminalError = error
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
      this.worker.onmessageerror = null
      this.worker.terminate()
    }
    this.failPending(error)
  }

  private failPending(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
  }
}

function base64VariantEncode(src: Uint8Array): string {
  let binaryString = ""
  for (const byte of src) binaryString += String.fromCharCode(byte)
  return btoa(binaryString).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function base64VariantDecode(src: string): Uint8Array {
  const normalized = src.replaceAll("-", "+").replaceAll("_", "/")
  const binaryString = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
  const uint8Array = new Uint8Array(binaryString.length)
  for (let index = 0; index < binaryString.length; index += 1) {
    uint8Array[index] = binaryString.charCodeAt(index)
  }
  return uint8Array
}

function verifyScheme(scheme: EncryptionScheme): void {
  if (scheme !== CHUNKED_ENCRYPTION_SCHEME) throw new Error(`Unsupported encryption scheme: ${scheme as string}`)
}

export async function genKey(scheme: EncryptionScheme): Promise<CryptoKey> {
  verifyScheme(scheme)
  return await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
}

export async function encodeKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key))
  return base64VariantEncode(raw)
}

export async function decodeKey(scheme: EncryptionScheme, encoded: string): Promise<CryptoKey> {
  verifyScheme(scheme)
  let raw: Uint8Array
  try {
    raw = base64VariantDecode(encoded)
  } catch {
    throw new Error("The AES-GCM key in the URL is not valid base64url")
  }
  if (raw.length !== 32) {
    throw new Error(`AES-GCM key must decode to 32 bytes (256-bit), got ${raw.length} bytes`)
  }
  return await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", true, ["encrypt", "decrypt"])
}

export interface ChunkedEncryptionContext {
  key: CryptoKey
  encodedKey: string
  session: ChunkCryptoSession
}

export async function createChunkedEncryptionContext(plaintextSize: number): Promise<ChunkedEncryptionContext> {
  const key = await genKey(CHUNKED_ENCRYPTION_SCHEME)
  const header = createEncryptionHeader(plaintextSize)
  return {
    key,
    encodedKey: await encodeKey(key),
    session: new ChunkCryptoSession(key, header, plaintextSize >= cryptoWorkerThreshold),
  }
}

export function createChunkedDecryptionSession(key: CryptoKey, headerBytes: Uint8Array): ChunkCryptoSession {
  const header = parseEncryptionHeader(headerBytes)
  return new ChunkCryptoSession(key, header, header.plaintextSize >= cryptoWorkerThreshold)
}

export async function encrypt(scheme: EncryptionScheme, key: CryptoKey, msg: Uint8Array): Promise<Uint8Array> {
  verifyScheme(scheme)
  const header = createEncryptionHeader(msg.byteLength)
  const output = new Uint8Array(encryptedFileSize(msg.byteLength))
  output.set(header.bytes, 0)
  let outputOffset = ENCRYPTION_HEADER_SIZE
  for (let index = 0; index < encryptionChunkCount(msg.byteLength); index += 1) {
    const { start, end } = encryptionChunkBounds(msg.byteLength, index)
    const encrypted = new Uint8Array(
      await encryptChunk(key, header, index, msg.subarray(start, end) as Uint8Array<ArrayBuffer>),
    )
    output.set(encrypted, outputOffset)
    outputOffset += encrypted.byteLength
  }
  return output
}

export async function decrypt(
  scheme: EncryptionScheme,
  key: CryptoKey,
  ciphertext: Uint8Array,
): Promise<Uint8Array | null> {
  verifyScheme(scheme)
  if (ciphertext.byteLength < ENCRYPTION_HEADER_SIZE + ENCRYPTION_TAG_SIZE) return null

  try {
    const header = parseEncryptionHeader(ciphertext.subarray(0, ENCRYPTION_HEADER_SIZE))
    if (ciphertext.byteLength !== encryptedFileSize(header.plaintextSize)) return null
    const plaintext = new Uint8Array(header.plaintextSize)
    let inputOffset = ENCRYPTION_HEADER_SIZE
    for (let index = 0; index < encryptionChunkCount(header.plaintextSize); index += 1) {
      const { start, end } = encryptionChunkBounds(header.plaintextSize, index)
      const encryptedLength = end - start + ENCRYPTION_TAG_SIZE
      const encrypted = ciphertext.subarray(inputOffset, inputOffset + encryptedLength) as Uint8Array<ArrayBuffer>
      const decrypted = new Uint8Array(await decryptChunk(key, header, index, encrypted))
      plaintext.set(decrypted, start)
      inputOffset += encryptedLength
    }
    return plaintext
  } catch {
    return null
  }
}
