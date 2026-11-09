import { useEffect, useState } from "react"
import { Button, CircularProgress, Link, Tooltip } from "../components/ui/index.js"
import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { DownloadIcon, HomeIcon } from "../components/icons.js"
import { CopyWidget } from "../components/CopyWidget.js"
import { tst } from "../utils/overrides.js"
import { CodeView } from "../components/CodeView.js"
import { MediaElement, mediaKindOf, mediaKindOfType } from "../components/MediaElement.js"
import { FullscreenToggle } from "../components/FullscreenToggle.js"
import { formatSize } from "../utils/utils.js"
import { useFullscreen } from "../utils/useFullscreen.js"

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
  const showRawMedia = mediaInfo !== null && mediaInfo !== undefined && !pasteFile && mediaInfoKind !== null
  const showPasteMedia = pasteFile !== undefined && pasteMediaKind !== null
  const pasteStringContent = pasteContentBuffer && new TextDecoder().decode(pasteContentBuffer)

  // The content box can expand over the viewport; the toggle sits in its top
  // right corner either way. In fullscreen the caption row stays put as a
  // bar and the content below it scrolls.
  const [isFullscreen, setFullscreen] = useFullscreen()
  const hasContent = !isLoading && (showFileContent || showRawMedia || showPasteMedia)
  const fill = isFullscreen ? "flex-1 min-h-0 flex flex-col" : ""
  // right padding keeps the caption clear of the toggle
  const captionClasses = "text-gray-500 mb-2 pr-8 text-sm flex flex-row gap-2 items-center"
  const fullscreenToggle = hasContent && (
    <FullscreenToggle
      isFullscreen={isFullscreen}
      onToggle={() => setFullscreen(!isFullscreen)}
      className="absolute top-1.5 right-1.5 z-10"
    />
  )
  const mediaClasses = isFullscreen ? "max-h-full" : ""
  const mediaWrapperClasses = isFullscreen ? "flex-1 min-h-0 flex items-center justify-center overflow-auto" : ""

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
        <div className={isFullscreen ? `fixed inset-0 z-50 flex flex-col bg-background p-3 ${tst}` : "my-4"}>
          <div className={`w-full bg-default-100 rounded-lg p-3 relative ${tst} ${fill}`}>
            {fullscreenToggle}
            {isLoading ? (
              <div className="h-[10em] flex items-center justify-center">
                <CircularProgress label={"Loading..."} />
              </div>
            ) : showRawMedia ? (
              <div className={fill}>
                <div className={captionClasses}>
                  <span>{placeholderName}</span>
                  <span>{`(${formatSize(mediaInfo.sizeBytes)})`}</span>
                </div>
                <div className={mediaWrapperClasses}>
                  <MediaElement
                    kind={mediaInfoKind}
                    src={mediaInfo.rawUrl}
                    name={placeholderName}
                    className={mediaClasses}
                  />
                </div>
              </div>
            ) : showPasteMedia ? (
              <div className={fill}>
                <div className={captionClasses}>
                  <span>{pasteFile.name}</span>
                  <span>{`(${formatSize(pasteFile.size)})`}</span>
                </div>
                <div className={mediaWrapperClasses}>
                  <MediaElement
                    kind={pasteMediaKind}
                    src={downloadUrl}
                    name={pasteFile.name}
                    className={mediaClasses}
                  />
                </div>
              </div>
            ) : pendingInfo && !pasteFile ? (
              <div className={"h-[10em]"}>{pendingFileIndicator}</div>
            ) : (
              pasteFile && (
                <div className={showFileContent ? fill : "h-[10em]"}>
                  {showFileContent ? (
                    <>
                      <div className={captionClasses}>
                        <span>{pasteFile?.name}</span>
                        <span>{`(${formatSize(pasteFile.size)})`}</span>
                        {forceShowBinary && (
                          <button className="ml-2 text-primary-500" onClick={() => setForceShowBinary(false)}>
                            (Click to hide)
                          </button>
                        )}
                        {pasteLang && <span className={"grow text-right"}>{pasteLang}</span>}
                      </div>
                      <div className={isFullscreen ? "flex-1 min-h-0 overflow-auto" : ""}>
                        <CodeView content={pasteStringContent ?? ""} lang={pasteLang} />
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
