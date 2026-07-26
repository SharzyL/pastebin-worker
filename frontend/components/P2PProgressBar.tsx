import { formatSize, formatSpeed } from "../utils/utils.js"
import type { P2PConnectionRoute, P2PProgress } from "../utils/p2pCommon.js"
import { DirectConnectionIcon, RelayConnectionIcon } from "./icons.js"

interface P2PProgressBarProps {
  progress?: P2PProgress
  label?: string
  connectionRoute?: P2PConnectionRoute
  status?: string
  reserveTransferStatsSpace?: boolean
}

function progressPercent(progress?: P2PProgress): number {
  if (!progress) return 0
  return Math.min(100, Math.max(0, Math.round((100 * progress.doneBytes) / Math.max(progress.totalBytes, 1))))
}

function remainingTime(progress?: P2PProgress): string {
  if (!progress?.speedBytesPerSecond || progress.doneBytes >= progress.totalBytes) return "00:00"

  const seconds = Math.max(0, Math.ceil((progress.totalBytes - progress.doneBytes) / progress.speedBytesPerSecond))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const restSeconds = seconds % 60
  const minuteText = String(minutes).padStart(2, "0")
  const secondText = String(restSeconds).padStart(2, "0")

  return hours > 0 ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`
}

function progressSizeLabel(progress?: P2PProgress): string {
  if (!progress) return ""
  return `${formatSize(progress.doneBytes)} / ${formatSize(progress.totalBytes)}`
}

function statusLabel(status?: string): string | undefined {
  if (status === "READY") return "Ready"
  if (status === "UPLOADING") return "Sending"
  if (status === "DOWNLOADING") return "Receiving"
  if (status === "VERIFYING") return "Verifying"
  if (status === "REPAIRING") return "REPAIRING"
  if (status === "PAUSED") return "Paused"
  if (status === "WAITING") return "Waiting to resume"
  if (status === "RECONNECTING") return "Reconnecting"
  if (status === "STOPPED") return "Stopped"
  if (status === "DONE") return "Done"
  return status
}

function statusClassName(status?: string): string {
  if (status === "DONE") return "bg-success-100 text-success"
  if (status === "DOWNLOADING" || status === "UPLOADING" || status === "RECONNECTING")
    return "bg-primary-100 text-primary"
  if (status === "VERIFYING") return "bg-primary-50 text-primary"
  if (status === "REPAIRING") return "bg-danger-100 text-danger"
  return "bg-default-200 text-default-600"
}

export function P2PProgressBar({
  progress,
  label,
  connectionRoute,
  status,
  reserveTransferStatsSpace = false,
}: P2PProgressBarProps) {
  const percent = progressPercent(progress)
  const sizeLabel = progressSizeLabel(progress)
  const displayStatus = statusLabel(status)
  const showTransferStats =
    progress !== undefined &&
    status !== "DONE" &&
    status !== "PAUSED" &&
    status !== "WAITING" &&
    status !== "RECONNECTING" &&
    status !== "STOPPED"

  return (
    <div className="w-full text-left">
      {(label || connectionRoute || displayStatus || sizeLabel) && (
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            {label && (
              <span className="min-w-0 truncate text-left font-medium" title={label}>
                {label}
              </span>
            )}
            {connectionRoute && (
              <span
                role="img"
                aria-label={connectionRoute === "direct" ? "Direct P2P connection" : "Relayed through TURN"}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-default-200 text-default-600"
                title={connectionRoute === "direct" ? "Direct P2P connection" : "Relayed through TURN"}
              >
                {connectionRoute === "direct" ? (
                  <DirectConnectionIcon aria-hidden="true" className="size-4" />
                ) : (
                  <RelayConnectionIcon aria-hidden="true" className="size-4" />
                )}
              </span>
            )}
            {displayStatus && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClassName(status)}`}>
                {displayStatus}
              </span>
            )}
          </div>
          {sizeLabel && <span className="shrink-0 text-xs text-foreground-500 tabular-nums">{sizeLabel}</span>}
        </div>
      )}
      <div className="relative h-8 w-full overflow-hidden rounded bg-default-200">
        <div className="h-full rounded bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-xs font-semibold text-white mix-blend-difference">
          {percent}%
        </span>
      </div>
      {(showTransferStats || reserveTransferStatsSpace) && (
        <div
          className={`mt-2 flex items-center justify-between text-sm text-foreground-500 tabular-nums ${showTransferStats ? "visible" : "invisible"}`}
        >
          <span>{formatSpeed(progress?.speedBytesPerSecond ?? 0)}</span>
          <span>{remainingTime(progress)}</span>
        </div>
      )}
    </div>
  )
}
