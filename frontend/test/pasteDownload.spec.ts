import { afterEach, describe, expect, it, vi } from "vitest"
import { decodeKey, encodeKey, encrypt, genKey } from "../utils/encryption.js"
import { CHUNKED_ENCRYPTION_SCHEME } from "../utils/encryptionCore.js"
import {
  isMetaResponse,
  parseContentLength,
  parsePasteResponseHeaders,
  stripEncryptedSuffix,
} from "../utils/pasteResponse.js"
import { decryptResponseToFile, downloadResponseToFile } from "../utils/responseDownload.js"
import {
  cleanupQueuedOPFSFileDeletions,
  cleanupStaleOPFSTemporaryFiles,
  deferOPFSFileDeletion,
  queueOPFSFileDeletion,
} from "../utils/opfs.js"

function responseFromChunks(content: Uint8Array, chunkSizes: number[], declaredSize = content.byteLength): Response {
  let offset = 0
  let sizeIndex = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= content.byteLength) {
        controller.close()
        return
      }
      const size = chunkSizes[sizeIndex++ % chunkSizes.length]
      const end = Math.min(content.byteLength, offset + size)
      controller.enqueue(content.slice(offset, end))
      offset = end
    },
  })
  return new Response(body, { headers: { "Content-Length": String(declaredSize) } })
}

