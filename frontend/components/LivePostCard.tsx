import { useEffect, useMemo, useState } from "react"

import type { CardProps } from "./ui/index.js"
import { Button, Card, CardBody, CardHeader, Tooltip } from "./ui/index.js"
import { CodeView } from "./CodeView.js"
import { CopyWidget } from "./CopyWidget.js"
import { DownloadIcon } from "./icons.js"
import { MarkdownView } from "./MarkdownView.js"
import type { MediaKind } from "./MediaElement.js"
import { MediaElement, mediaKindOfType } from "./MediaElement.js"

import type { LiveMessage } from "../utils/live.js"
import { cardOverrides, tst } from "../utils/overrides.js"
import { formatSize } from "../utils/utils.js"

// Larger text is only offered for download: highlighting or rendering it
// would freeze the page
const MAX_INLINE_TEXT_BYTES = 512 * 1024

// Images that cannot carry script. An SVG blob opened in its own tab would run
// its script with this page's origin, so SVG is only offered for download.
const SAFE_IMAGE_MIME_RE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/i

// Kept for a while so the browser can start reading a large download
const DOWNLOAD_URL_LIFETIME_MS = 10_000

interface LivePostCardProps extends CardProps {
  msg: LiveMessage
  isOwn: boolean
}

function isMarkdown(msg: LiveMessage): boolean {
  return msg.kind === "text" && (msg.lang === "markdown" || msg.lang === "md")
}

function mimeOf(msg: LiveMessage): string {
  return msg.mime || (msg.kind === "text" ? "text/plain;charset=UTF-8" : "application/octet-stream")
}

function previewKindOf(msg: LiveMessage): MediaKind | null {
  if (msg.kind !== "file") return null
  const mime = mimeOf(msg).split(";")[0].trim()
  const kind = mediaKindOfType(mime)
  return kind === "image" && !SAFE_IMAGE_MIME_RE.test(mime) ? null : kind
}

function download(msg: LiveMessage) {
  const url = URL.createObjectURL(new Blob([msg.body as BlobPart], { type: mimeOf(msg) }))
  const a = document.createElement("a")
  a.href = url
  a.download = msg.filename || (msg.kind === "text" ? "post.txt" : "file")
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS)
}

export function LivePostCard({ msg, isOwn, ...rest }: LivePostCardProps) {
  const mediaKind = previewKindOf(msg)
  const isTextual = msg.kind === "text" || mimeOf(msg).startsWith("text/")
  const showText = isTextual && msg.body.length <= MAX_INLINE_TEXT_BYTES
  const [showRendered, setShowRendered] = useState(true)
  const canRender = isMarkdown(msg) && showText
  const isRendered = canRender && showRendered
  const text = useMemo(() => (showText ? new TextDecoder().decode(msg.body) : ""), [showText, msg.body])

  const [mediaUrl, setMediaUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (mediaKind === null) return
    const url = URL.createObjectURL(new Blob([msg.body as BlobPart], { type: mimeOf(msg) }))
    setMediaUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [mediaKind, msg])

  return (
    <Card aria-label={`Post by ${msg.author}`} classNames={cardOverrides} {...rest}>
      <CardHeader className="flex items-center justify-between gap-2 pb-0">
        <div className="text-sm min-w-0 truncate" title={msg.filename}>
          <b>{msg.author}</b>
          {isOwn && <span className="text-default-500"> (you)</span>}
          <span className="text-default-500"> · {new Date(msg.ts).toLocaleString()}</span>
          {msg.filename && <span className="text-default-500"> · {msg.filename}</span>}
          {msg.kind === "file" && <span className="text-default-500"> ({formatSize(msg.body.length)})</span>}
        </div>
        <div className="flex items-center shrink-0">
          {msg.lang && <span className="text-sm text-default-500 mr-2">{msg.lang}</span>}
          {canRender && (
            <Button
              size="sm"
              variant="light"
              aria-pressed={!showRendered}
              className="focus:ring-0 hover:bg-default-200"
              onPress={() => setShowRendered(!showRendered)}
            >
              {showRendered ? "Raw" : "Rendered"}
            </Button>
          )}
          {showText && (
            <Tooltip content="Copy to clipboard">
              <CopyWidget getCopyContent={() => text} />
            </Tooltip>
          )}
          <Tooltip content="Download as file">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              aria-label="Download"
              className="focus:ring-0 hover:bg-default-200"
              onPress={() => download(msg)}
            >
              <DownloadIcon className="size-6" />
            </Button>
          </Tooltip>
        </div>
      </CardHeader>
      <CardBody>
        <div className={`w-full rounded-lg ${isRendered ? "" : "bg-default-100 p-3"} ${tst}`}>
          {isRendered ? (
            <MarkdownView content={text} />
          ) : showText ? (
            <CodeView content={text} lang={msg.lang} />
          ) : mediaKind && mediaUrl ? (
            <MediaElement kind={mediaKind} src={mediaUrl} name={msg.filename || "attachment"} />
          ) : (
            <div className="py-6 text-center">
              {isTextual && (
                <p className="mb-1 text-default-500">Too large to display ({formatSize(msg.body.length)})</p>
              )}
              <button className="text-primary cursor-pointer" onClick={() => download(msg)}>
                Download {msg.filename || "file"}
              </button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
