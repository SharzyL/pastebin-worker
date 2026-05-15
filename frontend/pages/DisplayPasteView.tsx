import { useEffect, useState } from "react"
import { Button, CircularProgress, Link, Tooltip } from "../components/ui/index.js"
import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { DownloadIcon, HomeIcon } from "../components/icons.js"
import { CopyWidget } from "../components/CopyWidget.js"
import { tst } from "../utils/overrides.js"
import { highlightHTML } from "../utils/HighlightLoader.js"
import { useHljsForLang } from "../utils/HighlightContext.js"
import { formatSize } from "../utils/utils.js"

interface PendingInfo {
  sizeBytes: number
  rawUrl: string
  contentType: string | null
}

interface MediaInfo {
  sizeBytes: number
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
  name: string
  ext?: string
  filename?: string
  config: Env
  pendingInfo?: PendingInfo | null
  mediaInfo?: MediaInfo | null
  metaFilename?: string
  onLoadAnyway?: () => void
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
    name,
    ext,
    filename,
    config,
    pendingInfo,
    mediaInfo,
    metaFilename,
    onLoadAnyway,
  } = props

  const indexPageTitle = config.INDEX_PAGE_TITLE || "Pastebin"

  const [, modeSelection, setModeSelection] = useDarkModeSelection()
  const hljs = useHljsForLang(pasteLang)
  const [downloadUrl, setDownloadUrl] = useState<string>("#")

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

  const binaryFileIndicator = pasteFile && (
    <div className="absolute top-[50%] left-[50%] translate-[-50%] flex flex-col items-center w-full">
      <div className="text-foreground-600 mb-2">{`${pasteFile?.name} (${formatSize(pasteFile.size)})`}</div>
      <div className="w-fit text-center">
        This file seems to be binary or not in UTF-8{guessedEncoding ? ` (${guessedEncoding} guessed). ` : ". "}
        <button className="text-primary-500 inline" onClick={() => setForceShowBinary(true)}>
          (Click to show)
        </button>
      </div>
    </div>
  )

  const displayFilename = filename || metaFilename
  const placeholderName = displayFilename || (ext ? name + ext : name)
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
    <div className="absolute top-[50%] left-[50%] translate-[-50%] flex flex-col items-center w-full px-4">
      <div className="text-foreground-600 mb-2">{`${placeholderName} (${formatSize(pendingInfo.sizeBytes)})`}</div>
      <div className="w-fit text-center">
        {placeholderReason}{" "}
        <Link href={`${pendingInfo.rawUrl}?a`} className="text-primary-500 inline">
          Download raw
        </Link>
        {onLoadAnyway && (
          <>
            {" or "}
            <button className="text-primary inline cursor-pointer" onClick={() => onLoadAnyway()}>
              load anyway
            </button>
            .
          </>
        )}
      </div>
    </div>
  )

  const lineNumOffset = `${Math.floor(Math.log10(pasteLineCount)) + 3}ch`
  const buttonClasses = `${tst}`

  return (
    <main
      className={`flex flex-col items-center min-h-screen transition-transform-background bg-background ${tst} text-foreground w-full p-2`}
    >
      <div className="w-full max-w-[64rem]">
        <div className="flex flex-row my-4 items-center justify-between">
          <h1 className="text-xl md:text-2xl grow inline-flex items-baseline min-w-0">
            <Link href="/" className="text-foreground-500 text-[length:inherited] shrink-0">
              <Button isIconOnly variant="light" aria-label={indexPageTitle} className={buttonClasses + " md:hidden"}>
                <HomeIcon className="size-6" />
              </Button>
              <span className="hidden md:inline">{indexPageTitle}</span>
            </Link>
            <span className="mx-2 shrink-0">{" / "}</span>
            <span className="shrink-0">{displayFilename ? name : name + (ext ?? "")}</span>
            {displayFilename && (
              <>
                <span className="mx-2 shrink-0">{" / "}</span>
                <span className="truncate min-w-0" title={displayFilename}>
                  {displayFilename}
                </span>
              </>
            )}
            <span className="ml-1 shrink-0">
              {isDecrypted === "decrypted" ? " (Decrypted)" : isDecrypted === "encrypted" ? " (Encrypted)" : ""}
            </span>
          </h1>
          <div className="flex flex-row gap-2 items-center">
            <DarkModeToggle modeSelection={modeSelection} setModeSelection={setModeSelection} />
            {showFileContent && (
              <Tooltip content={`Copy to clipboard`}>
                <CopyWidget variant="light" className={buttonClasses} getCopyContent={() => pasteStringContent!} />
              </Tooltip>
            )}
            {pasteFile ? (
              <Tooltip content={`Download as file`}>
                <Button aria-label="Download" isIconOnly variant="light" className={buttonClasses}>
                  <a href={downloadUrl} download={pasteFile.name}>
                    <DownloadIcon className="size-6 inline" />
                  </a>
                </Button>
              </Tooltip>
            ) : (
              (pendingInfo || mediaInfo) && (
                <Tooltip content={`Download as file`}>
                  <Button aria-label="Download" isIconOnly variant="light" className={buttonClasses}>
                    <a href={(pendingInfo ?? mediaInfo)!.rawUrl} download={placeholderName}>
                      <DownloadIcon className="size-6 inline" />
                    </a>
                  </Button>
                </Tooltip>
              )
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
                  <span>{`(${formatSize(mediaInfo.sizeBytes)})`}</span>
                </div>
                <MediaElement kind={mediaInfoKind} src={mediaInfo.rawUrl} name={placeholderName} />
              </div>
            ) : pasteFile && pasteMediaKind ? (
              <div>
                <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                  <span>{pasteFile.name}</span>
                  <span>{`(${formatSize(pasteFile.size)})`}</span>
                </div>
                <MediaElement kind={pasteMediaKind} src={downloadUrl} name={pasteFile.name} />
              </div>
            ) : pendingInfo && !pasteFile ? (
              <div className={"h-[10em]"}>{pendingFileIndicator}</div>
            ) : (
              pasteFile && (
                <div className={showFileContent ? "" : "h-[10em]"}>
                  {showFileContent ? (
                    <>
                      <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                        <span>{pasteFile?.name}</span>
                        <span>{`(${formatSize(pasteFile.size)})`}</span>
                        {forceShowBinary && (
                          <button className="ml-2 text-primary-500" onClick={() => setForceShowBinary(false)}>
                            (Click to hide)
                          </button>
                        )}
                        {pasteLang && <span className={"grow text-right"}>{pasteLang}</span>}
                      </div>
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
