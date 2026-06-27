import { useCallback, useEffect, useRef, useState } from "react"
import { useErrorModal } from "../components/ErrorModal.js"
import { DisplayPasteView } from "./DisplayPasteView.js"
import { parseFilenameFromContentDisposition, parsePath } from "../../shared/parsers.js"
import { BINARY_MIME_TYPE, MAX_AUTO_FETCH_BYTES } from "../../shared/constants.js"
import { detectUtf8 } from "../../shared/encoding.js"
import type { MetaResponse, OriginalFileInfo } from "../../shared/interfaces.js"
import { parseReadLimit } from "../../shared/verify.js"
import type { EncryptionScheme } from "../utils/encryption.js"
import { decodeKey, decrypt } from "../utils/encryption.js"
import { removeLocalUpload } from "../utils/localUploads.js"

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

interface FetchedPasteFile {
  file: File
  content: Uint8Array
  filenameFromDisp?: string
  lang?: string
  scheme: EncryptionScheme | null
  didDecrypt: boolean
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

function stripEncryptedSuffix(filename: string | undefined): string | undefined {
  return filename?.replace(/\.encrypted$/, "")
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
  const [isDownloading, setIsDownloading] = useState<boolean>(false)
  const isFetchingBodyRef = useRef(false)
  const isDownloadingRef = useRef(false)
  const [pendingInfo, setPendingInfo] = useState<{
    sizeBytes: number | null
    rawUrl: string
    contentType: string | null
    isReadLimited?: boolean
  } | null>(null)
  const [mediaInfo, setMediaInfo] = useState<{
    sizeBytes: number | null
    rawUrl: string
    contentType: string
  } | null>(null)
  const [showExpiredNotice, setShowExpiredNotice] = useState(false)
  const expiredNoticeTimerRef = useRef<number | undefined>(undefined)
  const [metaFilename, setMetaFilename] = useState<string | undefined>(initialPasteState.metaFilename)
  const [originalFiles, setOriginalFiles] = useState<OriginalFileInfo[] | undefined>(initialPasteState.originalFiles)

  const { ErrorModal, showModal, handleFailedResp } = useErrorModal()

  useEffect(() => {
    return () => {
      if (expiredNoticeTimerRef.current !== undefined) {
        window.clearTimeout(expiredNoticeTimerRef.current)
      }
    }
  }, [])

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

  function triggerDownload(file: File) {
    const downloadBlob = file.type === BINARY_MIME_TYPE ? file : new Blob([file], { type: BINARY_MIME_TYPE })
    const url = URL.createObjectURL(downloadBlob)
    const link = document.createElement("a")
    link.href = url
    link.download = file.name
    link.style.display = "none"
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => {
      if (URL.revokeObjectURL) URL.revokeObjectURL(url)
    }, 0)
  }

  const removeLocalUploadIfConsumed = useCallback(
    (remainingReads: string | number | null | undefined) => {
      const parsed = parseReadLimit(remainingReads)
      if (parsed !== null && parsed <= 1) {
        removeLocalUpload(name)
        if (expiredNoticeTimerRef.current !== undefined) {
          window.clearTimeout(expiredNoticeTimerRef.current)
        }
        expiredNoticeTimerRef.current = window.setTimeout(() => {
          setShowExpiredNotice(true)
          expiredNoticeTimerRef.current = undefined
        }, 3000)
      }
    },
    [name],
  )

  const fetchPasteFile = useCallback(async (): Promise<FetchedPasteFile | null> => {
    try {
      const resp = await fetch(pasteUrl)
      if (!resp.ok) {
        await handleFailedResp("Failed to Fetch Paste", resp)
        return null
      }
      const scheme: EncryptionScheme | null = resp.headers.get("X-PB-Encryption-Scheme") as EncryptionScheme | null
      const remainingReads = resp.headers.get("X-PB-Remaining-Reads")
      let filenameFromDisp = resp.headers.has("Content-Disposition")
        ? parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")!) || undefined
        : undefined
      if (filenameFromDisp && scheme !== null) {
        filenameFromDisp = stripEncryptedSuffix(filenameFromDisp)
      }
      const lang = url.searchParams.get("lang") || resp.headers.get("X-PB-Highlight-Language")
      let metadataFilename = metaFilename
      if (!filename && !ext && !filenameFromDisp && !metadataFilename) {
        metadataFilename = stripEncryptedSuffix((await fetchMetadata())?.filename)
      }
      const inferredFilename = filename || (ext && name + ext) || filenameFromDisp || metadataFilename
      const decryptedContentType = resp.headers.get("X-PB-Decrypted-Content-Type")
      const blobMime = (scheme ? decryptedContentType : resp.headers.get("Content-Type"))?.split(";")[0]?.trim() || ""
      const respBytes = await resp.bytes()
      removeLocalUploadIfConsumed(remainingReads)

      const keyString = url.hash.slice(1)
      if (scheme === null || keyString.length === 0) {
        const file = new File([respBytes as BlobPart], inferredFilename || name, { type: blobMime })
        return { file, content: respBytes, filenameFromDisp, lang: lang || undefined, scheme, didDecrypt: false }
      }

      let key: CryptoKey
      try {
        key = await decodeKey(scheme, keyString)
      } catch (err) {
        showModal("Invalid decryption key", (err as Error).message)
        return null
      }
      const decrypted = await decrypt(scheme, key, respBytes)
      if (!decrypted) {
        showModal(
          "Decryption failed",
          "Could not decrypt the paste with the provided key. The URL fragment may be wrong, " +
            "or the paste has been replaced or corrupted.",
        )
        return null
      }
      const file = new File([decrypted as BlobPart], inferredFilename || name, { type: blobMime })
      return { file, content: decrypted, filenameFromDisp, lang: lang || undefined, scheme, didDecrypt: true }
    } catch (e) {
      showModal(`Error on fetching ${pasteUrl}`, (e as Error).toString())
      console.error(e)
      return null
    }
  }, [pasteUrl, name, ext, filename, metaFilename, removeLocalUploadIfConsumed])