function mockExclusiveLocks() {
  const active = new Set<string>()
  const request = vi.fn(
    async (lockName: string, _options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> => {
      if (active.has(lockName)) return await callback(null)
      active.add(lockName)
      try {
        return await callback({ name: lockName, mode: "exclusive" })
      } finally {
        active.delete(lockName)
      }
    },
  )
  return { active, request }
}

function mockOPFS(locks?: ReturnType<typeof mockExclusiveLocks>) {
  const storedParts: BlobPart[] = []
  const write = vi.fn((data: FileSystemWriteChunkType) => {
    storedParts.push(data as unknown as BlobPart)
    return Promise.resolve()
  })
  const close = vi.fn(() => Promise.resolve())
  const abort = vi.fn(() => Promise.resolve())
  const removeEntry = vi.fn(() => Promise.resolve())
  const root = {
    async *entries() {
      await Promise.resolve()
      yield ["unrelated", { kind: "directory" } as FileSystemDirectoryHandle]
    },
    removeEntry,
    getFileHandle: vi.fn(() =>
      Promise.resolve({
        createWritable: () => Promise.resolve({ write, close, abort }),
        getFile: () => Promise.resolve(new File(storedParts, "temporary")),
      }),
    ),
  } as unknown as FileSystemDirectoryHandle
  vi.stubGlobal("navigator", {
    locks,
    storage: {
      estimate: () => Promise.resolve({ quota: 1024 * 1024, usage: 0 }),
      getDirectory: () => Promise.resolve(root),
    },
  })
  return { write, close, abort, removeEntry }
}

function responseWithoutLength(content: Uint8Array, chunkSizes: number[]): Response {
  const response = responseFromChunks(content, chunkSizes)
  response.headers.delete("Content-Length")
  return response
}

async function encryptedFixture(plaintext: Uint8Array) {
  const key = await genKey(CHUNKED_ENCRYPTION_SCHEME)
  return {
    encrypted: await encrypt(CHUNKED_ENCRYPTION_SCHEME, key, plaintext),
    encodedKey: await encodeKey(key),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("paste response parsing", () => {
  it("parses plain response headers", () => {
    const parsed = parsePasteResponseHeaders(
      new Headers({
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": "42",
        "Content-Disposition": 'attachment; filename="notes.txt"',
        "X-PB-Highlight-Language": "markdown",
        "X-PB-Remaining-Reads": "2",
      }),
    )

    expect(parsed).toMatchObject({
      contentLength: 42,
      effectiveContentType: "text/plain; charset=utf-8",
      mimeType: "text/plain",
      filename: "notes.txt",
      highlightLanguage: "markdown",
      remainingReads: "2",
      encryptionScheme: null,
    })
  })

  it("uses decrypted MIME and removes the storage suffix for encrypted responses", () => {
    const parsed = parsePasteResponseHeaders(
      new Headers({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="photo.png.encrypted"',
        "X-PB-Encryption-Scheme": "chunked-aes-gcm-v1",
        "X-PB-Decrypted-Content-Type": "image/png",
      }),
    )

    expect(parsed.effectiveContentType).toBe("image/png")
    expect(parsed.mimeType).toBe("image/png")
    expect(parsed.filename).toBe("photo.png")
  })

  it("normalizes invalid lengths and exposes the shared guards", () => {
    expect(parseContentLength(null)).toBeNull()
    expect(parseContentLength("-1")).toBeNull()
    expect(parseContentLength("invalid")).toBeNull()
    expect(stripEncryptedSuffix("archive.zip.encrypted")).toBe("archive.zip")
    expect(isMetaResponse({ sizeBytes: 0 })).toBe(true)
    expect(isMetaResponse({ sizeBytes: "0" })).toBe(false)
  })
})

describe("OPFS temporary file cleanup", () => {
  it("retries a deletion queued during page teardown", async () => {
    const locks = mockExclusiveLocks()
    const removeEntry = vi.fn(() => Promise.resolve())
    const root = { removeEntry } as unknown as FileSystemDirectoryHandle
    vi.stubGlobal("navigator", { locks })
    queueOPFSFileDeletion("p2p-completed.tmp")

    expect(await cleanupQueuedOPFSFileDeletions(root)).toStrictEqual(1)
    expect(removeEntry).toHaveBeenCalledWith("p2p-completed.tmp")
    expect(await cleanupQueuedOPFSFileDeletions(root)).toStrictEqual(0)
  })

  it("does not reclaim a completed download before its deletion grace period", async () => {
    const now = Date.UTC(2030, 0, 1)
    const locks = mockExclusiveLocks()
    const removeEntry = vi.fn(() => Promise.resolve())
    const root = { removeEntry } as unknown as FileSystemDirectoryHandle
    vi.stubGlobal("navigator", { locks })
    deferOPFSFileDeletion("paste-decrypt-download.tmp", now + 60_000)

    expect(await cleanupQueuedOPFSFileDeletions(root, now)).toStrictEqual(0)
    expect(removeEntry).not.toHaveBeenCalled()
    expect(await cleanupQueuedOPFSFileDeletions(root, now + 60_000)).toStrictEqual(1)
    expect(removeEntry).toHaveBeenCalledWith("paste-decrypt-download.tmp")
  })

  it("removes stale files only when no tab holds their lease", async () => {
    const now = Date.UTC(2030, 0, 2)
    const handles = new Map<string, FileSystemFileHandle>([
      [
        "paste-decrypt-stale.tmp",
        {
          kind: "file",
          getFile: () =>
            Promise.resolve(new File(["old"], "paste-decrypt-stale.tmp", { lastModified: now - 25 * 60 * 60 * 1000 })),
        } as FileSystemFileHandle,
      ],
      [
        "paste-archive-held.tmp",
        {
          kind: "file",
          getFile: () =>
            Promise.resolve(new File(["held"], "paste-archive-held.tmp", { lastModified: now - 26 * 60 * 60 * 1000 })),
        } as FileSystemFileHandle,
      ],
      [
        "paste-decrypt-current.tmp",
        {
          kind: "file",
          getFile: () =>
            Promise.resolve(new File(["new"], "paste-decrypt-current.tmp", { lastModified: now - 60 * 60 * 1000 })),
        } as FileSystemFileHandle,
      ],
    ])
    const removeEntry = vi.fn(() => Promise.resolve())
    const root = {
      entries: async function* () {
        await Promise.resolve()
        yield* handles.entries()
      },
      removeEntry,
    } as unknown as FileSystemDirectoryHandle
    const request = vi.fn(
      (lockName: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) =>
        callback(lockName.endsWith("paste-archive-held.tmp") ? null : { name: lockName, mode: "exclusive" }),
    )
    vi.stubGlobal("navigator", { locks: { request } })

    expect(await cleanupStaleOPFSTemporaryFiles(root, now)).toStrictEqual(1)
    expect(removeEntry).toHaveBeenCalledOnce()
    expect(removeEntry).toHaveBeenCalledWith("paste-decrypt-stale.tmp")
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("skips automatic deletion when cross-tab locks are unavailable", async () => {
    const now = Date.UTC(2030, 0, 2)
    const removeEntry = vi.fn(() => Promise.resolve())
    const root = {
      entries: async function* () {
        await Promise.resolve()
        yield [
          "paste-decrypt-stale.tmp",
          {
            kind: "file",
            getFile: () =>
              Promise.resolve(
                new File(["old"], "paste-decrypt-stale.tmp", { lastModified: now - 25 * 60 * 60 * 1000 }),
              ),
          } as FileSystemFileHandle,
        ] as [string, FileSystemFileHandle]
      },
      removeEntry,
    } as unknown as FileSystemDirectoryHandle
    vi.stubGlobal("navigator", {})

    expect(await cleanupStaleOPFSTemporaryFiles(root, now)).toStrictEqual(0)
    expect(removeEntry).not.toHaveBeenCalled()
  })
})

describe("plain response downloads", () => {
  it("keeps responses below the threshold in memory", async () => {
    const content = new TextEncoder().encode("small response")
    const result = await downloadResponseToFile(responseFromChunks(content, [2, 3]), {
      filename: "small.txt",
      type: "text/plain",
      opfsThreshold: content.byteLength + 1,
    })

    expect(new TextDecoder().decode(result.content)).toStrictEqual("small response")
    expect(result.file.name).toStrictEqual("small.txt")
    expect(result.cleanup).toBeUndefined()
  })

  it("releases the in-memory byte view when content was not requested", async () => {
    const content = new TextEncoder().encode("download only")
    const result = await downloadResponseToFile(responseFromChunks(content, [2, 3]), {
      filename: "download.bin",
      type: "application/octet-stream",
      includeContent: false,
      opfsThreshold: content.byteLength + 1,
    })

    expect(result.content).toBeUndefined()
    expect(Array.from(new Uint8Array(await result.file.arrayBuffer()))).toStrictEqual(Array.from(content))
  })

  it("streams a response at the threshold into OPFS", async () => {
    const locks = mockExclusiveLocks()
    const opfs = mockOPFS(locks)
    const content = new TextEncoder().encode("disk-backed plain response")
    const result = await downloadResponseToFile(responseFromChunks(content, [1, 4, 7]), {
      filename: "large.txt",
      type: "text/plain",
      opfsThreshold: content.byteLength,
    })

    expect(opfs.write.mock.calls.length).toBeGreaterThan(1)
    expect(opfs.close).toHaveBeenCalledTimes(1)
    expect(result.content).toBeUndefined()
    expect(new TextDecoder().decode(await result.file.arrayBuffer())).toStrictEqual("disk-backed plain response")
    expect(locks.active.size).toStrictEqual(1)
    expect(result.deferCleanup).toBeDefined()
    await result.cleanup?.()
    expect(opfs.removeEntry).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(locks.active.size).toStrictEqual(0))
  })

  it("aborts and removes a partial OPFS file when the response is truncated", async () => {
    const opfs = mockOPFS()
    const content = new TextEncoder().encode("short")

    await expect(
      downloadResponseToFile(responseFromChunks(content, [2], content.byteLength + 1), {
        filename: "truncated.bin",
        type: "application/octet-stream",
        opfsThreshold: 1,
      }),
    ).rejects.toThrow(/ended before Content-Length/)

    expect(opfs.abort).toHaveBeenCalledTimes(1)
    expect(opfs.removeEntry).toHaveBeenCalledTimes(1)
  })
})

describe("chunked encrypted downloads", () => {
  it("decrypts arbitrary response stream boundaries into memory", async () => {
    const plaintext = new TextEncoder().encode("streamed encrypted text")
    const { encrypted, encodedKey } = await encryptedFixture(plaintext)
    const result = await decryptResponseToFile(
      responseFromChunks(encrypted, [1, 7, 19]),
      CHUNKED_ENCRYPTION_SCHEME,
      encodedKey,
      { filename: "note.txt", type: "text/plain" },
    )

    expect(new TextDecoder().decode(result.content)).toStrictEqual("streamed encrypted text")
    expect(result.file.name).toStrictEqual("note.txt")
    expect(result.cleanup).toBeUndefined()
  })

  it("accepts a streamed response without Content-Length", async () => {
    const plaintext = new TextEncoder().encode("unknown response length")
    const { encrypted, encodedKey } = await encryptedFixture(plaintext)
    const result = await decryptResponseToFile(
      responseWithoutLength(encrypted, [2, 5]),
      CHUNKED_ENCRYPTION_SCHEME,
      encodedKey,
      { filename: "note.txt", type: "text/plain" },
    )

    expect(new TextDecoder().decode(result.content)).toStrictEqual("unknown response length")
  })

  it("releases decrypted bytes when only the file was requested", async () => {
    const plaintext = new TextEncoder().encode("decrypt for download only")
    const { encrypted, encodedKey } = await encryptedFixture(plaintext)
    const result = await decryptResponseToFile(
      responseFromChunks(encrypted, [2, 5]),
      CHUNKED_ENCRYPTION_SCHEME,
      encodedKey,
      {
        filename: "download.bin",
        type: "application/octet-stream",
        includeContent: false,
        opfsThreshold: plaintext.byteLength + 1,
      },
    )

    expect(result.content).toBeUndefined()
    expect(Array.from(new Uint8Array(await result.file.arrayBuffer()))).toStrictEqual(Array.from(plaintext))
  })

  it("writes files at the OPFS threshold to disk and returns a cleanup callback", async () => {
    const opfs = mockOPFS()
    const plaintext = new TextEncoder().encode("disk-backed encrypted text")
    const { encrypted, encodedKey } = await encryptedFixture(plaintext)

    const result = await decryptResponseToFile(
      responseFromChunks(encrypted, [3, 11]),
      CHUNKED_ENCRYPTION_SCHEME,
      encodedKey,
      { filename: "large.txt", type: "text/plain", opfsThreshold: plaintext.byteLength },
    )

    expect(opfs.close).toHaveBeenCalledTimes(1)
    expect(result.content).toBeUndefined()
    expect(new TextDecoder().decode(await result.file.arrayBuffer())).toStrictEqual("disk-backed encrypted text")
    expect(result.cleanup).toBeDefined()
    expect(result.deferCleanup).toBeDefined()
    await result.cleanup?.()
    expect(opfs.removeEntry).toHaveBeenCalledTimes(1)
  })

  it("rejects a key that does not match the encrypted stream", async () => {
    const plaintext = new TextEncoder().encode("secret")
    const { encrypted } = await encryptedFixture(plaintext)
    const wrongKey = await genKey(CHUNKED_ENCRYPTION_SCHEME)
    const encodedWrongKey = await encodeKey(wrongKey)

    await expect(
      decryptResponseToFile(
        responseFromChunks(encrypted, [encrypted.byteLength]),
        CHUNKED_ENCRYPTION_SCHEME,
        encodedWrongKey,
        { filename: "secret.txt", type: "text/plain" },
      ),
    ).rejects.toBeDefined()

    await expect(decodeKey(CHUNKED_ENCRYPTION_SCHEME, encodedWrongKey)).resolves.toBeDefined()
  })
})
