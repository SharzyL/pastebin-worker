import { itemNoun } from "../../shared/format.js"
import { ZIP_MEMORY_THRESHOLD_BYTES } from "../../shared/constants.js"
import { archiveMainThreadChunkSize, streamZipFiles } from "./archiveCore.js"
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "./archiveCore.js"
import { createOPFSTemporaryFile, type OPFSTemporaryFile } from "./opfs.js"

const estimatedArchiveEntryOverhead = 1024

export interface PreparedArchive {
  file: File
  cleanup?: () => Promise<void>
}

export interface ZipFilesOptions {
  signal?: AbortSignal
  opfsThreshold?: number
}

export function estimateArchiveSize(files: File[]): number {
  let estimatedSize = 0
  for (const file of files) {
    const nextSize = estimatedSize + file.size + estimatedArchiveEntryOverhead
    if (!Number.isSafeInteger(nextSize)) return Number.MAX_SAFE_INTEGER
    estimatedSize = nextSize
  }
  return estimatedSize
}

function zipFilenameDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError")
}

class OPFSArchiveWriteError extends Error {
  constructor(error: Error) {
    super(error.message)
    this.name = "OPFSArchiveWriteError"
  }
}

function createArchiveWorker(): Worker | undefined {
  if (typeof Worker === "undefined") return undefined
  try {
    return new Worker(new URL("./archive.worker.ts", import.meta.url), { type: "module" })
  } catch {
    return undefined
  }
}

async function streamZipFilesInWorker(
  worker: Worker,
  files: File[],
  writeChunk: (chunk: Uint8Array) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const handleAbort = () => finish(abortError(signal!))

    worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
      const message = event.data
      if (message.type === "error") {
        const error = new Error(message.error.message)
        error.name = message.error.name
        finish(error)
        return
      }
      if (message.type === "complete") {
        finish()
        return
      }

      void (async () => {
        try {
          signal?.throwIfAborted()
          await writeChunk(new Uint8Array(message.data))
          signal?.throwIfAborted()
          if (settled) return
          const ack: ArchiveWorkerRequest = { type: "chunk-ack", id: message.id }
          worker.postMessage(ack)
        } catch (error) {
          finish(asError(error))
        }
      })()
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish(event.error instanceof Error ? event.error : new Error(event.message || "Archive worker failed"))
    }
    worker.onmessageerror = () => finish(new Error("Archive worker returned an invalid message"))
    signal?.addEventListener("abort", handleAbort, { once: true })

    if (signal?.aborted) {
      handleAbort()
      return
    }

    try {
      const request: ArchiveWorkerRequest = { type: "start", files }
      worker.postMessage(request)
    } catch (error) {
      finish(asError(error))
    }
  })
}

async function buildArchive(
  files: File[],
  filename: string,
  signal: AbortSignal | undefined,
  temporaryFile: OPFSTemporaryFile | undefined,
): Promise<PreparedArchive> {
  const parts: BlobPart[] = []
  const writeChunk = async (chunk: Uint8Array) => {
    if (!temporaryFile) {
      parts.push(chunk as Uint8Array<ArrayBuffer>)
      return
    }
    try {
      await temporaryFile.write(chunk as Uint8Array<ArrayBuffer>)
    } catch (error) {
      throw new OPFSArchiveWriteError(asError(error))
    }
  }

  try {
    const archiveWorker = createArchiveWorker()
    if (archiveWorker) await streamZipFilesInWorker(archiveWorker, files, writeChunk, signal)
    else await streamZipFiles(files, writeChunk, { chunkSize: archiveMainThreadChunkSize, signal })

    if (!temporaryFile) return { file: new File(parts, filename, { type: "application/zip" }) }
    try {
      return await temporaryFile.finish(filename, "application/zip")
    } catch (error) {
      throw new OPFSArchiveWriteError(asError(error))
    }
  } catch (error) {
    await temporaryFile?.abort()
    throw error
  }
}

export async function zipFiles(
  files: File[],
  { signal, opfsThreshold = ZIP_MEMORY_THRESHOLD_BYTES }: ZipFilesOptions = {},
): Promise<PreparedArchive> {
  signal?.throwIfAborted()
  const filename = `${files.length}-${itemNoun(files.length)}-${zipFilenameDate()}.zip`
  const estimatedSize = estimateArchiveSize(files)
  if (estimatedSize <= opfsThreshold) return await buildArchive(files, filename, signal, undefined)

  let temporaryFile: OPFSTemporaryFile | undefined
  try {
    temporaryFile = await createOPFSTemporaryFile(estimatedSize, "archive")
  } catch {
    signal?.throwIfAborted()
    return await buildArchive(files, filename, signal, undefined)
  }

  try {
    signal?.throwIfAborted()
  } catch (error) {
    await temporaryFile.abort()
    throw error
  }

  try {
    return await buildArchive(files, filename, signal, temporaryFile)
  } catch (error) {
    signal?.throwIfAborted()
    if (!(error instanceof OPFSArchiveWriteError)) throw error
    return await buildArchive(files, filename, signal, undefined)
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
