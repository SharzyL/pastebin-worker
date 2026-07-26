import {
  maxP2PControlMessageLength,
  verificationBlockSize,
  type DataMessage,
  type P2PVerificationManifest,
} from "./protocol.js"

export const maxVerificationRepairAttempts = 3

export interface BlockHashState {
  index: number
  size: number
  buffer: Uint8Array<ArrayBuffer>
  hashes: string[]
}

export function* verificationHashChunks(
  hashes: readonly string[],
  maxMessageLength: number,
): Generator<Extract<DataMessage, { type: "verification-chunk" }>> {
  const limit = Math.min(maxP2PControlMessageLength, Math.floor(maxMessageLength))
  let startIndex = 0
  while (startIndex < hashes.length) {
    const emptyMessage: Extract<DataMessage, { type: "verification-chunk" }> = {
      type: "verification-chunk",
      startIndex,
      hashes: [],
    }
    let serializedLength = JSON.stringify(emptyMessage).length
    let endIndex = startIndex
    while (endIndex < hashes.length) {
      const hashLength = JSON.stringify(hashes[endIndex]).length
      const addedLength = hashLength + (endIndex === startIndex ? 0 : 1)
      if (serializedLength + addedLength > limit) break
      serializedLength += addedLength
      endIndex += 1
    }
    if (endIndex === startIndex) throw new Error("P2P control message limit is too small for a verification hash.")
    yield { ...emptyMessage, hashes: hashes.slice(startIndex, endIndex) }
    startIndex = endIndex
  }
}

export function* verificationManifestMessages(
  manifest: P2PVerificationManifest,
  maxMessageLength: number,
): Generator<DataMessage> {
  const limit = Math.min(maxP2PControlMessageLength, Math.floor(maxMessageLength))
  const legacyMessage: DataMessage = { type: "done", verification: manifest }
  if (JSON.stringify(legacyMessage).length <= limit) {
    yield legacyMessage
    return
  }

  const startMessage: DataMessage = {
    type: "verification-start",
    blockSize: manifest.blockSize,
    hashCount: manifest.hashes.length,
  }
  if (JSON.stringify(startMessage).length > limit) {
    throw new Error("P2P control message limit is too small for transfer verification.")
  }
  yield startMessage
  yield* verificationHashChunks(manifest.hashes, limit)
  yield { type: "done" }
}

function digestToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function sha1Hex(parts: ArrayBuffer[]): Promise<string> {
  if (parts.length === 1) return digestToHex(await crypto.subtle.digest("SHA-1", parts[0]))
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(new Uint8Array(part), offset)
    offset += part.byteLength
  }
  return digestToHex(await crypto.subtle.digest("SHA-1", bytes))
}

export function sliceArrayBuffer(buffer: ArrayBuffer, start: number, end: number): ArrayBuffer {
  return start === 0 && end === buffer.byteLength ? buffer : buffer.slice(start, end)
}

export async function appendHashData(
  state: BlockHashState,
  chunk: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<void> {
  if (state.buffer.byteLength !== verificationBlockSize) state.buffer = new Uint8Array(verificationBlockSize)
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
  let chunkOffset = 0
  while (chunkOffset < bytes.byteLength) {
    const takeBytes = Math.min(verificationBlockSize - state.size, bytes.byteLength - chunkOffset)
    state.buffer.set(bytes.subarray(chunkOffset, chunkOffset + takeBytes), state.size)
    state.size += takeBytes
    chunkOffset += takeBytes
    if (state.size === verificationBlockSize) {
      state.hashes[state.index] = digestToHex(await crypto.subtle.digest("SHA-1", state.buffer))
      state.index += 1
      state.size = 0
    }
  }
}

export async function finishHashData(state: BlockHashState): Promise<string[]> {
  if (state.size > 0) {
    state.hashes[state.index] = digestToHex(await crypto.subtle.digest("SHA-1", state.buffer.subarray(0, state.size)))
    state.index += 1
    state.size = 0
  }
  state.buffer = new Uint8Array(0)
  return state.hashes
}

export function verificationHashIndices(manifest: P2PVerificationManifest, indices?: Iterable<number>): number[] {
  if (indices === undefined) return manifest.hashes.map((_, index) => index)

  const validIndices = new Set<number>()
  for (const rawIndex of indices) {
    const index = Math.floor(rawIndex)
    if (Number.isSafeInteger(index) && index >= 0 && index < manifest.hashes.length) validIndices.add(index)
  }
  return [...validIndices].sort((left, right) => left - right)
}

export function verificationBlockByteLength(index: number, totalBytes: number): number {
  const start = index * verificationBlockSize
  if (!Number.isSafeInteger(index) || index < 0 || start >= totalBytes) return 0
  return Math.min(verificationBlockSize, totalBytes - start)
}

export function verificationBlocksByteLength(indices: Iterable<number>, totalBytes: number): number {
  let bytes = 0
  for (const index of indices) bytes += verificationBlockByteLength(index, totalBytes)
  return bytes
}
