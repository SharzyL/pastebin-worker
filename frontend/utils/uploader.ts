import type { PasteSetting } from "../components/PasteSettingPanel.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { ErrorWithTitle, verifyFileSize } from "./utils.js"
import type { OriginalFileInfo, PasteResponse } from "../../shared/interfaces.js"
import type { EncryptionScheme } from "./encryption.js"
import { encodeKey, encrypt, genKey } from "./encryption.js"
import type { UploadOptions } from "../../shared/uploadPaste.js"
import { UploadError, uploadMPU, uploadNormal } from "../../shared/uploadPaste.js"
import { DEFAULT_EDIT_FILENAME } from "../../shared/constants.js"
import { zipSync } from "fflate"

async function genAndEncrypt(scheme: EncryptionScheme, content: string | Uint8Array) {
  const key = await genKey(scheme)
  const plaintext = typeof content === "string" ? new TextEncoder().encode(content) : content
  const ciphertext = await encrypt(scheme, key, plaintext)
  return { key: await encodeKey(key), ciphertext }
}

const encryptionScheme: EncryptionScheme = "AES-GCM"

const mpuChunkSize = 5 * 1024 * 1024
const mpuThreshold = 5 * 1024 * 1024

export interface UploadProgress {
  doneBytes: number
  totalBytes: number
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

async function zipFiles(files: File[]): Promise<File> {
  const entries: Record<string, Uint8Array> = {}
  const names = new Set<string>()
  for (const file of files) {
    entries[zipEntryName(file, names)] = await file.bytes()
  }
  const zipped = zipSync(entries)
  return new File([zipped], `${files.length}-files-${zipFilenameDate()}.zip`, { type: "application/zip" })
}

function zipFilenameDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export async function uploadPaste(
  pasteSetting: PasteSetting,
  editorState: PasteEditState,
  onEncryptionKeyChange: (k: string | undefined) => void, // we only generate key on upload, so need a callback of key generation
  config: Env,
  onProgress?: (progress: UploadProgress | undefined) => void,
  signal?: AbortSignal,
): Promise<PasteResponse> {
  let originalFiles: OriginalFileInfo[] | undefined

  async function constructContent(): Promise<File> {
    if (editorState.editKind === "file") {
      if (editorState.files.length === 0) {
        throw new ErrorWithTitle("Error on Preparing Upload", "No file selected")
      }
      originalFiles =
        editorState.files.length > 1
          ? editorState.files.map((file) => ({ name: file.name, sizeBytes: file.size }))
          : undefined
      const contentFile = editorState.files.length === 1 ? editorState.files[0] : await zipFiles(editorState.files)
      if (pasteSetting.doEncrypt) {
        const { key, ciphertext } = await genAndEncrypt(encryptionScheme, await contentFile.bytes())
        const file = new File([ciphertext as BlobPart], contentFile.name)
        onEncryptionKeyChange(key)
        return file
      } else {
        onEncryptionKeyChange(undefined)
        return contentFile
      }
    } else {
      if (editorState.editContent.length === 0) {
        throw new ErrorWithTitle("Error on Preparing Upload", "Empty paste")
      }
      if (pasteSetting.doEncrypt) {
        const { key, ciphertext } = await genAndEncrypt(encryptionScheme, editorState.editContent)
        onEncryptionKeyChange(key)
        return new File([ciphertext as BlobPart], editorState.editFilename || DEFAULT_EDIT_FILENAME)
      } else {
        onEncryptionKeyChange(undefined)
        return new File([editorState.editContent], editorState.editFilename || DEFAULT_EDIT_FILENAME)
      }
    }
  }

  const content = await constructContent()
  const [contentSizeOk, contentSizeMsg] = verifyFileSize(content.size, config)
  if (!contentSizeOk) {
    throw new ErrorWithTitle("Error on Preparing Upload", contentSizeMsg)
  }

  const options: UploadOptions = {
    content,
    filenames: originalFiles,
    isUpdate: pasteSetting.uploadKind === "manage",
    isPrivate: pasteSetting.uploadKind === "long",
    password: pasteSetting.password.length ? pasteSetting.password : undefined,
    expire: pasteSetting.expiration,
    name: pasteSetting.uploadKind === "custom" ? pasteSetting.name : undefined,
    highlightLanguage: editorState.editKind === "edit" ? editorState.editHighlightLang : undefined,
    encryptionScheme: pasteSetting.doEncrypt ? encryptionScheme : undefined,
    manageUrl: pasteSetting.manageUrl,
  }

  const contentLength = options.content.size
  const reportProgress = (doneBytes: number, totalBytes: number) => {
    if (onProgress) onProgress({ doneBytes, totalBytes })
  }

  try {
    if (onProgress) onProgress({ doneBytes: 0, totalBytes: contentLength })
    if (contentLength <= mpuThreshold) {
      return await uploadNormal(config.DEPLOY_URL, options, reportProgress, signal)
    } else {
      return await uploadMPU(config.DEPLOY_URL, mpuChunkSize, options, reportProgress, undefined, signal)
    }
  } catch (e) {
    if (e instanceof UploadError) {
      throw new ErrorWithTitle("Error on Upload", e.message)
    }
    throw e
  } finally {
    if (onProgress) onProgress(undefined)
  }
}
