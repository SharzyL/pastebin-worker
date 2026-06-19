import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"

import type { LocalUploadRecord } from "../utils/localUploads.js"
import { formatSize } from "../utils/utils.js"
import { Button, Card, CardBody, Tooltip } from "./ui/index.js"
import { ChevronDownIcon, ExternalLinkIcon, FileIcon, TrashIcon } from "./icons.js"
import { CopyWidget } from "./CopyWidget.js"
import { tst } from "../utils/overrides.js"

interface LocalUploadsSidebarProps {
  uploads: LocalUploadRecord[]
  onDeleteUpload: (upload: LocalUploadRecord) => Promise<void>
  scrollToKey?: string
  className?: string
  style?: CSSProperties
}

function getDisplayName(upload: LocalUploadRecord): string {
  return upload.filename || upload.key
}

function formatTimeLeft(expireAt: string, now: number): string {
  const diffMs = new Date(expireAt).getTime() - now
  if (!Number.isFinite(diffMs)) return "Expiration unknown"
  if (diffMs <= 0) return "Expired"

  const totalMinutes = Math.ceil(diffMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor(totalMinutes / 60)

  if (days > 0) {
    return `Expires in ${days}d`
  }
  if (hours > 0) {
    return `Expires in ${hours}h`
  }
  return `Expires in ${totalMinutes}m`
}

export function LocalUploadsSidebar({
  uploads,
  onDeleteUpload,
  scrollToKey,
  className = "",
  style,
}: LocalUploadsSidebarProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const [deletingKey, setDeletingKey] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const actionClass =
    `inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-xl bg-default-100 px-2 ` +
    `text-xs text-foreground hover:bg-default-200 ${tst}`

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (scrollToKey !== undefined) {
      listRef.current?.scrollTo?.({ top: 0 })
    }
  }, [scrollToKey])

  async function deleteUpload(upload: LocalUploadRecord) {
    setDeletingKey(upload.key)
    try {
      await onDeleteUpload(upload)
    } finally {
      setDeletingKey(undefined)
    }
  }

  return (
    <aside
      className={`flex w-full flex-col xl:mt-6 xl:h-[calc(var(--local-uploads-height)-1.5rem)] xl:max-h-[calc(var(--local-uploads-height)-1.5rem)] xl:w-75 xl:overflow-hidden ${className}`}
      style={style}
    >
      {uploads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-default-300 px-4 py-4 text-sm text-default-500">
          Uploads from this browser will appear here.
        </div>
      ) : (
        <div
          ref={listRef}
          className="flex max-h-[calc(100vh-1rem)] flex-col gap-2 overflow-y-auto px-1 xl:min-h-0 xl:max-h-none xl:flex-1 xl:overscroll-contain"
        >
          {uploads.map((upload) => {
            const isExpanded = expandedKeys.has(upload.key)
            const hasFilenames = upload.filenames !== undefined && upload.filenames.length > 0
            const isDeleting = deletingKey === upload.key
            const displayName = getDisplayName(upload)

            return (
              <Card key={upload.key} className="rounded-lg border border-default-200" style={{ boxShadow: "none" }}>
                <CardBody className="px-3 pt-2 pb-1.5">
                  <div className="flex items-start gap-2">
                    <div className="mt-1 flex shrink-0 items-center justify-center text-default-600">
                      <FileIcon className="size-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={displayName}>
                        {displayName}
                      </div>
                      <div className="mt-0.5 text-xs text-default-500">{formatSize(upload.sizeBytes)}</div>
                      <div className="mt-1 text-[13px] text-default-700">{formatTimeLeft(upload.expireAt, now)}</div>

                      {hasFilenames && (
                        <>
                          <button
                            type="button"
                            className={`mt-1 inline-flex cursor-pointer items-center gap-1 text-sm text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded ${tst}`}
                            aria-expanded={isExpanded}
                            onClick={() => {
                              setExpandedKeys((current) => {
                                const next = new Set(current)
                                if (next.has(upload.key)) next.delete(upload.key)
                                else next.add(upload.key)
                                return next
                              })
                            }}
                          >
                            <ChevronDownIcon className={`size-4 ${isExpanded ? "" : "-rotate-90"}`} />
                            <span>{upload.filenames!.length} files</span>
                          </button>
                          {isExpanded && (
                            <div className="mt-2 max-h-40 overflow-auto rounded-md bg-default-100 px-2 py-1">
                              {upload.filenames!.map((file, index) => (
                                <div
                                  key={`${file.name}-${index}`}
                                  className="flex items-baseline justify-between gap-3 py-1 text-sm"
                                >
                                  <span className="min-w-0 truncate" title={file.name}>
                                    {file.name}
                                  </span>
                                  <span className="shrink-0 text-xs text-default-500">{formatSize(file.sizeBytes)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <Tooltip content="Delete" placement="bottom">
                      <Button
                        type="button"
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="danger"
                        aria-label={`Delete ${displayName}`}
                        disabled={isDeleting}
                        className="shrink-0 cursor-pointer text-default-500 hover:text-danger disabled:cursor-not-allowed"
                        onPress={() => {
                          void deleteUpload(upload)
                        }}
                      >
                        <TrashIcon className="size-5" />
                      </Button>
                    </Tooltip>
                  </div>

                  <div className="mt-1 mb-1.5 border-t border-divider" />

                  <div className="flex items-center justify-between">
                    <a
                      href={upload.displayUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={actionClass}
                    >
                      <ExternalLinkIcon className="size-6 text-default-600" />
                      <span>Open</span>
                    </a>
                    <CopyWidget
                      label="Copy link"
                      className={actionClass}
                      getCopyContent={() => upload.displayUrl}
                    />
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </aside>
  )
}
