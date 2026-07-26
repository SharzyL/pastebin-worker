import {
  archiveWorkerChunkSize,
  streamZipFiles,
  type ArchiveWorkerRequest,
  type ArchiveWorkerResponse,
} from "./archiveCore.js"

let started = false
let nextChunkId = 1
let pendingAck: { id: number; resolve: () => void } | undefined

function transferableBuffer(chunk: Uint8Array): ArrayBuffer {
  if (chunk.buffer instanceof ArrayBuffer && chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength) {
    return chunk.buffer
  }
  return chunk.slice().buffer
}

function sendChunk(chunk: Uint8Array): Promise<void> {
  const id = nextChunkId++
  const data = transferableBuffer(chunk)
  return new Promise<void>((resolve) => {
    pendingAck = { id, resolve }
    const response: ArchiveWorkerResponse = { type: "chunk", id, data }
    self.postMessage(response, { transfer: [data] })
  })
}

function postError(error: unknown): void {
  const response: ArchiveWorkerResponse = {
    type: "error",
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    },
  }
  self.postMessage(response)
}

async function buildArchive(files: File[]): Promise<void> {
  try {
    await streamZipFiles(files, sendChunk, { chunkSize: archiveWorkerChunkSize })
    const response: ArchiveWorkerResponse = { type: "complete" }
    self.postMessage(response)
  } catch (error) {
    postError(error)
  }
}

self.onmessage = (event: MessageEvent<ArchiveWorkerRequest>) => {
  const message = event.data
  if (message.type === "chunk-ack") {
    if (pendingAck?.id !== message.id) return
    const { resolve } = pendingAck
    pendingAck = undefined
    resolve()
    return
  }

  if (started) {
    postError(new Error("Archive worker has already started"))
    return
  }
  started = true
  void buildArchive(message.files)
}
