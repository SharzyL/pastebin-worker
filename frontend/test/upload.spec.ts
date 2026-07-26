import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { unzipSync, zipSync } from "fflate"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import type { PasteSetting } from "../components/PasteSettingPanel.js"
import type { PasteResponse, PublicEnv } from "../../shared/interfaces.js"
import type { MPUUploadSource, UploadOptions } from "../../shared/uploadPaste.js"
import {
  DEFAULT_EDIT_FILENAME,
  DIRECT_UPLOAD_MAX_BYTES,
  TEXT_MIME_TYPE,
  ZIP_MEMORY_THRESHOLD_BYTES,
} from "../../shared/constants.js"
import { estimateArchiveSize, zipFiles } from "../utils/archive.js"
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "../utils/archiveCore.js"
import { prepareContent } from "../utils/content.js"
import { decodeKey, decrypt } from "../utils/encryption.js"
import {
  CHUNKED_ENCRYPTION_SCHEME,
  ENCRYPTION_CHUNK_SIZE,
  ENCRYPTION_HEADER_SIZE,
  ENCRYPTION_TAG_SIZE,
  firstEncryptionChunkSize,
} from "../utils/encryptionCore.js"
import { validatePasteSetting } from "../utils/pasteSetting.js"

const uploadMocks = vi.hoisted(() => ({
  uploadNormal: vi.fn(),
  uploadMPU: vi.fn(),
  uploadMPUSource: vi.fn(),
}))

vi.mock("../../shared/uploadPaste.js", () => ({
  UploadError: class UploadError extends Error {},
  uploadNormal: uploadMocks.uploadNormal,
  uploadMPU: uploadMocks.uploadMPU,
  uploadMPUSource: uploadMocks.uploadMPUSource,
}))

import { uploadPaste } from "../utils/uploader.js"

function mockOPFS(onWrite?: () => void) {
  const storedParts: BlobPart[] = []
  const write = vi.fn((data: FileSystemWriteChunkType) => {
    storedParts.push(data as unknown as BlobPart)
    onWrite?.()
    return Promise.resolve()
  })
  const close = vi.fn(() => Promise.resolve())
  const abort = vi.fn(() => Promise.resolve())
  const removeEntry = vi.fn(() => Promise.resolve())
  const getFileHandle = vi.fn((_name: string) =>
    Promise.resolve({
      createWritable: () => Promise.resolve({ write, close, abort }),
      getFile: () => Promise.resolve(new File(storedParts, "temporary.zip")),
    }),
  )
  const root = {
    async *entries() {
      await Promise.resolve()
      yield ["unrelated", { kind: "directory" } as FileSystemDirectoryHandle]
    },
    removeEntry,
    getFileHandle,
  } as unknown as FileSystemDirectoryHandle
  const getDirectory = vi.fn(() => Promise.resolve(root))
  vi.stubGlobal("navigator", {
    storage: {
      estimate: () => Promise.resolve({ quota: 512 * 1024 * 1024, usage: 0 }),
      getDirectory,
    },
  })
  return { abort, close, getDirectory, getFileHandle, removeEntry, write }
}

const config = {
  DEPLOY_URL: "https://example.com",
  R2_MAX_ALLOWED: "10M",
  DEFAULT_READS: 0,
} as Env

const pasteSetting: PasteSetting = {
  uploadKind: "short",
  isP2P: false,
  expiration: "",
  readLimit: "0",
  password: "",
  name: "",
  manageUrl: "",
  doEncrypt: false,
  verifyP2P: false,
}

const validationConfig = {
  ...config,
  MAX_EXPIRATION: "1d",
  MAX_P2P_EXPIRATION: "1h",
} as PublicEnv

const validationSetting: PasteSetting = {
  ...pasteSetting,
  expiration: "1h",
}

function uploadResponse(): PasteResponse {
  return {
    url: "https://example.com/abcd",
    manageUrl: "https://example.com/abcd:pw",
    expirationSeconds: 300,
    lastModifiedAt: "2025-04-30T23:55:00.000Z",
    createdAt: "2025-04-30T23:55:00.000Z",
    expireAt: "2025-05-01T00:00:00.000Z",
    sizeBytes: 1,
    location: "KV",
  }
}

function fileEditorState(files: File[]): PasteEditState {
  return {
    editKind: "file",
    editContent: "",
    files,
  }
}

