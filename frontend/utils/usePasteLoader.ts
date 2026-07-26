import { useCallback, useEffect, useRef, useState } from "react"
import { BINARY_MIME_TYPE, MAX_AUTO_FETCH_BYTES } from "../../shared/constants.js"
import { detectUtf8 } from "../../shared/encoding.js"
import type { MetaResponse, OriginalFileInfo } from "../../shared/interfaces.js"
import type { EncryptionScheme } from "../../shared/constants.js"
import { decryptResponseToFile, downloadResponseToFile } from "./responseDownload.js"
import { isMetaResponse, parsePasteResponseHeaders, stripEncryptedSuffix } from "./pasteResponse.js"

export interface PasteLoaderInitialState {
  pasteFile?: File
  pasteContentBuffer?: Uint8Array
  pasteLang?: string
  isFileBinary: boolean
  guessedEncoding: string | null
  isDecrypted: "not encrypted" | "encrypted" | "decrypted"
  metaFilename?: string
  originalFiles?: OriginalFileInfo[]
}

export interface PastePendingInfo {
  sizeBytes: number | null
  rawUrl: string
  contentType: string | null
  isReadLimited?: boolean
}

export interface PasteMediaInfo {
  sizeBytes: number | null
  rawUrl: string
  contentType: string
}

interface FetchedPasteFile {
  file: File
  content?: Uint8Array
  cleanup?: () => Promise<void>
  deferCleanup?: () => void
  filenameFromDisp?: string
  lang?: string
  scheme: EncryptionScheme | null
  didDecrypt: boolean
}

interface PastePreview {
  file: File
  content: Uint8Array
  lang?: string
  isBinary: boolean
  encoding: string | null
}

interface PasteLoaderOptions {
  url: URL
  name: string
  ext?: string
  filename?: string
  enabled: boolean
  initialState: PasteLoaderInitialState
  onReadConsumed: (remainingReads: string | number | null | undefined) => void
  showError: (title: string, content: string) => void
  handleFailedResponse: (defaultTitle: string, response: Response) => Promise<void>
}

export function getInitialPasteState(
  url: URL,
  name: string,
  ext: string | undefined,
  filename: string | undefined,
): PasteLoaderInitialState {
  const initialData = window.__PASTE_DATA__
  if (!initialData) {
    return {
      isFileBinary: false,
      guessedEncoding: null,
      isDecrypted: "not encrypted",
    }
  }

  const responseBytes = Uint8Array.from(atob(initialData.content), (character) => character.charCodeAt(0))
  const scheme = initialData.metadata.encryptionScheme as EncryptionScheme | undefined
  const lang = url.searchParams.get("lang") || initialData.metadata.highlightLanguage
  const inferredFilename = filename || (ext && name + ext) || initialData.metadata.filename

  return {
    pasteFile: new File([responseBytes], inferredFilename || name),
    pasteContentBuffer: responseBytes,
    pasteLang: lang || undefined,
    isFileBinary: initialData.isBinary,
    guessedEncoding: initialData.guessedEncoding,
    isDecrypted: scheme ? "encrypted" : "not encrypted",
    metaFilename: initialData.metadata.filename,
    originalFiles: initialData.metadata.filenames,
  }
}

