import { useCallback, useEffect, useState } from "react"
import { useErrorModal } from "../components/ErrorModal.js"
import { DisplayPasteView } from "./DisplayPasteView.js"
import { parseFilenameFromContentDisposition, parsePath } from "../../shared/parsers.js"
import { MAX_AUTO_FETCH_BYTES } from "../../shared/constants.js"
import { detectUtf8 } from "../../shared/encoding.js"
import type { MetaResponse, OriginalFileInfo } from "../../shared/interfaces.js"
import type { EncryptionScheme } from "../utils/encryption.js"
import { decodeKey, decrypt } from "../utils/encryption.js"

import "../style.css"
import "../styles/highlight-theme-light.css"
import "../styles/highlight-theme-dark.css"

interface InitialPasteState {
  pasteFile?: File
  pasteContentBuffer?: Uint8Array
  pasteLang?: string
  isFileBinary: boolean
  guessedEncoding: string | null
  isDecrypted: "not encrypted" | "encrypted" | "decrypted"
  metaFilename?: string
  originalFiles?: OriginalFileInfo[]
}

function getInitialPasteState(url: URL, name: string, ext: string | undefined, filename: string | undefined) {
  const initialData = window.__PASTE_DATA__
  if (!initialData) {
    return {
      isFileBinary: false,
      guessedEncoding: null,
      isDecrypted: "not encrypted",
    } satisfies InitialPasteState
  }

  const respBytes = Uint8Array.from(atob(initialData.content), (c) => c.charCodeAt(0))
  const scheme = initialData.metadata.encryptionScheme as EncryptionScheme | undefined
  const lang = url.searchParams.get("lang") || initialData.metadata.highlightLanguage
  const inferredFilename = filename || (ext && name + ext) || initialData.metadata.filename

  return {
    pasteFile: new File([respBytes], inferredFilename || name),
    pasteContentBuffer: respBytes,
    pasteLang: lang || undefined,
    isFileBinary: initialData.isBinary,
    guessedEncoding: initialData.guessedEncoding,
    isDecrypted: scheme ? "encrypted" : "not encrypted",
    metaFilename: initialData.metadata.filename,
    originalFiles: initialData.metadata.filenames,
  } satisfies InitialPasteState
}

function isMetaResponse(value: unknown): value is MetaResponse {
  return typeof value === "object" && value !== null && typeof (value as MetaResponse).sizeBytes === "number"
}

export function DisplayPaste({ config }: { config: Env }) {
  const url = new URL(location.toString())
  const { name, ext, filename } = parsePath(url.pathname)
  const pasteUrl = `/${name}`
  const [initialPasteState] = useState(() => getInitialPasteState(url, name, ext, filename))

  const [pasteFile, setPasteFile] = useState<File | undefined>(initialPasteState.pasteFile)
  const [pasteContentBuffer, setPasteContentBuffer] = useState<Uint8Array | undefined>(
    initialPasteState.pasteContentBuffer,
  )
  const [pasteLang, setPasteLang] = useState<string | undefined>(initialPasteState.pasteLang)
  const [isFileBinary, setFileBinary] = useState(initialPasteState.isFileBinary)
  const [guessedEncoding, setGuessedEncoding] = useState<string | null>(initialPasteState.guessedEncoding)
  const [isDecrypted, setDecrypted] = useState<"not encrypted" | "encrypted" | "decrypted">(
    initialPasteState.isDecrypted,
  )
  const [forceShowBinary, setForceShowBinary] = useState(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [pendingInfo, setPendingInfo] = useState<{
    sizeBytes: number | null
    rawUrl: string
    contentType: string | null
  } | null>(null)
  const [mediaInfo, setMediaInfo] = useState<{
    sizeBytes: number | null
    rawUrl: string
    contentType: string
  } | null>(null)
  const [metaFilename, setMetaFilename] = useState<string | undefined>(initialPasteState.metaFilename)
  const [originalFiles, setOriginalFiles] = useState<OriginalFileInfo[] | undefined>(initialPasteState.originalFiles)

  const { ErrorModal, showModal, handleFailedResp } = useErrorModal()

  function parseContentLength(value: string | null): number | null {
    if (value === null) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  async function fetchMetadata(): Promise<MetaResponse | null> {
    try {
      const resp = await fetch(`/m/${name}`)
      if (!resp.ok) return null
      const metadata: unknown = await resp.json()
      return isMetaResponse(metadata) ? metadata : null
    } catch (e) {
      console.warn(`Failed to fetch metadata for ${name}`, e)
      return null
    }
  }

  function applyMetadata(metadata: MetaResponse | null, hasHeadFilename = false) {
    if (!metadata) return
    if (!hasHeadFilename && metadata.filename) setMetaFilename(metadata.filename)
    if (metadata.filenames) setOriginalFiles(metadata.filenames)
  }

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
    if (window.__PASTE_DATA__) {
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
        const contentLength = parseContentLength(headResp.headers.get("Content-Length"))
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

        const shouldAwaitMetadata = contentLength === null
        const metadataPromise = fetchMetadata()
        const metadata = shouldAwaitMetadata ? await metadataPromise : null
        applyMetadata(metadata, !!metaFilenameFromHead)
        if (!shouldAwaitMetadata) {
          void metadataPromise.then((metadata) => applyMetadata(metadata, true))
        }

        const sizeBytes = contentLength ?? metadata?.sizeBytes ?? null

        const isText = effectiveContentType?.startsWith("text/") || !!contentLang
        const isMedia =
          effectiveContentType?.startsWith("image/") ||
          effectiveContentType?.startsWith("audio/") ||
          effectiveContentType?.startsWith("video/") ||
          false
        const sizeOk = sizeBytes !== null && sizeBytes < MAX_AUTO_FETCH_BYTES

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
            sizeBytes,
            rawUrl: pasteUrl,
            contentType: effectiveContentType!,
          })
          return
        }
        setPendingInfo({
          sizeBytes,
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
        originalFiles={originalFiles}
        onLoadAnyway={() => void fetchPasteBody()}
      />
      <ErrorModal />
    </>
  )
}
