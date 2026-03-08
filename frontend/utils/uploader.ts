import type { PasteSetting } from "../components/PasteSettingPanel.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { ErrorWithTitle } from "./utils.js"
import type { PasteResponse } from "../../shared/interfaces.js"
import type { EncryptionScheme } from "./encryption.js"
import { encodeKey, encrypt, genKey } from "./encryption.js"
import type { UploadOptions } from "../../shared/uploadPaste.js"
import { UploadError, uploadMPU, uploadNormal } from "../../shared/uploadPaste.js"

async function genAndEncrypt(scheme: EncryptionScheme, content: string | Uint8Array) {
  const key = await genKey(scheme)
  const plaintext = typeof content === "string" ? new TextEncoder().encode(content) : content
  const ciphertext = await encrypt(scheme, key, plaintext)
  return { key: await encodeKey(key), ciphertext }
}

const encryptionScheme: EncryptionScheme = "AES-GCM"

const minChunkSize = 5 * 1024 * 1024

export async function uploadPaste(
  pasteSetting: PasteSetting,
  editorState: PasteEditState,
  onEncryptionKeyChange: (k: string | undefined) => void, // we only generate key on upload, so need a callback of key generation
  config: Env,
  onProgress?: (progress: number | undefined) => void,
): Promise<PasteResponse> {
  async function constructContent(): Promise<File> {
    if (editorState.editKind === "file") {
      if (editorState.file === null) {
        throw new ErrorWithTitle("Error on Preparing Upload", "No file selected")
      }
      if (pasteSetting.doEncrypt) {
        const { key, ciphertext } = await genAndEncrypt(encryptionScheme, await editorState.file.bytes())
        const file = new File([ciphertext as BlobPart], editorState.file.name)
        onEncryptionKeyChange(key)
        return file
      } else {
        onEncryptionKeyChange(undefined)
        return editorState.file
      }
    } else {
      if (editorState.editContent.length === 0) {
        throw new ErrorWithTitle("Error on Preparing Upload", "Empty paste")
      }
      if (pasteSetting.doEncrypt) {
        const { key, ciphertext } = await genAndEncrypt(encryptionScheme, editorState.editContent)
        onEncryptionKeyChange(key)
        return new File([ciphertext as BlobPart], editorState.editFilename || "")
      } else {
        onEncryptionKeyChange(undefined)
        return new File([editorState.editContent], editorState.editFilename || "")
      }
    }
  }

  const options: UploadOptions = {
    content: await constructContent(),
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

  try {
    if (contentLength < 5 * 1024 * 1024) {
      return await uploadNormal(config.DEPLOY_URL, options)
    } else {
      if (onProgress) onProgress(0)
      return await uploadMPU(config.DEPLOY_URL, minChunkSize, options, (doneBytes, allBytes) => {
        if (onProgress) onProgress((100 * doneBytes) / allBytes)
      })
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
