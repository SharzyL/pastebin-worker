import { beforeEach, describe, expect, it, vi } from "vitest"
import { unzipSync } from "fflate"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import type { PasteSetting } from "../components/PasteSettingPanel.js"
import type { PasteResponse } from "../../shared/interfaces.js"
import type { UploadOptions } from "../../shared/uploadPaste.js"

const uploadMocks = vi.hoisted(() => ({
  uploadNormal: vi.fn(),
  uploadMPU: vi.fn(),
}))

vi.mock("../../shared/uploadPaste.js", () => ({
  UploadError: class UploadError extends Error {},
  uploadNormal: uploadMocks.uploadNormal,
  uploadMPU: uploadMocks.uploadMPU,
}))

import { uploadPaste } from "../utils/uploader.js"

const config = {
  DEPLOY_URL: "https://example.com",
  R2_MAX_ALLOWED: "10M",
} as Env

const pasteSetting: PasteSetting = {
  uploadKind: "short",
  expiration: "",
  password: "",
  name: "",
  manageUrl: "",
  doEncrypt: false,
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

function textEditorState(content: string): PasteEditState {
  return {
    editKind: "edit",
    editContent: content,
    files: [],
    editHighlightLang: "plaintext",
  }
}

function firstUploadOptions(): UploadOptions {
  const calls = uploadMocks.uploadNormal.mock.calls as unknown as [string, UploadOptions][]
  return calls[0][1]
}

describe("uploadPaste", () => {
  beforeEach(() => {
    uploadMocks.uploadNormal.mockReset()
    uploadMocks.uploadMPU.mockReset()
    uploadMocks.uploadNormal.mockResolvedValue(uploadResponse())
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

  it("stores empty folders as zero-byte trailing-slash zip entries", async () => {
    const emptyFolder = new File([new Uint8Array(0)], "parent-dir/sub-dir/another-empty/")

    await uploadPaste(pasteSetting, fileEditorState([emptyFolder]), vi.fn(), config)

    const options = firstUploadOptions()
    expect(options.filenames).toStrictEqual([{ name: "parent-dir/sub-dir/another-empty/", sizeBytes: 0 }])

    const unzipped = unzipSync(new Uint8Array(await options.content.arrayBuffer()))
    expect(unzipped["parent-dir/sub-dir/another-empty/"]).toHaveLength(0)
  })

  it("does not infer mimeType for edit tab uploads", async () => {
    await uploadPaste(pasteSetting, textEditorState("hello"), vi.fn(), config)

    const options = firstUploadOptions()
    expect(options.inferMimeType).toStrictEqual(false)
  })
})
