import type React from "react"
import { useState } from "react"

import type { CardProps } from "./ui/index.js"
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CircularProgress,
  Divider,
  Input,
  Tooltip,
  mergeClasses,
} from "./ui/index.js"

import type { PasteResponse } from "../../shared/interfaces.js"
import { tst } from "../utils/overrides.js"
import type { UploadProgress } from "../utils/uploader.js"
import { formatSize } from "../utils/utils.js"
import { CopyWidget } from "./CopyWidget.js"
import { ChevronDownIcon, InfoIcon } from "./icons.js"

interface UploadedPanelProps extends CardProps {
  isLoading: boolean
  loadingProgress?: UploadProgress
  onCancel?: () => void
  pasteResponse?: PasteResponse
  encryptionKey?: string
  highlightLang?: string
  isUrlPaste?: boolean
}

function withPathPrefix(url: string, prefix: string): string {
  const u = new URL(url)
  u.pathname = prefix + u.pathname
  return u.toString()
}

function makeDecryptionUrl(url: string, key?: string): string {
  const base = withPathPrefix(url, "/d")
  return key ? `${base}#${key}` : base
}

const RAW_URL_FLAGS: { syntax: string; desc: string }[] = [
  { syntax: "?mime=…", desc: "Override the Content-Type" },
  { syntax: "?a", desc: "Force download (Content-Disposition: attachment)" },
  { syntax: ".png", desc: "Append an extension to hint MIME type" },
  { syntax: "/foo.txt", desc: "Append a filename for the downloaded file" },
]

const DISPLAY_URL_FLAGS: { syntax: string; desc: string }[] = [
  { syntax: "?lang=js", desc: "Override syntax highlighting language" },
  { syntax: "/foo.txt", desc: "Append a filename — shown in the header and used as the download name" },
]

function InfoTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip content={<div className="px-1 py-1 text-small max-w-[22rem]">{children}</div>}>
      <button
        type="button"
        aria-label="More information"
        className="inline-flex items-center ml-1 text-default-400 hover:text-default-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded"
      >
        <InfoIcon className="size-3" />
      </button>
    </Tooltip>
  )
}