function textEditorState(content: string, filename?: string): PasteEditState {
  return {
    editKind: "edit",
    editContent: content,
    editFilename: filename,
    files: [],
    editHighlightLang: "plaintext",
  }
}

function firstUploadOptions(): UploadOptions {
  const calls = uploadMocks.uploadNormal.mock.calls as unknown as [string, UploadOptions][]
  return calls[0][1]
}

describe("validatePasteSetting", () => {
  it("does not validate hidden custom-name and manage-URL fields", () => {
    const validation = validatePasteSetting(validationSetting, validationConfig)

    expect(validation.name[0]).toBe(true)
    expect(validation.manageUrl[0]).toBe(true)
    expect(validation.isValid).toBe(true)
  })

  it("validates the field selected by the URL kind", () => {
    expect(validatePasteSetting({ ...validationSetting, uploadKind: "custom" }, validationConfig).name[0]).toBe(false)
    expect(validatePasteSetting({ ...validationSetting, uploadKind: "manage" }, validationConfig).manageUrl[0]).toBe(
      false,
    )
    expect(
      validatePasteSetting(
        { ...validationSetting, uploadKind: "manage", manageUrl: "https://example.com/paste:password" },
        validationConfig,
      ).isValid,
    ).toBe(true)
  })

  it("uses P2P expiration and transfer validation while ignoring paste-only fields", () => {
    const validation = validatePasteSetting(
      {
        ...validationSetting,
        isP2P: true,
        expiration: "30m",
        readLimit: "2",
        password: "x",
        uploadKind: "manage",
      },
      validationConfig,
    )

    expect(validation.isValid).toBe(true)
    expect(validation.password[0]).toBe(true)
    expect(validatePasteSetting({ ...validationSetting, isP2P: true, readLimit: "-1" }, validationConfig).isValid).toBe(
      false,
    )
  })
})

