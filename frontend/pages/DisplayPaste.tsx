import { useCallback, useEffect, useRef, useState } from "react"
import mime from "mime"
import { useErrorModal } from "../components/ErrorModal.js"
import { DisplayPasteView } from "./DisplayPasteView.js"
import { parsePath } from "../../shared/parsers.js"
import { MAX_P2P_AUTO_PREVIEW_BYTES } from "../../shared/constants.js"
import { detectUtf8, hasBinaryMarker } from "../../shared/encoding.js"
import type { PublicEnv } from "../../shared/interfaces.js"
import { parseReadLimit } from "../../shared/verify.js"
import { removeLocalUpload } from "../utils/localUploads.js"
import { useP2PReceiverController, type P2PReceivedFileContext } from "../utils/p2p/useReceiverController.js"
import { getInitialPasteState, usePasteLoader } from "../utils/usePasteLoader.js"

import "../style.css"
import "../styles/highlight-theme-light.css"
import "../styles/highlight-theme-dark.css"

export function DisplayPaste({ config }: { config: PublicEnv }) {
  const [url] = useState(() => new URL(location.toString()))
  const { role, name, ext, filename } = parsePath(url.pathname)
  const [initialPasteState] = useState(() => getInitialPasteState(url, name, ext, filename))

  const [forceShowBinary, setForceShowBinary] = useState(false)
  const [showExpiredNotice, setShowExpiredNotice] = useState(false)
  const expiredNoticeTimerRef = useRef<number | undefined>(undefined)

  const showExpiredNoticeAfterDelay = useCallback(() => {
    if (expiredNoticeTimerRef.current !== undefined) {
      window.clearTimeout(expiredNoticeTimerRef.current)
    }
    expiredNoticeTimerRef.current = window.setTimeout(() => {
      setShowExpiredNotice(true)
      expiredNoticeTimerRef.current = undefined
    }, 3000)
  }, [])

  const hideExpiredNotice = useCallback(() => {
    if (expiredNoticeTimerRef.current !== undefined) {
      window.clearTimeout(expiredNoticeTimerRef.current)
      expiredNoticeTimerRef.current = undefined
    }
    setShowExpiredNotice(false)
  }, [])

  const { ErrorModal, showModal, handleFailedResp } = useErrorModal()
  const removeLocalUploadIfConsumed = useCallback(
    (remainingReads: string | number | null | undefined) => {
      const parsed = parseReadLimit(remainingReads)
      if (parsed !== null && parsed <= 1) {
        removeLocalUpload(name)
        showExpiredNoticeAfterDelay()
      }
    },
    [name, showExpiredNoticeAfterDelay],
  )
  const paste = usePasteLoader({
    url,
    name,
    ext,
    filename,
    enabled: role !== "p",
    initialState: initialPasteState,
    onReadConsumed: removeLocalUploadIfConsumed,
    showError: showModal,
    handleFailedResponse: handleFailedResp,
  })
  const p2p = useP2PReceiverController(name, config, {
    onFile: handleP2PFile,
    onStartError: (error) => showModal("Error on Starting P2P Transfer", error.message),
    onError: (error) => showModal("Error on P2P Transfer", error.message),
    onTransferLimitReached: showExpiredNoticeAfterDelay,
    onRoomAvailable: hideExpiredNotice,
    onAcceptUpdate: () => {
      paste.clearPreview()
    },
  })

  useEffect(() => {
    const handlePageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        p2p.dispose()
        paste.dispose()
      }
    }
    window.addEventListener("pagehide", handlePageHide)
    return () => {
      window.removeEventListener("pagehide", handlePageHide)
      p2p.dispose()
      paste.dispose()
      if (expiredNoticeTimerRef.current !== undefined) {
        window.clearTimeout(expiredNoticeTimerRef.current)
      }
    }
  }, [p2p.dispose, paste.dispose])

  useEffect(() => {
    if (role === "p") void p2p.start()
  }, [p2p.start, role])

  async function handleP2PFile(file: File, context: P2PReceivedFileContext): Promise<void> {
    const { isCurrent, highlightLanguage, setCanPreview, setStatus } = context
    try {
      if (!isCurrent()) return
      let content: Uint8Array<ArrayBuffer> | undefined
      let encoding: "UTF-8" | null = null
      let canPreview: boolean

      if (file.size < MAX_P2P_AUTO_PREVIEW_BYTES) {
        const isBinary = await hasBinaryMarker(file)
        if (!isCurrent()) return
        if (isBinary) {
          canPreview = false
        } else {
          content = new Uint8Array(await file.arrayBuffer())
          if (!isCurrent()) return
          encoding = detectUtf8(content)
          canPreview = encoding !== null
        }
      } else {
        const inferredMime = mime.getType(file.name)
        if (inferredMime) {
          canPreview = inferredMime.startsWith("text/")
        } else {
          canPreview = !(await hasBinaryMarker(file))
          if (!isCurrent()) return
        }
      }

      setCanPreview(canPreview)
      if (canPreview) {
        if (content) await loadP2PTextPreview(file, content, isCurrent, highlightLanguage, encoding)
        else setStatus("Transfer complete. Choose whether to preview or save.")
        return
      }
      paste.downloadFile(file)
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : String(error)
        showModal("Error Preparing Received P2P File", message)
      }
    }
  }

  async function loadP2PTextAnyway(): Promise<void> {
    const file = p2p.file
    if (!file || !p2p.canPreviewFile) return
    const isCurrentFile = p2p.captureFileGuard()
    const highlightLanguage = p2p.meta?.highlightLanguage
    paste.setLoading(true)
    try {
      await loadP2PTextPreview(file, undefined, isCurrentFile, highlightLanguage)
    } finally {
      if (isCurrentFile()) paste.setLoading(false)
    }
  }

  async function loadP2PTextPreview(
    file: File,
    existingContent?: Uint8Array<ArrayBuffer>,
    isCurrentSession: () => boolean = () => true,
    highlightLanguage?: string,
    encoding: "UTF-8" | null = null,
  ): Promise<void> {
    const content = existingContent ?? new Uint8Array(await file.arrayBuffer())
    if (!isCurrentSession()) return
    paste.showPreview({
      file,
      content,
      lang: highlightLanguage,
      isBinary: false,
      encoding,
    })
    setForceShowBinary(false)
  }

  return (
    <>
      <DisplayPasteView
        pasteFile={paste.pasteFile}
        pasteContentBuffer={paste.pasteContentBuffer}
        pasteLang={paste.pasteLang}
        isFileBinary={paste.isFileBinary}
        guessedEncoding={paste.guessedEncoding}
        isDecrypted={paste.isDecrypted}
        forceShowBinary={forceShowBinary}
        setForceShowBinary={setForceShowBinary}
        isLoading={paste.isLoading}
        isDownloading={paste.isDownloading}
        name={name}
        ext={ext}
        filename={filename}
        config={config}
        pendingInfo={paste.pendingInfo}
        mediaInfo={paste.mediaInfo}
        showExpiredNotice={showExpiredNotice}
        onDismissExpiredNotice={() => setShowExpiredNotice(false)}
        metaFilename={paste.metaFilename}
        originalFiles={paste.originalFiles}
        isP2PMode={p2p.isMode}
        p2pStatus={p2p.status}
        p2pConnectionRoute={p2p.connectionRoute}
        p2pMeta={p2p.meta}
        p2pUpdateMeta={p2p.updateMeta}
        p2pTransferHistory={p2p.transferHistory}
        p2pProgress={p2p.progress}
        p2pFile={p2p.file}
        isP2PPaused={p2p.isPaused}
        isP2PPausing={p2p.isPausing}
        isP2PReconnecting={p2p.isReconnecting}
        isP2PAcceptingUpdate={p2p.isAcceptingUpdate}
        onP2PDownload={p2p.requestDownload}
        onP2PPause={p2p.pause}
        onP2PResume={p2p.resume}
        onP2PTerminate={p2p.terminate}
        onP2PAcceptUpdate={p2p.acceptUpdate}
        onP2PLoadAnyway={p2p.file && p2p.canPreviewFile ? () => void loadP2PTextAnyway() : undefined}
        onLoadAnyway={() => void paste.loadBody()}
        onDownloadPaste={
          paste.pendingInfo?.isReadLimited || (paste.isDecrypted === "encrypted" && url.hash.slice(1).length > 0)
            ? () => void paste.downloadBody()
            : undefined
        }
      />
      <ErrorModal />
    </>
  )
}
