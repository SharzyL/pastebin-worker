import { useEffect, useMemo, useRef, useState } from "react"
import { CircularProgress, Link, Tooltip } from "../components/ui/index.js"
import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { DownloadIcon, HomeIcon, XIcon } from "../components/icons.js"
import { CopyWidget } from "../components/CopyWidget.js"
import { QrCodeTooltip } from "../components/QrCodeTooltip.js"
import { tst } from "../utils/overrides.js"
import { highlightHTML, useHljsForLang } from "../utils/highlight.js"
import { formatSize } from "../utils/utils.js"
import type { OriginalFileInfo, PublicEnv } from "../../shared/interfaces.js"
import type {
  P2PConnectionRoute,
  P2PFileMeta,
  P2PProgress,
  P2PTransferHistoryItem,
  P2PTransferStatus,
} from "../utils/p2pCommon.js"
import { filenameForTitle } from "../../shared/filename.js"
import { FileTree } from "../components/FileTree.js"
import { itemCountLabel } from "../../shared/format.js"
import { P2PProgressBar } from "../components/P2PProgressBar.js"
import { countTextLines, LineNumbers } from "../components/LineNumbers.js"

interface PendingInfo {
  sizeBytes: number | null
  rawUrl: string
  contentType: string | null
  isReadLimited?: boolean
}

interface MediaInfo {
  sizeBytes: number | null
  rawUrl: string
  contentType: string
}

export type { P2PTransferHistoryItem } from "../utils/p2pCommon.js"

type MediaKind = "image" | "audio" | "video"

const mediaExtRegex: Record<MediaKind, RegExp> = {
  image: /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i,
  audio: /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i,
  video: /\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i,
}

function mediaKindOf(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("audio/")) return "audio"
  if (file.type.startsWith("video/")) return "video"
  for (const kind of ["image", "audio", "video"] as const) {
    if (mediaExtRegex[kind].test(file.name)) return kind
  }
  return null
}

function mediaKindOfType(contentType: string): MediaKind | null {
  if (contentType.startsWith("image/")) return "image"
  if (contentType.startsWith("audio/")) return "audio"
  if (contentType.startsWith("video/")) return "video"
  return null
}

function MediaElement({ kind, src, name }: { kind: MediaKind; src: string; name: string }) {
  if (kind === "image") {
    return <img src={src} alt={name} className="max-w-full h-auto mx-auto block" />
  }
  if (kind === "audio") {
    return <audio src={src} controls className="w-full" aria-label={name} />
  }
  return <video src={src} controls className="max-w-full h-auto mx-auto block" aria-label={name} />
}