describe("uploadPaste", () => {
  beforeEach(() => {
    uploadMocks.uploadNormal.mockReset()
    uploadMocks.uploadMPU.mockReset()
    uploadMocks.uploadMPUSource.mockReset()
    uploadMocks.uploadNormal.mockResolvedValue(uploadResponse())
    uploadMocks.uploadMPUSource.mockResolvedValue(uploadResponse())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("zips a single file with a relative path and keeps filenames metadata", async () => {
    const file = new File([new TextEncoder().encode("Hello")], "normal-folder/file.txt")

    await uploadPaste(pasteSetting, fileEditorState([file]), vi.fn(), config)

    expect(uploadMocks.uploadNormal).toHaveBeenCalledTimes(1)
    const options = firstUploadOptions()
    expect(options.inferMimeType).toStrictEqual(true)
    expect(options.filenames).toStrictEqual([{ name: "normal-folder/file.txt", sizeBytes: 5 }])
    expect(options.content).toBeInstanceOf(File)
    expect(options.content.name).toMatch(/^1-item-\d{4}-\d{2}-\d{2}\.zip$/)

    const unzipped = unzipSync(new Uint8Array(await options.content.arrayBuffer()))
    expect(new TextDecoder().decode(unzipped["normal-folder/file.txt"])).toStrictEqual("Hello")
  })

  it("removes an OPFS-backed archive after upload completes", async () => {
    const opfs = mockOPFS()
    const largeFile = {
      name: "folder/large.jpg",
      size: ZIP_MEMORY_THRESHOLD_BYTES,
      type: "image/jpeg",
      slice: () => new Blob([new Uint8Array([1])]),
    } as File

    await uploadPaste(pasteSetting, fileEditorState([largeFile]), vi.fn(), config)

    expect(opfs.write).toHaveBeenCalled()
    expect(opfs.close).toHaveBeenCalledTimes(1)
    expect(opfs.abort).not.toHaveBeenCalled()
    expect(opfs.removeEntry).toHaveBeenCalledTimes(1)
  })

  it("stores empty folders as zero-byte trailing-slash zip entries", async () => {
    const emptyFolder = new File([new Uint8Array(0)], "parent-dir/sub-dir/another-empty/")

    await uploadPaste(pasteSetting, fileEditorState([emptyFolder]), vi.fn(), config)

    const options = firstUploadOptions()
    expect(options.filenames).toStrictEqual([{ name: "parent-dir/sub-dir/another-empty/", sizeBytes: 0 }])

    const unzipped = unzipSync(new Uint8Array(await options.content.arrayBuffer()))
    expect(unzipped["parent-dir/sub-dir/another-empty/"]).toHaveLength(0)
  })

  it("stores already-compressed files without running DEFLATE again", async () => {
    const image = new File([new Uint8Array([1, 2, 3, 4])], "photos/image.jpg", { type: "image/jpeg" })

    await uploadPaste(pasteSetting, fileEditorState([image]), vi.fn(), config)

    const zipBytes = new Uint8Array(await firstUploadOptions().content.arrayBuffer())
    expect(new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength).getUint16(8, true)).toStrictEqual(0)
    expect(Array.from(unzipSync(zipBytes)["photos/image.jpg"])).toStrictEqual([1, 2, 3, 4])
  })

  it("does not infer mimeType for edit tab uploads", async () => {
    await uploadPaste(pasteSetting, textEditorState("hello"), vi.fn(), config)

    const options = firstUploadOptions()
    expect(options.inferMimeType).toStrictEqual(false)
  })

  it("cancels archive preparation before starting an upload", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      uploadPaste(
        pasteSetting,
        fileEditorState([new File(["one"], "one.txt"), new File(["two"], "two.txt")]),
        vi.fn(),
        config,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(uploadMocks.uploadNormal).not.toHaveBeenCalled()
  })

  it("passes the current reads setting, including unlimited reads", async () => {
    await uploadPaste({ ...pasteSetting, readLimit: "0" }, textEditorState("hello"), vi.fn(), config)

    expect(firstUploadOptions().remainingReads).toStrictEqual(0)
  })

  it("encrypts a small paste in the chunked container before normal upload", async () => {
    let encodedKey: string | undefined
    await uploadPaste(
      { ...pasteSetting, doEncrypt: true },
      textEditorState("encrypted hello"),
      (key) => (encodedKey = key),
      config,
    )

    const options = firstUploadOptions()
    expect(options.encryptionScheme).toStrictEqual(CHUNKED_ENCRYPTION_SCHEME)
    const key = await decodeKey(CHUNKED_ENCRYPTION_SCHEME, encodedKey!)
    const decrypted = await decrypt(CHUNKED_ENCRYPTION_SCHEME, key, new Uint8Array(await options.content.arrayBuffer()))
    expect(new TextDecoder().decode(decrypted!)).toStrictEqual("encrypted hello")
  })

  it("uses MPU when encryption overhead pushes a single plaintext chunk over the direct-upload limit", async () => {
    const plaintextSize = DIRECT_UPLOAD_MAX_BYTES - ENCRYPTION_HEADER_SIZE - ENCRYPTION_TAG_SIZE + 1
    const file = new File([new Uint8Array(plaintextSize)], "boundary.bin")

    await uploadPaste({ ...pasteSetting, doEncrypt: true }, fileEditorState([file]), vi.fn(), config)

    expect(uploadMocks.uploadNormal).not.toHaveBeenCalled()
    expect(uploadMocks.uploadMPUSource).toHaveBeenCalledTimes(1)
    const source = uploadMocks.uploadMPUSource.mock.calls[0][1] as MPUUploadSource
    expect(source.size).toStrictEqual(DIRECT_UPLOAD_MAX_BYTES + 1)
    expect(source.partCount).toStrictEqual(2)
  })

  it("reframes encrypted bytes into equal-sized non-final MPU parts", async () => {
    const plaintextSize = firstEncryptionChunkSize() * 2 + 1
    const file = new File([new Uint8Array(plaintextSize)], "large.bin")
    const slice = vi.spyOn(file, "slice")
    let encodedKey: string | undefined
    const uploadedParts: Blob[] = []
    let readsStartedAfterFirstUploadPart = 0
    uploadMocks.uploadMPUSource.mockImplementation(async (_apiUrl, source: MPUUploadSource) => {
      const signal = new AbortController().signal
      for (let index = 0; index < source.partCount; index += 1) {
        uploadedParts.push(await source.getPart(index, signal))
        if (index === 0) readsStartedAfterFirstUploadPart = slice.mock.calls.length
      }
      return uploadResponse()
    })

    await uploadPaste({ ...pasteSetting, doEncrypt: true }, fileEditorState([file]), (key) => (encodedKey = key), {
      ...config,
      R2_MAX_ALLOWED: "20M",
    })

    expect(uploadMocks.uploadNormal).not.toHaveBeenCalled()
    expect(uploadMocks.uploadMPUSource).toHaveBeenCalledTimes(1)
    const source = uploadMocks.uploadMPUSource.mock.calls[0][1] as MPUUploadSource
    expect(source.partCount).toStrictEqual(3)
    expect(readsStartedAfterFirstUploadPart).toBeGreaterThanOrEqual(2)
    const [first, second, last] = uploadedParts
    expect(first.size).toStrictEqual(ENCRYPTION_CHUNK_SIZE)
    expect(second.size).toStrictEqual(ENCRYPTION_CHUNK_SIZE)
    expect(last.size).toStrictEqual(ENCRYPTION_HEADER_SIZE + 3 * ENCRYPTION_TAG_SIZE + 1)

    const key = await decodeKey(CHUNKED_ENCRYPTION_SCHEME, encodedKey!)
    const encrypted = new Uint8Array(await new Blob([first, second, last]).arrayBuffer())
    const decrypted = await decrypt(CHUNKED_ENCRYPTION_SCHEME, key, encrypted)
    expect(decrypted?.byteLength).toStrictEqual(plaintextSize)
  })
})

describe("prepareContent", () => {
  it("creates a UTF-8 text file with the configured or default filename", async () => {
    const named = await prepareContent(textEditorState("hello", "note.txt"))
    const unnamed = await prepareContent(textEditorState("hello"))

    expect(named.content.name).toStrictEqual("note.txt")
    expect(named.content.type).toStrictEqual(TEXT_MIME_TYPE.toLowerCase())
    expect(await named.content.text()).toStrictEqual("hello")
    expect(named.originalFiles).toBeUndefined()
    expect(unnamed.content.name).toStrictEqual(DEFAULT_EDIT_FILENAME)
  })

  it("returns a single flat file without copying or archive metadata", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" })

    const prepared = await prepareContent(fileEditorState([file]))

    expect(prepared.content).toBe(file)
    expect(prepared.originalFiles).toBeUndefined()
  })

  it("zips multiple files and returns their original metadata", async () => {
    const files = [new File(["one"], "one.txt"), new File(["two"], "folder/two.txt")]

    const prepared = await prepareContent(fileEditorState(files))

    expect(prepared.originalFiles).toStrictEqual([
      { name: "one.txt", sizeBytes: 3 },
      { name: "folder/two.txt", sizeBytes: 3 },
    ])
    expect(prepared.content.type).toStrictEqual("application/zip")
    const archive = unzipSync(new Uint8Array(await prepared.content.arrayBuffer()))
    expect(new TextDecoder().decode(archive["one.txt"])).toStrictEqual("one")
    expect(new TextDecoder().decode(archive["folder/two.txt"])).toStrictEqual("two")
  })

  it("uses the caller's preparation title for validation errors", async () => {
    await expect(
      prepareContent(textEditorState(""), { errorTitle: "Error on Preparing P2P Share" }),
    ).rejects.toMatchObject({
      title: "Error on Preparing P2P Share",
      message: "Empty paste",
    })
    await expect(
      prepareContent(fileEditorState([]), { errorTitle: "Error on Preparing Upload" }),
    ).rejects.toMatchObject({
      title: "Error on Preparing Upload",
      message: "No file selected",
    })
  })

  it("honors cancellation before preparing content", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(prepareContent(textEditorState("hello"), { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
  })
})

describe("ZIP archive storage", () => {
  const files = [new File(["one"], "one.txt"), new File(["two"], "folder/two.txt")]

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps archives below the threshold in memory", async () => {
    const archive = await zipFiles(files, { opfsThreshold: Number.MAX_SAFE_INTEGER })

    expect(archive.cleanup).toBeUndefined()
    const entries = unzipSync(new Uint8Array(await archive.file.arrayBuffer()))
    expect(new TextDecoder().decode(entries["one.txt"])).toStrictEqual("one")
    expect(new TextDecoder().decode(entries["folder/two.txt"])).toStrictEqual("two")
  })

  it("uses one archive worker for every file in the ZIP", async () => {
    const instances: MockArchiveWorker[] = []

    class MockArchiveWorker {
      onmessage: ((event: MessageEvent<ArchiveWorkerResponse>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      onmessageerror: (() => void) | null = null
      readonly terminate = vi.fn()
      readonly startRequests: File[][] = []

      constructor() {
        instances.push(this)
      }

      postMessage(message: ArchiveWorkerRequest): void {
        if (message.type === "chunk-ack") {
          const response: ArchiveWorkerResponse = { type: "complete" }
          queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<ArchiveWorkerResponse>))
          return
        }

        this.startRequests.push(message.files)
        void (async () => {
          const entries: Record<string, Uint8Array> = {}
          for (const file of message.files) entries[file.name] = new Uint8Array(await file.arrayBuffer())
          const archive = zipSync(entries)
          const data = archive.slice().buffer
          const response: ArchiveWorkerResponse = { type: "chunk", id: 1, data }
          queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<ArchiveWorkerResponse>))
        })()
      }
    }

    vi.stubGlobal("Worker", MockArchiveWorker)
    const workerFiles = Array.from({ length: 5 }, (_, index) => new File([`file-${index}`], `file-${index}.txt`))
    const archive = await zipFiles(workerFiles, { opfsThreshold: Number.MAX_SAFE_INTEGER })

    expect(instances).toHaveLength(1)
    expect(instances[0].startRequests).toHaveLength(1)
    expect(instances[0].startRequests[0]).toStrictEqual(workerFiles)
    expect(instances[0].terminate).toHaveBeenCalledTimes(1)
    const entries = unzipSync(new Uint8Array(await archive.file.arrayBuffer()))
    expect(Object.keys(entries)).toStrictEqual(workerFiles.map((file) => file.name))
  })

  it("streams archives above the threshold into OPFS and exposes cleanup", async () => {
    const opfs = mockOPFS()
    const archive = await zipFiles(files, { opfsThreshold: 1 })

    expect(opfs.getDirectory).toHaveBeenCalledTimes(1)
    expect(opfs.getFileHandle.mock.calls[0][0]).toMatch(/^paste-archive-/)
    expect(opfs.write.mock.calls.length).toBeGreaterThan(1)
    expect(opfs.close).toHaveBeenCalledTimes(1)
    expect(opfs.abort).not.toHaveBeenCalled()

    const entries = unzipSync(new Uint8Array(await archive.file.arrayBuffer()))
    expect(new TextDecoder().decode(entries["one.txt"])).toStrictEqual("one")
    expect(new TextDecoder().decode(entries["folder/two.txt"])).toStrictEqual("two")

    await archive.cleanup?.()
    expect(opfs.removeEntry).toHaveBeenCalledTimes(1)
  })

  it("uses source size plus per-entry overhead for the pre-compression estimate", () => {
    expect(estimateArchiveSize(files)).toStrictEqual(files[0].size + files[1].size + 2 * 1024)
  })

  it("aborts and removes a partial OPFS archive when compression is cancelled", async () => {
    const controller = new AbortController()
    const opfs = mockOPFS(() => controller.abort())

    await expect(zipFiles(files, { opfsThreshold: 1, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(opfs.abort).toHaveBeenCalledTimes(1)
    expect(opfs.removeEntry).toHaveBeenCalledTimes(1)
  })

  it("falls back to memory when a large archive cannot use OPFS", async () => {
    vi.stubGlobal("navigator", { storage: {} })

    const archive = await zipFiles(files, { opfsThreshold: 1 })

    expect(archive.cleanup).toBeUndefined()
    const entries = unzipSync(new Uint8Array(await archive.file.arrayBuffer()))
    expect(new TextDecoder().decode(entries["one.txt"])).toStrictEqual("one")
    expect(new TextDecoder().decode(entries["folder/two.txt"])).toStrictEqual("two")
  })

  it("restarts in memory when OPFS runs out of space while writing", async () => {
    const opfs = mockOPFS()
    opfs.write.mockRejectedValueOnce(new DOMException("Storage quota exceeded", "QuotaExceededError"))

    const archive = await zipFiles(files, { opfsThreshold: 1 })

    expect(opfs.abort).toHaveBeenCalledTimes(1)
    expect(opfs.removeEntry).toHaveBeenCalledTimes(1)
    expect(archive.cleanup).toBeUndefined()
    const entries = unzipSync(new Uint8Array(await archive.file.arrayBuffer()))
    expect(new TextDecoder().decode(entries["one.txt"])).toStrictEqual("one")
    expect(new TextDecoder().decode(entries["folder/two.txt"])).toStrictEqual("two")
  })
})
