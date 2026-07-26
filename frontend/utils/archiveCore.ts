import { Zip, ZipDeflate, ZipPassThrough } from "fflate"

interface ArchiveWorkerStartRequest {
  type: "start"
  files: File[]
}

interface ArchiveWorkerChunkAckRequest {
  type: "chunk-ack"
  id: number
}

export type ArchiveWorkerRequest = ArchiveWorkerStartRequest | ArchiveWorkerChunkAckRequest

interface ArchiveWorkerChunkResponse {
  type: "chunk"
  id: number
  data: ArrayBuffer
}

interface ArchiveWorkerCompleteResponse {
  type: "complete"
}

interface ArchiveWorkerErrorResponse {
  type: "error"
  error: {
    name: string
    message: string
  }
}

export type ArchiveWorkerResponse =
  ArchiveWorkerChunkResponse | ArchiveWorkerCompleteResponse | ArchiveWorkerErrorResponse

export const archiveWorkerChunkSize = 5 * 1024 * 1024
export const archiveMainThreadChunkSize = 512 * 1024

const alreadyCompressedExtensions = new Set([
  "7z",
  "aac",
  "avi",
  "avif",
  "br",
  "bz2",
  "docx",
  "epub",
  "flac",
  "gif",
  "gz",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "m4a",
  "m4v",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "ogv",
  "opus",
  "pdf",
  "png",
  "pptx",
  "rar",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xlsx",
  "xz",
  "zip",
  "zst",
])

type ArchiveEntry = ZipPassThrough | ZipDeflate

interface StreamZipFilesOptions {
  chunkSize: number
  signal?: AbortSignal
}

function shouldStoreWithoutCompression(file: File): boolean {
  const name = file.name.endsWith("/") ? file.name.slice(0, -1) : file.name
  const dot = name.lastIndexOf(".")
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
  if (alreadyCompressedExtensions.has(extension)) return true
  return (
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    (file.type.startsWith("image/") && file.type !== "image/svg+xml") ||
    file.type.startsWith("font/")
  )
}

function createArchiveEntry(file: File, name: string): ArchiveEntry {
  return shouldStoreWithoutCompression(file) ? new ZipPassThrough(name) : new ZipDeflate(name)
}

function zipEntryName(file: File, existing: Set<string>): string {
  if (!existing.has(file.name)) {
    existing.add(file.name)
    return file.name
  }

  const dot = file.name.lastIndexOf(".")
  const basename = dot > 0 ? file.name.slice(0, dot) : file.name
  const ext = dot > 0 ? file.name.slice(dot) : ""
  let index = 2
  while (true) {
    const candidate = `${basename} (${index})${ext}`
    if (!existing.has(candidate)) {
      existing.add(candidate)
      return candidate
    }
    index += 1
  }
}

export async function streamZipFiles(
  files: File[],
  writeChunk: (chunk: Uint8Array) => Promise<void>,
  { chunkSize, signal }: StreamZipFilesOptions,
): Promise<void> {
  const outputChunks: Uint8Array[] = []
  let outputError: Error | undefined
  let archiveFinished = false
  const zip = new Zip((error, chunk, final) => {
    if (error) outputError = error
    else {
      outputChunks.push(chunk)
      if (final) archiveFinished = true
    }
  })

  const flushOutput = async () => {
    if (outputError instanceof Error) throw outputError
    while (outputChunks.length > 0) {
      signal?.throwIfAborted()
      await writeChunk(outputChunks.shift()!)
    }
  }

  try {
    const names = new Set<string>()
    for (const file of files) {
      signal?.throwIfAborted()
      const entry = createArchiveEntry(file, zipEntryName(file, names))
      zip.add(entry)

      if (file.size === 0) {
        entry.push(new Uint8Array(), true)
        await flushOutput()
        continue
      }

      for (let offset = 0; offset < file.size; offset += chunkSize) {
        signal?.throwIfAborted()
        const end = Math.min(offset + chunkSize, file.size)
        const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer())
        signal?.throwIfAborted()
        entry.push(chunk, end === file.size)
        await flushOutput()
      }
    }

    zip.end()
    await flushOutput()
    if (!archiveFinished) throw new Error("ZIP archive ended without a final output chunk")
  } catch (error) {
    zip.terminate()
    const archiveError = error instanceof Error ? error : new Error(String(error))
    throw archiveError
  }
}