  const fetchPasteBody = useCallback(async () => {
    if (isFetchingBodyRef.current) return
    isFetchingBodyRef.current = true
    setIsLoading(true)
    setPendingInfo(null)
    setMediaInfo(null)
    try {
      const paste = await fetchPasteFile()
      if (!paste) return

      setPasteLang(paste.lang)
      if (paste.filenameFromDisp) setMetaFilename(paste.filenameFromDisp)
      setPasteFile(paste.file)
      setPasteContentBuffer(paste.content)
      if (paste.scheme) {
        setDecrypted(paste.didDecrypt ? "decrypted" : "encrypted")
      }
      if (paste.scheme && !paste.didDecrypt) {
        setFileBinary(true)
      } else {
        const encoding = detectUtf8(paste.content)
        setFileBinary(encoding === null)
        setGuessedEncoding(encoding)
      }
    } finally {
      isFetchingBodyRef.current = false
      setIsLoading(false)
    }
  }, [fetchPasteFile])

  const downloadPasteBody = useCallback(async () => {
    if (isDownloadingRef.current) return
    isDownloadingRef.current = true
    setIsDownloading(true)
    try {
      const paste = await fetchPasteFile()
      if (paste) triggerDownload(paste.file)
    } finally {
      isDownloadingRef.current = false
      setIsDownloading(false)
    }
  }, [fetchPasteFile])

  useEffect(() => {
    if (window.__PASTE_DATA__) {
      removeLocalUploadIfConsumed(window.__PASTE_DATA__.metadata.remainingReads)
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
        const remainingReadsFromHead = headResp.headers.get("X-PB-Remaining-Reads")
        const isEncrypted = scheme !== null
        const effectiveContentType = isEncrypted ? decryptedContentType : contentType
        setDecrypted(isEncrypted ? "encrypted" : "not encrypted")

        let metaFilenameFromHead = contentDisp
          ? parseFilenameFromContentDisposition(contentDisp) || undefined
          : undefined
        if (metaFilenameFromHead && isEncrypted) {
          metaFilenameFromHead = stripEncryptedSuffix(metaFilenameFromHead)
        }
        if (metaFilenameFromHead) setMetaFilename(metaFilenameFromHead)

        const shouldAwaitMetadata = contentLength === null
        const metadataPromise = fetchMetadata()
        const metadata = shouldAwaitMetadata ? await metadataPromise : null
        applyMetadata(metadata, !!metaFilenameFromHead)
        if (!shouldAwaitMetadata) {
          void metadataPromise.then((metadata) => applyMetadata(metadata, !!metaFilenameFromHead))
        }

        const sizeBytes = contentLength ?? metadata?.sizeBytes ?? null
        const isReadLimited = remainingReadsFromHead !== null || metadata?.remainingReads !== undefined

        const isText = effectiveContentType?.startsWith("text/") || !!contentLang
        const isMedia =
          effectiveContentType?.startsWith("image/") ||
          effectiveContentType?.startsWith("audio/") ||
          effectiveContentType?.startsWith("video/") ||
          false
        const sizeOk = sizeBytes !== null && sizeBytes < MAX_AUTO_FETCH_BYTES

        if (isReadLimited) {
          setPendingInfo({
            sizeBytes,
            rawUrl: pasteUrl,
            contentType: effectiveContentType,
            isReadLimited,
          })
          return
        }

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
        isDownloading={isDownloading}
        name={name}
        ext={ext}
        filename={filename}
        config={config}
        pendingInfo={pendingInfo}
        mediaInfo={mediaInfo}
        showExpiredNotice={showExpiredNotice}
        onDismissExpiredNotice={() => setShowExpiredNotice(false)}
        metaFilename={metaFilename}
        originalFiles={originalFiles}
        onLoadAnyway={() => void fetchPasteBody()}
        onDownloadPaste={
          pendingInfo?.isReadLimited || (isDecrypted === "encrypted" && url.hash.slice(1).length > 0)
            ? () => void downloadPasteBody()
            : undefined
        }
      />
      <ErrorModal />
    </>
  )
}
