import type { ReactNode } from "react"
import { InfoIcon } from "./icons.js"
import { Tooltip } from "./ui/index.js"

interface InfoTooltipProps {
  label: string
  children: ReactNode
  compact?: boolean
}

export function InfoTooltip({ label, children, compact = false }: InfoTooltipProps) {
  return (
    <Tooltip
      content={
        <div className={compact ? "max-w-[18rem] px-1 py-1 text-small" : "max-w-[20rem] px-1 py-2 text-small"}>
          {children}
        </div>
      }
    >
      <button
        type="button"
        aria-label={label}
        className={
          compact
            ? "ml-1 inline-flex rounded text-default-400 transition-colors hover:text-default-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400"
            : "ml-2 inline-flex items-center rounded text-default-500 transition-colors hover:text-default-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400"
        }
      >
        <InfoIcon className={compact ? "size-3" : "size-3.5"} />
      </button>
    </Tooltip>
  )
}