function P2PTransferHistoryCard({ transfer }: { transfer: P2PTransferHistoryItem }) {
  const [downloadUrl, setDownloadUrl] = useState("")

  useEffect(() => {
    if (!transfer.file || typeof window === "undefined" || !URL.createObjectURL) {
      setDownloadUrl("")
      return
    }
    const url = URL.createObjectURL(transfer.file)
    setDownloadUrl(url)
    return () => {
      if (URL.revokeObjectURL) URL.revokeObjectURL(url)
    }
  }, [transfer.file])

  return (
    <div className={`w-full bg-default-100 rounded-lg p-3 relative ${tst}`}>
      <div className="flex min-h-[14em] w-full flex-col items-center justify-center px-4 text-center">
        <div className="text-lg font-medium">P2P transfer</div>
        <div className="mt-2 text-sm text-foreground-500">{transfer.status}</div>
        <div className="mt-4 w-full max-w-2xl">
          <P2PProgressBar
            progress={transfer.progress}
            label={transfer.meta.name}
            connectionRoute={transfer.connectionRoute}
            status={transfer.transferStatus}
            reserveTransferStatsSpace
          />
        </div>
        {transfer.file && downloadUrl && (
          <div className="mt-2">
            <a href={downloadUrl} download={transfer.file.name} className="text-primary inline">
              Save file
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function sizeSuffix(sizeBytes: number | null): string {
  return sizeBytes === null ? "" : ` (${formatSize(sizeBytes)})`
}

function OriginalFileList({
  files,
  className = "mt-2 mb-2 max-h-48 w-full max-w-[32rem] overflow-auto text-left",
}: {
  files: OriginalFileInfo[]
  className?: string
}) {
  return (
    <div className={className}>
      <FileTree files={files} />
    </div>
  )
}

const zipSignatures = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const

function isZipBuffer(buffer: Uint8Array | undefined): boolean {
  if (!buffer || buffer.length < 4) return false
  return zipSignatures.some((signature) => signature.every((byte, index) => buffer[index] === byte))
}

interface DisplayPasteViewProps {
  pasteFile?: File
  pasteContentBuffer?: Uint8Array
  pasteLang?: string
  isFileBinary: boolean
  guessedEncoding: string | null
  isDecrypted: "not encrypted" | "encrypted" | "decrypted"
  forceShowBinary: boolean
  setForceShowBinary: (v: boolean) => void
  isLoading: boolean
  isDownloading: boolean
  name: string
  ext?: string
  filename?: string
  config: PublicEnv
  pendingInfo?: PendingInfo | null
  mediaInfo?: MediaInfo | null
  showExpiredNotice?: boolean
  onDismissExpiredNotice?: () => void
  metaFilename?: string
  originalFiles?: OriginalFileInfo[]
  isP2PMode?: boolean
  p2pStatus?: string
  p2pConnectionRoute?: P2PConnectionRoute
  p2pMeta?: P2PFileMeta
  p2pUpdateMeta?: P2PFileMeta
  p2pTransferHistory?: P2PTransferHistoryItem[]
  p2pProgress?: P2PProgress
  p2pFile?: File
  isP2PPaused?: boolean
  isP2PPausing?: boolean
  isP2PReconnecting?: boolean
  isP2PAcceptingUpdate?: boolean
  onP2PDownload?: () => void
  onP2PPause?: () => void
  onP2PResume?: () => void
  onP2PTerminate?: () => void
  onP2PAcceptUpdate?: () => void
  onP2PLoadAnyway?: () => void
  onLoadAnyway?: () => void
  onDownloadPaste?: () => void
}

export function DisplayPasteView(props: DisplayPasteViewProps) {
  const {
    pasteFile,
    pasteContentBuffer,
    pasteLang,
    isFileBinary,
    guessedEncoding,
    isDecrypted,
    forceShowBinary,
    setForceShowBinary,
    isLoading,
    isDownloading,
    name,
    ext,
    filename,
    config,
    pendingInfo,
    mediaInfo,
    showExpiredNotice,
    onDismissExpiredNotice,
    metaFilename,
    originalFiles,
    isP2PMode,
    p2pStatus,
    p2pConnectionRoute,
    p2pMeta,
    p2pUpdateMeta,
    p2pTransferHistory = [],
    p2pProgress,
    p2pFile,
    isP2PPaused,
    isP2PPausing,
    isP2PReconnecting,
    isP2PAcceptingUpdate,
    onP2PDownload,
    onP2PPause,
    onP2PResume,
    onP2PTerminate,
    onP2PAcceptUpdate,
    onP2PLoadAnyway,
    onLoadAnyway,
    onDownloadPaste,
  } = props

  const indexPageTitle = config.INDEX_PAGE_TITLE || "Pastebin"

  const [, modeSelection, setModeSelection] = useDarkModeSelection()
  const hljs = useHljsForLang(pasteLang)
  const [downloadUrl, setDownloadUrl] = useState<string>("#")
  const [displayUrl, setDisplayUrl] = useState<string>("")
  const [isNativeDownloadDebounced, setNativeDownloadDebounced] = useState(false)
  const nativeDownloadDebouncedRef = useRef(false)
  const nativeDownloadDebounceTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDisplayUrl(window.location.href)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (nativeDownloadDebounceTimer.current !== undefined) {
        window.clearTimeout(nativeDownloadDebounceTimer.current)
      }
    }
  }, [])

  // Create and cleanup blob URL
  const downloadableFile = p2pFile || pasteFile

  useEffect(() => {
    if (downloadableFile && typeof window !== "undefined" && URL.createObjectURL) {
      const url = URL.createObjectURL(downloadableFile)
      setDownloadUrl(url)
      return () => {
        if (URL.revokeObjectURL) URL.revokeObjectURL(url)
      }
    }
  }, [downloadableFile])

  const pasteMediaKind = pasteFile ? mediaKindOf(pasteFile) : null
  const mediaInfoKind = mediaInfo ? mediaKindOfType(mediaInfo.contentType) : null
  const showFileContent = pasteFile !== undefined && pasteMediaKind === null && (!isFileBinary || forceShowBinary)
  const pasteStringContent = useMemo(
    () => (pasteContentBuffer ? new TextDecoder().decode(pasteContentBuffer) : undefined),
    [pasteContentBuffer],
  )
  const highlightedHTML = useMemo(() => {
    const html = pasteStringContent ? highlightHTML(hljs, pasteLang, pasteStringContent) : ""
    return html
  }, [hljs, pasteLang, pasteStringContent])
  const pasteLineCount = useMemo(() => countTextLines(pasteStringContent ?? ""), [pasteStringContent])
  const hasOriginalFiles = originalFiles !== undefined && originalFiles.length > 0
  const isZipArchive = isZipBuffer(pasteContentBuffer)
  const isDownloadActionDisabled = isLoading || isDownloading
  const isP2PDownloading = p2pProgress !== undefined && !p2pFile
  const isP2PRepairing = p2pStatus?.startsWith("Repairing") ?? false
  const showP2PPanel = isP2PMode && !(p2pFile && showFileContent)
  const showPrimaryContent =
    !isP2PMode || p2pTransferHistory.length === 0 || p2pMeta !== undefined || pasteFile !== undefined || isLoading
  const p2pTransferStatus: P2PTransferStatus = p2pFile
    ? "DONE"
    : isP2PPaused
      ? "PAUSED"
      : isP2PReconnecting
        ? "RECONNECTING"
        : isP2PRepairing
          ? "REPAIRING"
          : p2pProgress
            ? p2pProgress.doneBytes >= p2pProgress.totalBytes
              ? "VERIFYING"
              : "DOWNLOADING"
            : "READY"

  function onNativeDownloadClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (nativeDownloadDebouncedRef.current) {
      e.preventDefault()
      return
    }
    nativeDownloadDebouncedRef.current = true
    setNativeDownloadDebounced(true)
    if (nativeDownloadDebounceTimer.current !== undefined) {
      window.clearTimeout(nativeDownloadDebounceTimer.current)
    }
    nativeDownloadDebounceTimer.current = window.setTimeout(() => {
      nativeDownloadDebouncedRef.current = false
      setNativeDownloadDebounced(false)
      nativeDownloadDebounceTimer.current = undefined
    }, 1000)
  }

  const binaryFileIndicator = pasteFile && (
    <div className="flex min-h-[10em] w-full flex-col items-center justify-center px-4">
      <div className="text-foreground-600 mb-2">{`${hasOriginalFiles ? itemCountLabel(originalFiles.length) : pasteFile?.name} (${formatSize(pasteFile.size)})`}</div>
      {hasOriginalFiles && <OriginalFileList files={originalFiles} />}
      <div className="w-fit text-center">
        {isZipArchive ? (
          <>
            Not a renderable file (application/zip).{" "}
            <a
              href={downloadUrl}
              download={pasteFile.name}
              className={`text-primary inline ${isNativeDownloadDebounced ? "pointer-events-none opacity-50" : ""}`}
              aria-disabled={isNativeDownloadDebounced}
              onClick={onNativeDownloadClick}
            >
              Download raw
            </a>
          </>
        ) : (
          <>
            This file seems to be binary or not in UTF-8{guessedEncoding ? ` (${guessedEncoding} guessed). ` : ". "}
            <button className="text-primary inline" onClick={() => setForceShowBinary(true)}>
              (Click to show)
            </button>
          </>
        )}
      </div>
    </div>
  )

  const contentDisplayFilename = hasOriginalFiles ? itemCountLabel(originalFiles.length) : filename || metaFilename
  const titleDisplayFilename = hasOriginalFiles
    ? itemCountLabel(originalFiles.length)
    : filenameForTitle(filename || metaFilename)
  const placeholderName = contentDisplayFilename || (ext ? name + ext : name)
  const rawDownloadUrl = pendingInfo || mediaInfo ? `${(pendingInfo ?? mediaInfo)!.rawUrl}?a` : "#"
  const placeholderReason = (() => {
    if (!pendingInfo) return ""
    const ct = pendingInfo.contentType
    if (
      !ct?.startsWith("text/") &&
      !ct?.startsWith("image/") &&
      !ct?.startsWith("audio/") &&
      !ct?.startsWith("video/")
    ) {
      return `Not a renderable file${ct ? ` (${ct})` : ""}.`
    }
    if (pendingInfo.isReadLimited) {
      return "Paste has a limited number of reads."
    }
    return "Paste is too large to load automatically."
  })()
  const pendingFileIndicator = pendingInfo && !pasteFile && (
    <div className="flex min-h-[10em] w-full flex-col items-center justify-center px-4">
      <div className="text-foreground-600 mb-2">{`${placeholderName}${sizeSuffix(pendingInfo.sizeBytes)}`}</div>
      {hasOriginalFiles && <OriginalFileList files={originalFiles} />}
      <div className="w-fit text-center">
        {placeholderReason}{" "}
        {onDownloadPaste ? (
          <button
            className="text-primary inline cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isDownloadActionDisabled}
            onClick={() => onDownloadPaste()}
          >
            {isDownloading ? "Downloading..." : isDecrypted === "encrypted" ? "Download decrypted" : "Download raw"}
          </button>
        ) : (
          <Link
            href={`${pendingInfo.rawUrl}?a`}
            className={`text-primary inline ${isNativeDownloadDebounced ? "pointer-events-none opacity-50" : ""}`}
            aria-disabled={isNativeDownloadDebounced}
            onClick={onNativeDownloadClick}
          >
            Download raw
          </Link>
        )}
        {onLoadAnyway && (
          <>
            {" or "}
            <button
              className="text-primary inline cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoading}
              onClick={() => onLoadAnyway()}
            >
              {isLoading ? "loading..." : "load anyway"}
            </button>
            .
          </>
        )}
      </div>
    </div>
  )

  const lineNumOffset = `${Math.floor(Math.log10(pasteLineCount)) + 3}ch`
  const buttonClasses = `${tst}`
  const iconLinkClass = `inline-flex items-center justify-center rounded-full p-1.5 text-default-600 hover:bg-default-100 cursor-pointer ${buttonClasses}`
  const disabledIconClass = "disabled:cursor-not-allowed disabled:opacity-50"

  return (
    <main
      className={`flex flex-col items-center min-h-screen transition-transform-background bg-background ${tst} text-foreground w-full p-2`}
    >
      {showExpiredNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-3 left-1/2 z-50 flex w-[calc(100%-1rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 shadow-sm"
        >
          <div className="min-w-0 flex-1 text-center">
            <div className="font-bold">
              {isP2PMode ? "The transfer limit has been reached" : "The file has expired"}
            </div>
            <div>{isP2PMode ? "This P2P link is no longer available." : "The file has been permanently deleted."}</div>
          </div>
          {onDismissExpiredNotice && (
            <button
              type="button"
              aria-label="Close expired notice"
              className="shrink-0 cursor-pointer rounded-full p-0.5 text-danger-600 hover:bg-danger-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-danger-400"
              onClick={onDismissExpiredNotice}
            >
              <XIcon className="size-5" />
            </button>
          )}
        </div>
      )}
      <div className="w-full max-w-[64rem]">
        <div className="my-4 flex min-w-0 flex-row items-center justify-between">
          <h1 className="inline-flex min-w-0 flex-1 items-center overflow-hidden text-xl md:items-baseline md:text-2xl">
            <a href="/" aria-label={indexPageTitle} className={`${iconLinkClass} md:hidden shrink-0`}>
              <HomeIcon className="size-6" />
            </a>
            <Link href="/" className="text-foreground-500 text-[length:inherited] shrink-0 hidden md:inline">
              {indexPageTitle}
            </Link>
            <span className="mx-2 shrink-0">{" / "}</span>
            <span className="min-w-0 truncate" title={titleDisplayFilename ? name : name + (ext ?? "")}>
              {titleDisplayFilename ? name : name + (ext ?? "")}
            </span>
            {titleDisplayFilename && (
              <>
                <span className="mx-2 shrink-0">{" / "}</span>
                <span className="truncate min-w-0" title={titleDisplayFilename}>
                  {titleDisplayFilename}
                </span>
              </>
            )}
            <span className="ml-1 shrink-0">
              {isP2PMode
                ? " (P2P)"
                : isDecrypted === "decrypted"
                  ? " (Decrypted)"
                  : isDecrypted === "encrypted"
                    ? " (Encrypted)"
                    : ""}
            </span>
          </h1>
          <div className="flex shrink-0 flex-row items-center gap-2">
            <DarkModeToggle modeSelection={modeSelection} setModeSelection={setModeSelection} />
            {displayUrl && (
              <QrCodeTooltip
                value={displayUrl}
                placement="bottom"
                className={`${buttonClasses}`}
                tooltip="Show QR code"
              />
            )}
            {downloadableFile ? (
              <Tooltip content={isP2PMode ? "Save latest file" : "Download latest file"}>
                <a
                  href={downloadUrl}
                  download={downloadableFile.name}
                  aria-label={isP2PMode ? "Save" : "Download"}
                  className={`${iconLinkClass} ${isNativeDownloadDebounced ? "pointer-events-none opacity-50" : ""}`}
                  aria-disabled={isNativeDownloadDebounced}
                  onClick={onNativeDownloadClick}
                >
                  <DownloadIcon className="size-6 inline" />
                </a>
              </Tooltip>
            ) : (
              (pendingInfo || mediaInfo) && (
                <Tooltip content={`Download latest file`}>
                  {onDownloadPaste ? (
                    <button
                      type="button"
                      onClick={() => onDownloadPaste()}
                      aria-label="Download"
                      disabled={isDownloadActionDisabled}
                      className={`${iconLinkClass} ${disabledIconClass}`}
                    >
                      <DownloadIcon className="size-6 inline" />
                    </button>
                  ) : (
                    <a
                      href={rawDownloadUrl}
                      download={placeholderName}
                      aria-label="Download"
                      className={`${iconLinkClass} ${isNativeDownloadDebounced ? "pointer-events-none opacity-50" : ""}`}
                      aria-disabled={isNativeDownloadDebounced}
                      onClick={onNativeDownloadClick}
                    >
                      <DownloadIcon className="size-6 inline" />
                    </a>
                  )}
                </Tooltip>
              )
            )}
          </div>
        </div>
        <div className="my-4">
          {p2pTransferHistory.map((transfer, index) => (
            <div key={transfer.id} className={index === 0 ? undefined : "mt-4"}>
              <P2PTransferHistoryCard transfer={transfer} />
            </div>
          ))}
          {showPrimaryContent && (
            <div
              className={`${p2pTransferHistory.length > 0 ? "mt-4 " : ""}w-full bg-default-100 rounded-lg p-3 ${showFileContent ? "pt-1" : ""} relative ${tst}`}
            >
              {isLoading ? (
                <div className="h-[10em] flex items-center justify-center">
                  <CircularProgress label={"Loading..."} />
                </div>
              ) : showP2PPanel ? (
                <div className="flex min-h-[14em] w-full flex-col items-center justify-center px-4 text-center">
                  <div className="text-lg font-medium">P2P transfer</div>
                  <div className="mt-2 text-sm text-foreground-500">{p2pStatus || "Looking for the sender..."}</div>
                  {p2pMeta && (
                    <div className="mt-4 w-full max-w-2xl">
                      <P2PProgressBar
                        progress={p2pProgress}
                        label={p2pMeta.name}
                        connectionRoute={p2pConnectionRoute}
                        status={p2pTransferStatus}
                        reserveTransferStatsSpace
                      />
                    </div>
                  )}
                  {p2pFile ? (
                    <div className="mt-2">
                      <a
                        href={downloadUrl}
                        download={p2pFile.name}
                        className={`text-primary inline ${isNativeDownloadDebounced ? "pointer-events-none opacity-50" : ""}`}
                        aria-disabled={isNativeDownloadDebounced}
                        onClick={onNativeDownloadClick}
                      >
                        Save file
                      </a>
                      {onP2PLoadAnyway && (
                        <>
                          {" or "}
                          <button
                            type="button"
                            className="text-primary inline cursor-pointer"
                            onClick={onP2PLoadAnyway}
                          >
                            load anyway
                          </button>
                        </>
                      )}
                    </div>
                  ) : isP2PDownloading ? (
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        type="button"
                        disabled={isP2PPausing}
                        onClick={() => (isP2PPaused ? onP2PResume?.() : onP2PPause?.())}
                        className="text-primary cursor-pointer disabled:cursor-wait disabled:opacity-50"
                      >
                        {isP2PPausing ? "Pausing..." : isP2PPaused ? "Resume" : "Pause"}
                      </button>
                      <button type="button" onClick={() => onP2PTerminate?.()} className="text-danger cursor-pointer">
                        Terminate
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!p2pMeta}
                      onClick={() => onP2PDownload?.()}
                      className="mt-4 text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Receive file
                    </button>
                  )}
                </div>
              ) : mediaInfo && !pasteFile && mediaInfoKind ? (
                <div>
                  <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                    <span>{placeholderName}</span>
                    {mediaInfo.sizeBytes !== null && <span>{`(${formatSize(mediaInfo.sizeBytes)})`}</span>}
                  </div>
                  <MediaElement kind={mediaInfoKind} src={mediaInfo.rawUrl} name={placeholderName} />
                </div>
              ) : pasteFile && pasteMediaKind ? (
                <div>
                  <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                    <span>{contentDisplayFilename || pasteFile.name}</span>
                    <span>{`(${formatSize(pasteFile.size)})`}</span>
                  </div>
                  {hasOriginalFiles && <OriginalFileList files={originalFiles} />}
                  <MediaElement kind={pasteMediaKind} src={downloadUrl} name={pasteFile.name} />
                </div>
              ) : pendingInfo && !pasteFile ? (
                pendingFileIndicator
              ) : (
                pasteFile && (
                  <div>
                    {showFileContent ? (
                      <>
                        <div className="mb-1 flex min-w-0 flex-row items-center gap-2 text-sm text-gray-500">
                          <span className="min-w-0 truncate" title={contentDisplayFilename || pasteFile.name}>
                            {contentDisplayFilename || pasteFile.name}
                          </span>
                          <span className="shrink-0">{`(${formatSize(pasteFile.size)})`}</span>
                          {forceShowBinary && (
                            <button className="shrink-0 text-primary" onClick={() => setForceShowBinary(false)}>
                              (Click to hide)
                            </button>
                          )}
                          <div className="ml-auto flex shrink-0 items-center gap-2">
                            {pasteLang && <span>{pasteLang}</span>}
                            <Tooltip content="Copy to clipboard">
                              <CopyWidget
                                variant="light"
                                className={buttonClasses}
                                getCopyContent={() => pasteStringContent!}
                              />
                            </Tooltip>
                          </div>
                        </div>
                        {hasOriginalFiles && <OriginalFileList files={originalFiles} />}
                        <div className="font-mono relative">
                          <pre
                            role="article"
                            style={{ marginLeft: lineNumOffset, width: `calc(100% - ${lineNumOffset})` }}
                            dangerouslySetInnerHTML={{ __html: highlightedHTML }}
                            className={"overflow-x-auto"}
                          />
                          <LineNumbers
                            lineCount={pasteLineCount}
                            className={
                              "line-number-rows absolute pointer-events-none text-default-500 top-0 left-0 " +
                              "border-solid border-default-300 border-r-1"
                            }
                          />
                        </div>
                      </>
                    ) : (
                      binaryFileIndicator
                    )}
                  </div>
                )
              )}
            </div>
          )}
          {isP2PMode && p2pUpdateMeta && (
            <div className={`mt-4 w-full bg-default-100 rounded-lg p-3 relative ${tst}`}>
              <div className="flex min-h-[14em] w-full flex-col items-center justify-center px-4 text-center">
                <div className="text-lg font-medium">P2P transfer</div>
                <div className="mt-2 text-sm text-foreground-500">New version from sender.</div>
                <div className="mt-4 w-full max-w-2xl">
                  <P2PProgressBar
                    label={p2pUpdateMeta.name}
                    connectionRoute={p2pConnectionRoute}
                    status="READY"
                    reserveTransferStatsSpace
                  />
                </div>
                <button
                  type="button"
                  disabled={isP2PAcceptingUpdate}
                  className="mt-2 text-primary cursor-pointer disabled:cursor-wait disabled:opacity-50"
                  onClick={onP2PAcceptUpdate}
                >
                  {isP2PAcceptingUpdate ? "Switching to latest version..." : "Receive latest version"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
