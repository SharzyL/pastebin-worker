import { forwardRef, useMemo } from "react"
import type { ComponentPropsWithoutRef } from "react"

interface LineNumbersProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  lineCount: number
}

function lineNumberText(lineCount: number): string {
  const count = Math.max(1, Math.floor(lineCount))
  const lines = new Array<string>(count)
  for (let index = 0; index < count; index += 1) lines[index] = String(index + 1)
  return lines.join("\n")
}

export function countTextLines(content: string): number {
  let count = 1
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) count += 1
  }
  return count
}

export const LineNumbers = forwardRef<HTMLDivElement, LineNumbersProps>(
  ({ lineCount, className = "", ...props }, ref) => {
    const content = useMemo(() => lineNumberText(lineCount), [lineCount])
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={`line-number-rows m-0 whitespace-pre text-right ${className}`}
        {...props}
      >
        {content}
      </div>
    )
  },
)

LineNumbers.displayName = "LineNumbers"
