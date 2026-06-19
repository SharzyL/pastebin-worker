import { useEffect, useRef, useState } from "react"
import { CircularProgress, Link, Tooltip } from "../components/ui/index.js"
import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { DownloadIcon, HomeIcon } from "../components/icons.js"
import { CopyWidget } from "../components/CopyWidget.js"
import { QrCodeTooltip } from "../components/QrCodeTooltip.js"
import { tst } from "../utils/overrides.js"
import { highlightHTML, useHljsForLang } from "../utils/highlight.js"
import { formatSize } from "../utils/utils.js"
import type { OriginalFileInfo } from "../../shared/interfaces.js"
import { filenameForTitle } from "../../shared/filename.js"
import { FileTree } from "../components/FileTree.js"
import { itemCountLabel } from "../../shared/format.js"

interface PendingInfo {
  sizeBytes: number | null
  rawUrl: string
  contentType: string | null
}

interface MediaInfo {
  sizeBytes: number | null
  rawUrl: string
  contentType: string
}

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
  config: Env
  pendingInfo?: PendingInfo | null
  mediaInfo?: MediaInfo | null
  metaFilename?: string
  originalFiles?: OriginalFileInfo[]
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
    metaFilename,
    originalFiles,
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
  useEffect(() => {
    if (pasteFile && typeof window !== "undefined" && URL.createObjectURL) {
      const url = URL.createObjectURL(pasteFile)
      setDownloadUrl(url)
      return () => {
        if (URL.revokeObjectURL) URL.revokeObjectURL(url)
      }
    }
  }, [pasteFile])

  const pasteMediaKind = pasteFile ? mediaKindOf(pasteFile) : null
  const mediaInfoKind = mediaInfo ? mediaKindOfType(mediaInfo.contentType) : null
  const showFileContent = pasteFile !== undefined && pasteMediaKind === null && (!isFileBinary || forceShowBinary)
  const pasteStringContent = pasteContentBuffer && new TextDecoder().decode(pasteContentBuffer)
  const highlightedHTML = pasteStringContent ? highlightHTML(hljs, pasteLang, pasteStringContent) : ""
  const pasteLineCount = (highlightedHTML?.match(/\n/g)?.length || 0) + 1
  const hasOriginalFiles = originalFiles !== undefined && originalFiles.length > 0
  const isZipArchive = isZipBuffer(pasteContentBuffer)
  const isDownloadActionDisabled = isLoading || isDownloading

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
            {isDownloading ? "Downloading..." : "Download decrypted"}
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
      <div className="w-full max-w-[64rem]">
        <div className="flex flex-row my-4 items-center justify-between">
          <h1 className="text-xl md:text-2xl grow inline-flex items-center md:items-baseline min-w-0">
            <a href="/" aria-label={indexPageTitle} className={`${iconLinkClass} md:hidden shrink-0`}>
              <HomeIcon className="size-6" />
            </a>
            <Link href="/" className="text-foreground-500 text-[length:inherited] shrink-0 hidden md:inline">
              {indexPageTitle}
            </Link>
            <span className="mx-2 shrink-0">{" / "}</span>
            <span className="shrink-0">{titleDisplayFilename ? name : name + (ext ?? "")}</span>
            {titleDisplayFilename && (
              <>
                <span className="mx-2 shrink-0">{" / "}</span>
                <span className="truncate min-w-0" title={titleDisplayFilename}>
                  {titleDisplayFilename}
                </span>
              </>
            )}
            <span className="ml-1 shrink-0">
              {isDecrypted === "decrypted" ? " (Decrypted)" : isDecrypted === "encrypted" ? " (Encrypted)" : ""}
            </span>
          </h1>
          <div className="flex flex-row gap-2 items-center">
            <DarkModeToggle modeSelection={modeSelection} setModeSelection={setModeSelection} />
            {displayUrl && (
              <QrCodeTooltip
                value={displayUrl}
                placement="bottom"
                className={`${buttonClasses}`}
                tooltip="Show QR code"
              />
            )}
            {pasteFile ? (
              <Tooltip content={`Download as file`}>
                <a
                  href={downloadUrl}
                  download={pasteFile.name}
                  aria-label="Download"
                  className={`${iconLinkClass} ${isNativeDownloadDebounced ? "pointer-events-none opacity-50" : ""}`}
                  aria-disabled={isNativeDownloadDebounced}
                  onClick={onNativeDownloadClick}
                >
                  <DownloadIcon className="size-6 inline" />
                </a>
              </Tooltip>
            ) : (
              (pendingInfo || mediaInfo) && (
                <Tooltip content={`Download as file`}>
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
            {showFileContent && (
              <Tooltip content={`Copy to clipboard`}>
                <CopyWidget variant="light" className={buttonClasses} getCopyContent={() => pasteStringContent!} />
              </Tooltip>
            )}
          </div>
        </div>
        <div className="my-4">
          <div className={`w-full bg-default-100 rounded-lg p-3 relative ${tst}`}>
            {isLoading ? (
              <div className="h-[10em] flex items-center justify-center">
                <CircularProgress label={"Loading..."} />
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
                      <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                        <span>{contentDisplayFilename || pasteFile?.name}</span>
                        <span>{`(${formatSize(pasteFile.size)})`}</span>
                        {forceShowBinary && (
                          <button className="ml-2 text-primary" onClick={() => setForceShowBinary(false)}>
                            (Click to hide)
                          </button>
                        )}
                        {pasteLang && <span className={"grow text-right"}>{pasteLang}</span>}
                      </div>
                      {hasOriginalFiles && <OriginalFileList files={originalFiles} />}
                      <div className="font-mono relative" role="article">
                        <pre
                          style={{ marginLeft: lineNumOffset, width: `calc(100% - ${lineNumOffset})` }}
                          dangerouslySetInnerHTML={{ __html: highlightedHTML }}
                          className={"overflow-x-auto"}
                        />
                        <span
                          className={
                            "line-number-rows absolute pointer-events-none text-default-500 top-0 left-0 " +
                            "border-solid border-default-300 border-r-1"
                          }
                        >
                          {Array.from({ length: pasteLineCount }, (_, idx) => {
                            return <span key={idx} />
                          })}
                        </span>
                      </div>
                    </>
                  ) : (
                    binaryFileIndicator
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
