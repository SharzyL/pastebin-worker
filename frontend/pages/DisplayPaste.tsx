import { useEffect, useState } from "react"
import chardet from "chardet"
import { useErrorModal } from "../components/ErrorModal.js"
import { DisplayPasteView } from "./DisplayPasteView.js"
import { parseFilenameFromContentDisposition, parsePath } from "../../shared/parsers.js"
import type { EncryptionScheme } from "../utils/encryption.js"
import { decodeKey, decrypt } from "../utils/encryption.js"

import "../style.css"
import "../styles/highlight-theme-light.css"
import "../styles/highlight-theme-dark.css"

const utf8CompatibleEncodings = ["UTF-8", "ASCII", "ISO-8859-1"]

export function DisplayPaste({ config }: { config: Env }) {
  const [pasteFile, setPasteFile] = useState<File | undefined>(undefined)
  const [pasteContentBuffer, setPasteContentBuffer] = useState<Uint8Array | undefined>(undefined)
  const [pasteLang, setPasteLang] = useState<string | undefined>(undefined)
  const [isFileBinary, setFileBinary] = useState(false)
  const [guessedEncoding, setGuessedEncoding] = useState<string | null>(null)
  const [isDecrypted, setDecrypted] = useState<"not encrypted" | "encrypted" | "decrypted">("not encrypted")
  const [forceShowBinary, setForceShowBinary] = useState(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const { ErrorModal, showModal, handleFailedResp } = useErrorModal()
  const url = new URL(location.toString())
  const { name, ext, filename } = parsePath(url.pathname)

  useEffect(() => {
    const initialData = window.__PASTE_DATA__

    if (initialData) {
      const respBytes = Uint8Array.from(atob(initialData.content), (c) => c.charCodeAt(0))
      const scheme = initialData.metadata.encryptionScheme as EncryptionScheme | undefined
      const lang = url.searchParams.get("lang") || initialData.metadata.highlightLanguage
      const inferredFilename = filename || (ext && name + ext) || initialData.metadata.filename

      setPasteLang(lang || undefined)
      setPasteFile(new File([respBytes], inferredFilename || name))
      setPasteContentBuffer(respBytes)
      setFileBinary(initialData.isBinary)
      setGuessedEncoding(initialData.guessedEncoding)
      setDecrypted(scheme ? "encrypted" : "not encrypted")
    } else {
      const pasteUrl = `/${name}`
      setIsLoading(true)
      fetch(pasteUrl)
        .then(async (resp) => {
          if (!resp.ok) {
            await handleFailedResp("Failed to Fetch Paste", resp)
            return
          }
          const scheme: EncryptionScheme | null = resp.headers.get("X-PB-Encryption-Scheme") as EncryptionScheme | null
          let filenameFromDisp = resp.headers.has("Content-Disposition")
            ? parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")!) || undefined
            : undefined
          if (filenameFromDisp && scheme !== null) {
            filenameFromDisp = filenameFromDisp.replace(/.encrypted$/, "")
          }
          const lang = url.searchParams.get("lang") || resp.headers.get("X-PB-Highlight-Language")
          const inferredFilename = filename || (ext && name + ext) || filenameFromDisp
          const respBytes = await resp.bytes()
          setPasteLang(lang || undefined)

          const keyString = url.hash.slice(1)
          if (scheme === null || keyString.length === 0) {
            setPasteFile(new File([respBytes as BlobPart], inferredFilename || name))
            setPasteContentBuffer(respBytes)
            if (scheme) {
              setDecrypted("encrypted")
              setFileBinary(true)
            } else {
              const encoding = chardet.detect(respBytes)
              setFileBinary(encoding === null || !utf8CompatibleEncodings.includes(encoding))
              setGuessedEncoding(encoding)
            }
          } else {
            const key = await decodeKey(scheme, keyString)
            if (!key) {
              showModal("Error", `Failed to parse "${keyString}" as ${scheme} key`)
              return
            }
            const decrypted = await decrypt(scheme, key, respBytes)
            if (!decrypted) {
              showModal("Error", "Failed to decrypt content")
              return
            }
            setPasteFile(new File([decrypted as BlobPart], inferredFilename || name))
            setPasteContentBuffer(decrypted)
            const encoding = chardet.detect(decrypted)
            setFileBinary(encoding === null || !utf8CompatibleEncodings.includes(encoding))
            setDecrypted("decrypted")
            setGuessedEncoding(encoding)
          }
        })
        .catch((e) => {
          showModal(`Error on fetching ${pasteUrl}`, (e as Error).toString())
          console.error(e)
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }, [])

  return (
    <>
      <DisplayPasteView
        pasteFile={pasteFile}
        pasteContentBuffer={pasteContentBuffer}
        pasteLang={pasteLang}
        isFileBinary={isFileBinary}
        guessedEncoding={guessedEncoding}
        isDecrypted={isDecrypted}
        forceShowBinary={forceShowBinary}
        setForceShowBinary={setForceShowBinary}
        isLoading={isLoading}
        name={name}
        ext={ext}
        filename={filename}
        config={config}
      />
      <ErrorModal />
    </>
  )
}
