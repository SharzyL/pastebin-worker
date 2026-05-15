import { useCallback, useEffect, useState } from "react"
import { useErrorModal } from "../components/ErrorModal.js"
import { DisplayPasteView } from "./DisplayPasteView.js"
import { parseFilenameFromContentDisposition, parsePath } from "../../shared/parsers.js"
import { MAX_AUTO_FETCH_BYTES } from "../../shared/constants.js"
import { detectUtf8 } from "../../shared/encoding.js"
import type { EncryptionScheme } from "../utils/encryption.js"
import { decodeKey, decrypt } from "../utils/encryption.js"

import "../style.css"
import "../styles/highlight-theme-light.css"
import "../styles/highlight-theme-dark.css"

export function DisplayPaste({ config }: { config: Env }) {
  const [pasteFile, setPasteFile] = useState<File | undefined>(undefined)
  const [pasteContentBuffer, setPasteContentBuffer] = useState<Uint8Array | undefined>(undefined)
  const [pasteLang, setPasteLang] = useState<string | undefined>(undefined)
  const [isFileBinary, setFileBinary] = useState(false)
  const [guessedEncoding, setGuessedEncoding] = useState<string | null>(null)
  const [isDecrypted, setDecrypted] = useState<"not encrypted" | "encrypted" | "decrypted">("not encrypted")
  const [forceShowBinary, setForceShowBinary] = useState(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [pendingInfo, setPendingInfo] = useState<{
    sizeBytes: number
    rawUrl: string
    contentType: string | null
  } | null>(null)
  const [mediaInfo, setMediaInfo] = useState<{
    sizeBytes: number
    rawUrl: string
    contentType: string
  } | null>(null)
  const [metaFilename, setMetaFilename] = useState<string | undefined>(undefined)

  const { ErrorModal, showModal, handleFailedResp } = useErrorModal()
  const url = new URL(location.toString())
  const { name, ext, filename } = parsePath(url.pathname)
  const pasteUrl = `/${name}`

  const fetchPasteBody = useCallback(async () => {
    setIsLoading(true)
    setPendingInfo(null)
    setMediaInfo(null)
    try {
      const resp = await fetch(pasteUrl)
      if (!resp.ok) {
        await handleFailedResp("Failed to Fetch Paste", resp)
        return
      }
      const scheme: EncryptionScheme | null = resp.headers.get("X-PB-Encryption-Scheme") as EncryptionScheme | null
      let filenameFromDisp = resp.headers.has("Content-Disposition")
        ? parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")!) || undefined
        : undefined
      if (filenameFromDisp && scheme !== null) {
        filenameFromDisp = filenameFromDisp.replace(/\.encrypted$/, "")
      }
      const lang = url.searchParams.get("lang") || resp.headers.get("X-PB-Highlight-Language")
      const inferredFilename = filename || (ext && name + ext) || filenameFromDisp
      const decryptedContentType = resp.headers.get("X-PB-Decrypted-Content-Type")
      const blobMime = (scheme ? decryptedContentType : resp.headers.get("Content-Type"))?.split(";")[0]?.trim() || ""
      const respBytes = await resp.bytes()
      setPasteLang(lang || undefined)
      if (filenameFromDisp) setMetaFilename(filenameFromDisp)

      const keyString = url.hash.slice(1)
      if (scheme === null || keyString.length === 0) {
        setPasteFile(new File([respBytes as BlobPart], inferredFilename || name, { type: blobMime }))
        setPasteContentBuffer(respBytes)
        if (scheme) {
          setDecrypted("encrypted")
          setFileBinary(true)
        } else {
          const encoding = detectUtf8(respBytes)
          setFileBinary(encoding === null)
          setGuessedEncoding(encoding)
        }
      } else {
        let key: CryptoKey
        try {
          key = await decodeKey(scheme, keyString)
        } catch (err) {
          showModal("Invalid decryption key", (err as Error).message)
          return
        }
        const decrypted = await decrypt(scheme, key, respBytes)
        if (!decrypted) {
          showModal(
            "Decryption failed",
            "Could not decrypt the paste with the provided key. The URL fragment may be wrong, " +
              "or the paste has been replaced or corrupted.",
          )
          return
        }
        setPasteFile(new File([decrypted as BlobPart], inferredFilename || name, { type: blobMime }))
        setPasteContentBuffer(decrypted)
        const encoding = detectUtf8(decrypted)
        setFileBinary(encoding === null)
        setDecrypted("decrypted")
        setGuessedEncoding(encoding)
      }
    } catch (e) {
      showModal(`Error on fetching ${pasteUrl}`, (e as Error).toString())
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }, [pasteUrl, name, ext, filename])

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
      if (initialData.metadata.filename) setMetaFilename(initialData.metadata.filename)
      return
    }

    void (async () => {
      setIsLoading(true)
      try {
        const headResp = await fetch(pasteUrl, { method: "HEAD" })
        if (!headResp.ok) {
          await handleFailedResp(`Error on Fetching ${pasteUrl}`, headResp)
          return
        }
        const contentType = headResp.headers.get("Content-Type")
        const contentLengthRaw = headResp.headers.get("Content-Length")
        const contentLength = contentLengthRaw === null ? NaN : Number(contentLengthRaw)
        const contentLang = headResp.headers.get("X-PB-Highlight-Language")
        const scheme = headResp.headers.get("X-PB-Encryption-Scheme") as EncryptionScheme | null
        const decryptedContentType = headResp.headers.get("X-PB-Decrypted-Content-Type")
        const contentDisp = headResp.headers.get("Content-Disposition")
        const isEncrypted = scheme !== null
        const effectiveContentType = isEncrypted ? decryptedContentType : contentType

        let metaFilenameFromHead = contentDisp
          ? parseFilenameFromContentDisposition(contentDisp) || undefined
          : undefined
        if (metaFilenameFromHead && isEncrypted) {
          metaFilenameFromHead = metaFilenameFromHead.replace(/\.encrypted$/, "")
        }
        if (metaFilenameFromHead) setMetaFilename(metaFilenameFromHead)

        const isText = effectiveContentType?.startsWith("text/") || !!contentLang
        const isMedia =
          effectiveContentType?.startsWith("image/") ||
          effectiveContentType?.startsWith("audio/") ||
          effectiveContentType?.startsWith("video/") ||
          false
        const sizeOk = Number.isFinite(contentLength) && contentLength < MAX_AUTO_FETCH_BYTES

        // text and encrypted media both need a GET + (maybe) decrypt before
        // rendering, so they share fetchPasteBody. Plain media can be rendered
        // directly via raw URL without downloading bytes through JS.
        if (isText && sizeOk) {
          await fetchPasteBody()
          return
        }
        if (isMedia && isEncrypted && sizeOk) {
          await fetchPasteBody()
          return
        }
        if (isMedia && !isEncrypted) {
          setMediaInfo({
            sizeBytes: Number.isFinite(contentLength) ? contentLength : 0,
            rawUrl: pasteUrl,
            contentType: effectiveContentType!,
          })
          return
        }
        setPendingInfo({
          sizeBytes: Number.isFinite(contentLength) ? contentLength : 0,
          rawUrl: pasteUrl,
          contentType: effectiveContentType,
        })
      } catch (e) {
        showModal(`Error on Fetching ${pasteUrl}`, (e as Error).toString())
        console.error(e)
      } finally {
        setIsLoading(false)
      }
    })()
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
        pendingInfo={pendingInfo}
        mediaInfo={mediaInfo}
        metaFilename={metaFilename}
        onLoadAnyway={() => void fetchPasteBody()}
      />
      <ErrorModal />
    </>
  )
}
