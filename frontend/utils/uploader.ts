import { PasteSetting } from "../components/PasteSettingPanel.js"
import { PasteEditState } from "../components/PasteEditor.js"
import { APIUrl, ErrorWithTitle, makeErrorMsg } from "./utils.js"
import { PasteResponse } from "../../shared/interfaces.js"
import { encodeKey, encrypt, EncryptionScheme, genKey } from "./encryption.js"

async function genAndEncrypt(scheme: EncryptionScheme, content: string | Uint8Array) {
  const key = await genKey(scheme)
  const plaintext = typeof content === "string" ? new TextEncoder().encode(content) : content
  const ciphertext = await encrypt(scheme, key, plaintext)
  return { key: await encodeKey(key), ciphertext }
}

const encryptionScheme: EncryptionScheme = "AES-GCM"

export async function uploadPaste(
  pasteSetting: PasteSetting,
  editorState: PasteEditState,
  onEncryptionKeyChange: (k: string) => void,
  onLoadingStateChange: (isLoading: boolean) => void,
): Promise<PasteResponse> {
  const fd = new FormData()
  if (editorState.editKind === "file") {
    if (editorState.file === null) {
      throw new ErrorWithTitle("Error on Preparing Upload", "No file selected")
    }
    if (pasteSetting.doEncrypt) {
      const { key, ciphertext } = await genAndEncrypt(encryptionScheme, await editorState.file.bytes())
      const file = new File([ciphertext], editorState.file.name)
      onEncryptionKeyChange(key)
      fd.append("c", file)
      fd.append("encryption-scheme", encryptionScheme)
    } else {
      fd.append("c", editorState.file)
    }
  } else {
    if (editorState.editContent.length === 0) {
      throw new ErrorWithTitle("Error on Preparing Upload", "Empty paste")
    }
    if (pasteSetting.doEncrypt) {
      const { key, ciphertext } = await genAndEncrypt(encryptionScheme, editorState.editContent)
      onEncryptionKeyChange(key)
      fd.append("c", new File([ciphertext], ""))
      fd.append("encryption-scheme", encryptionScheme)
    } else {
      fd.append("c", editorState.editContent)
    }
  }

  fd.append("e", pasteSetting.expiration)
  if (pasteSetting.password.length > 0) fd.append("s", pasteSetting.password)

  if (pasteSetting.uploadKind === "long") fd.append("p", "true")
  else if (pasteSetting.uploadKind === "custom") fd.append("n", pasteSetting.name)

  onLoadingStateChange(true)
  // setPasteResponse(null)
  const isUpdate = pasteSetting.uploadKind !== "manage"
  // TODO: add progress indicator
  const resp = isUpdate
    ? await fetch(APIUrl, {
        method: "POST",
        body: fd,
      })
    : await fetch(pasteSetting.manageUrl, {
        method: "PUT",
        body: fd,
      })
  if (resp.ok) {
    onLoadingStateChange(false)
    return JSON.parse(await resp.text()) as PasteResponse
  } else {
    throw new ErrorWithTitle("Error From Server", await makeErrorMsg(resp))
  }
}