function UrlTooltip({ desc, flags }: { desc?: React.ReactNode; flags?: { syntax: string; desc: string }[] }) {
  return (
    <InfoTooltip>
      {desc && <div className={flags ? "mb-2" : ""}>{desc}</div>}
      {flags && (
        <>
          <div className="font-medium mb-1">Options:</div>
          <div className="flex flex-col gap-1">
            {flags.map((f) => (
              <div key={f.syntax} className="flex flex-row gap-2 items-baseline">
                <code className="font-mono text-xs whitespace-nowrap">{f.syntax}</code>
                <span className="text-xs opacity-80">{f.desc}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </InfoTooltip>
  )
}

export function UploadedPanel({
  isLoading,
  loadingProgress,
  onCancel,
  pasteResponse,
  className,
  encryptionKey,
  highlightLang,
  isUrlPaste,
  ...rest
}: UploadedPanelProps) {
  const copyWidgetClassNames = `${tst}`
  const inputProps = {
    readOnly: true,
    className: "mb-2",
  }
  const [moreOpen, setMoreOpen] = useState<boolean>(false)

  const isEncrypted = Boolean(encryptionKey)
  const isMarkdown = highlightLang === "markdown"

  const urlInput = (label: string, value: string, labelExtra?: React.ReactNode) => (
    <Input
      {...inputProps}
      label={label}
      labelExtra={labelExtra}
      value={value}
      endContent={<CopyWidget className={copyWidgetClassNames} getCopyContent={() => value} />}
    />
  )

  const markdownUrlField = (pasteResponse: PasteResponse) =>
    urlInput(
      "Markdown URL",
      withPathPrefix(pasteResponse.url, "/a"),
      <InfoTooltip>Render the paste as GitHub-flavored markdown (with code highlighting and LaTeX).</InfoTooltip>,
    )

  return (
    <Card classNames={mergeClasses({ base: tst }, { base: className })} {...rest}>
      <CardHeader className="text-2xl pl-4 pb-2">Uploaded Paste</CardHeader>
      <Divider />
      <CardBody>
        {isLoading ? (
          <div className="w-full flex flex-col items-center justify-center gap-2 py-4">
            <CircularProgress
              aria-label={"Loading..."}
              value={loadingProgress ? (100 * loadingProgress.doneBytes) / Math.max(loadingProgress.totalBytes, 1) : 50}
            />
            {loadingProgress && (
              <span className="text-sm text-foreground-500 tabular-nums">
                Uploaded {formatSize(loadingProgress.doneBytes)} / {formatSize(loadingProgress.totalBytes)}
              </span>
            )}
            {onCancel && (
              <Button size="sm" variant="ghost" onPress={onCancel} className="mt-1">
                Cancel
              </Button>
            )}
          </div>
        ) : (
          pasteResponse && (
            <>
              <Input
                {...inputProps}
                label={"Display URL"}
                labelExtra={
                  <UrlTooltip
                    desc={
                      <>
                        Browser-friendly view with syntax highlighting.
                        {encryptionKey && (
                          <>
                            {" "}
                            The decryption key sits after the <code className="font-mono">#</code> in the URL and is
                            never sent to the server — it stays in the browser for client-side decryption.
                          </>
                        )}
                      </>
                    }
                    flags={DISPLAY_URL_FLAGS}
                  />
                }
                color={encryptionKey ? "success" : "default"}
                className="mb-2"
                value={makeDecryptionUrl(pasteResponse.url, encryptionKey)}
                endContent={
                  <CopyWidget
                    className={encryptionKey ? `${copyWidgetClassNames} hover:bg-success-100` : copyWidgetClassNames}
                    getCopyContent={() => makeDecryptionUrl(pasteResponse.url, encryptionKey)}
                  />
                }
              />
              {isMarkdown && !isEncrypted && markdownUrlField(pasteResponse)}
              {urlInput(
                "Raw URL",
                pasteResponse.url,
                <UrlTooltip
                  desc={
                    encryptionKey
                      ? "Returns the raw paste content — encrypted, since this paste uses client-side encryption. Decrypt it yourself with the key."
                      : "Returns the raw paste content directly, with the inferred Content-Type."
                  }
                  flags={RAW_URL_FLAGS}
                />,
              )}
              {urlInput(
                "Manage URL",
                pasteResponse.manageUrl,
                <InfoTooltip>Use this URL to update or delete the paste later. Keep it private.</InfoTooltip>,
              )}
              <Input {...inputProps} label={"Expiration"} value={new Date(pasteResponse.expireAt).toLocaleString()} />

              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-controls="uploaded-paste-more"
                className={
                  `mt-1 mb-2 flex flex-row items-center gap-1 text-sm text-foreground-500 cursor-pointer ` +
                  `hover:text-foreground-700 select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded ${tst}`
                }
              >
                <ChevronDownIcon aria-hidden="true" className={`w-4 h-4 ${tst} ${moreOpen ? "" : "-rotate-90"}`} />
                <span>More</span>
              </button>

              {moreOpen && (
                <div id="uploaded-paste-more">
                  {!isEncrypted && !isMarkdown && markdownUrlField(pasteResponse)}
                  {!isEncrypted &&
                    isUrlPaste &&
                    urlInput(
                      "Shortener URL",
                      withPathPrefix(pasteResponse.url, "/u"),
                      <InfoTooltip>The paste body is a URL — this endpoint redirects (302) to it.</InfoTooltip>,
                    )}
                  {urlInput(
                    "Metadata URL",
                    withPathPrefix(pasteResponse.url, "/m"),
                    <InfoTooltip>
                      Get paste metadata (size, timestamps, filename, encryption scheme, ...) as JSON.
                    </InfoTooltip>,
                  )}
                </div>
              )}
            </>
          )
        )}
      </CardBody>
    </Card>
  )
}