export function usePasteLoader({
  url,
  name,
  ext,
  filename,
  enabled,
  initialState,
  onReadConsumed,
  showError,
  handleFailedResponse,
}: PasteLoaderOptions) {
  const pasteUrl = `/${name}`
  const [pasteFile, setPasteFile] = useState<File | undefined>(initialState.pasteFile)
  const [pasteContentBuffer, setPasteContentBuffer] = useState<Uint8Array | undefined>(initialState.pasteContentBuffer)
  const [pasteLang, setPasteLang] = useState<string | undefined>(initialState.pasteLang)
  const [isFileBinary, setFileBinary] = useState(initialState.isFileBinary)
  const [guessedEncoding, setGuessedEncoding] = useState<string | null>(initialState.guessedEncoding)
  const [isDecrypted, setDecrypted] = useState<"not encrypted" | "encrypted" | "decrypted">(initialState.isDecrypted)
  const [isLoading, setIsLoading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [pendingInfo, setPendingInfo] = useState<PastePendingInfo | null>(null)
  const [mediaInfo, setMediaInfo] = useState<PasteMediaInfo | null>(null)
  const [metaFilename, setMetaFilename] = useState<string | undefined>(initialState.metaFilename)
  const [originalFiles, setOriginalFiles] = useState<OriginalFileInfo[] | undefined>(initialState.originalFiles)

  const [abortController] = useState(() => new AbortController())
  const isFetchingBodyRef = useRef(false)
  const isDownloadingRef = useRef(false)
  const temporaryFileCleanupRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const retainedDownloadUrlsRef = useRef(new Map<string, (() => void) | undefined>())
  const initialLoadStartedRef = useRef(false)
  const callbacksRef = useRef({ onReadConsumed, showError, handleFailedResponse })
  callbacksRef.current = { onReadConsumed, showError, handleFailedResponse }

  const fetchMetadata = useCallback(
    async (signal = abortController.signal): Promise<MetaResponse | null> => {
      try {
        const response = await fetch(`/m/${name}`, { signal })
        if (!response.ok) return null
        const metadata: unknown = await response.json()
        signal.throwIfAborted()
        return isMetaResponse(metadata) ? metadata : null
      } catch (error) {
        if (signal.aborted || (error as Error).name === "AbortError") return null
        console.warn(`Failed to fetch metadata for ${name}`, error)
        return null
      }
    },
    [abortController, name],
  )

  const downloadFile = useCallback((file: File, cleanup?: () => Promise<void>, deferCleanup?: () => void) => {
    const downloadBlob = file.type === BINARY_MIME_TYPE ? file : new Blob([file], { type: BINARY_MIME_TYPE })
    const downloadUrl = URL.createObjectURL(downloadBlob)
    const link = document.createElement("a")
    link.href = downloadUrl
    link.download = file.name
    link.style.display = "none"
    document.body.appendChild(link)
    link.click()
    link.remove()
    if (cleanup) {
      // There is no reliable browser event for when a Blob-backed download has
      // consumed its source. Keep OPFS-backed files alive for this page lifetime.
      retainedDownloadUrlsRef.current.set(downloadUrl, deferCleanup)
      return
    }
    window.setTimeout(() => URL.revokeObjectURL?.(downloadUrl), 1000)
  }, [])

  const fetchPasteFile = useCallback(
    async (includeContent = false, signal = abortController.signal): Promise<FetchedPasteFile | null> => {
      try {
        const response = await fetch(pasteUrl, { signal })
        if (!response.ok) {
          await callbacksRef.current.handleFailedResponse("Failed to Fetch Paste", response)
          return null
        }
        const responseInfo = parsePasteResponseHeaders(response.headers)
        const { encryptionScheme: scheme, remainingReads, filename: filenameFromDisposition } = responseInfo
        const lang = url.searchParams.get("lang") || responseInfo.highlightLanguage
        let metadataFilename = metaFilename
        if (!filename && !ext && !filenameFromDisposition && !metadataFilename) {
          metadataFilename = stripEncryptedSuffix((await fetchMetadata(signal))?.filename)
        }
        signal.throwIfAborted()
        const inferredFilename = filename || (ext && name + ext) || filenameFromDisposition || metadataFilename
        const keyString = url.hash.slice(1)

        if (scheme === null || keyString.length === 0) {
          const downloaded = await downloadResponseToFile(response, {
            filename: inferredFilename || name,
            type: responseInfo.mimeType,
            includeContent,
            opfsThreshold: remainingReads === null ? Number.POSITIVE_INFINITY : undefined,
            signal,
          })
          if (signal.aborted) {
            await downloaded.cleanup?.()
            return null
          }
          callbacksRef.current.onReadConsumed(remainingReads)
          return {
            ...downloaded,
            filenameFromDisp: filenameFromDisposition,
            lang: lang || undefined,
            scheme,
            didDecrypt: false,
          }
        }

        try {
          const decrypted = await decryptResponseToFile(response, scheme, keyString, {
            filename: inferredFilename || name,
            type: responseInfo.mimeType,
            includeContent,
            signal,
          })
          if (signal.aborted) {
            await decrypted.cleanup?.()
            return null
          }
          callbacksRef.current.onReadConsumed(remainingReads)
          return {
            ...decrypted,
            filenameFromDisp: filenameFromDisposition,
            lang: lang || undefined,
            scheme,
            didDecrypt: true,
          }
        } catch (error) {
          if (signal.aborted || (error as Error).name === "AbortError") return null
          callbacksRef.current.showError(
            "Decryption failed",
            `${(error as Error).message}. The URL fragment may be wrong, or the paste has been replaced or corrupted.`,
          )
          return null
        }
      } catch (error) {
        if (signal.aborted || (error as Error).name === "AbortError") return null
        callbacksRef.current.showError(`Error on fetching ${pasteUrl}`, (error as Error).toString())
        console.error(error)
        return null
      }
    },
    [abortController, ext, fetchMetadata, filename, metaFilename, name, pasteUrl, url],
  )

  const loadBody = useCallback(
    async (signal = abortController.signal) => {
      if (isFetchingBodyRef.current) return
      isFetchingBodyRef.current = true
      setIsLoading(true)
      setPendingInfo(null)
      setMediaInfo(null)
      try {
        const paste = await fetchPasteFile(true, signal)
        if (!paste) return
        if (signal.aborted) {
          await paste.cleanup?.()
          return
        }
        if (!paste.content) {
          await paste.cleanup?.()
          throw new Error("The downloaded file could not be loaded for preview")
        }

        setPasteLang(paste.lang)
        if (paste.filenameFromDisp) setMetaFilename(paste.filenameFromDisp)
        await temporaryFileCleanupRef.current?.()
        if (signal.aborted) {
          await paste.cleanup?.()
          return
        }
        temporaryFileCleanupRef.current = paste.cleanup
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
      } catch (error) {
        if (!signal.aborted && (error as Error).name !== "AbortError") {
          callbacksRef.current.showError(`Error on fetching ${pasteUrl}`, (error as Error).toString())
        }
      } finally {
        isFetchingBodyRef.current = false
        if (!signal.aborted) setIsLoading(false)
      }
    },
    [abortController, fetchPasteFile, pasteUrl],
  )

  const downloadBody = useCallback(
    async (signal = abortController.signal) => {
      if (isDownloadingRef.current) return
      isDownloadingRef.current = true
      setIsDownloading(true)
      try {
        const paste = await fetchPasteFile(false, signal)
        if (paste && !signal.aborted) downloadFile(paste.file, paste.cleanup, paste.deferCleanup)
        else await paste?.cleanup?.()
      } finally {
        isDownloadingRef.current = false
        if (!signal.aborted) setIsDownloading(false)
      }
    },
    [abortController, downloadFile, fetchPasteFile],
  )

  const showPreview = useCallback((preview: PastePreview) => {
    setPasteFile(preview.file)
    setPasteContentBuffer(preview.content)
    setPasteLang(preview.lang)
    setFileBinary(preview.isBinary)
    setGuessedEncoding(preview.encoding)
  }, [])

  const clearPreview = useCallback(() => {
    setPasteFile(undefined)
    setPasteContentBuffer(undefined)
    setIsLoading(false)
  }, [])

  const dispose = useCallback(() => {
    abortController.abort()
    void temporaryFileCleanupRef.current?.()
    temporaryFileCleanupRef.current = undefined
    for (const [downloadUrl, deferCleanup] of retainedDownloadUrlsRef.current) {
      URL.revokeObjectURL?.(downloadUrl)
      deferCleanup?.()
    }
    retainedDownloadUrlsRef.current.clear()
  }, [abortController])

  useEffect(() => dispose, [dispose])

  useEffect(() => {
    if (initialLoadStartedRef.current) return
    initialLoadStartedRef.current = true
    if (window.__PASTE_DATA__) {
      callbacksRef.current.onReadConsumed(window.__PASTE_DATA__.metadata.remainingReads)
      return
    }
    if (!enabled) return

    const signal = abortController.signal
    void (async () => {
      setIsLoading(true)
      try {
        const headResponse = await fetch(pasteUrl, { method: "HEAD", signal })
        if (!headResponse.ok) {
          await callbacksRef.current.handleFailedResponse(`Error on Fetching ${pasteUrl}`, headResponse)
          return
        }
        signal.throwIfAborted()
        const responseInfo = parsePasteResponseHeaders(headResponse.headers)
        const {
          contentLength,
          highlightLanguage,
          encryptionScheme,
          effectiveContentType,
          filename: filenameFromHead,
          remainingReads,
        } = responseInfo
        const isEncrypted = encryptionScheme !== null
        setDecrypted(isEncrypted ? "encrypted" : "not encrypted")
        if (filenameFromHead) setMetaFilename(filenameFromHead)

        const shouldAwaitMetadata = contentLength === null
        const metadataPromise = fetchMetadata(signal)
        const metadata = shouldAwaitMetadata ? await metadataPromise : null
        signal.throwIfAborted()
        const applyMetadata = (value: MetaResponse | null) => {
          if (!value) return
          if (!filenameFromHead && value.filename) setMetaFilename(value.filename)
          if (value.filenames) setOriginalFiles(value.filenames)
        }
        applyMetadata(metadata)
        if (!shouldAwaitMetadata) {
          void metadataPromise.then((value) => {
            if (!signal.aborted) applyMetadata(value)
          })
        }

        const sizeBytes = contentLength ?? metadata?.sizeBytes ?? null
        const isReadLimited = remainingReads !== null || metadata?.remainingReads !== undefined
        const isText = effectiveContentType?.startsWith("text/") || !!highlightLanguage
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
        } else if ((isText || (isMedia && isEncrypted)) && sizeOk) {
          await loadBody(signal)
        } else if (isMedia && !isEncrypted) {
          setMediaInfo({
            sizeBytes,
            rawUrl: pasteUrl,
            contentType: effectiveContentType!,
          })
        } else {
          setPendingInfo({
            sizeBytes,
            rawUrl: pasteUrl,
            contentType: effectiveContentType,
          })
        }
      } catch (error) {
        if (signal.aborted || (error as Error).name === "AbortError") return
        callbacksRef.current.showError(`Error on Fetching ${pasteUrl}`, (error as Error).toString())
        console.error(error)
      } finally {
        if (!signal.aborted) setIsLoading(false)
      }
    })()
  }, [abortController, enabled, fetchMetadata, loadBody, pasteUrl])

  return {
    pasteFile,
    pasteContentBuffer,
    pasteLang,
    isFileBinary,
    guessedEncoding,
    isDecrypted,
    isLoading,
    isDownloading,
    pendingInfo,
    mediaInfo,
    metaFilename,
    originalFiles,
    setLoading: setIsLoading,
    showPreview,
    clearPreview,
    downloadFile,
    loadBody,
    downloadBody,
    dispose,
  }
}
