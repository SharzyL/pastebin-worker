import { useEffect, useMemo, useRef, useState } from "react"
import { generate } from "lean-qr/nano"
import { toSvgDataURL } from "lean-qr/extras/svg"

import { Button, Tooltip } from "./ui/index.js"
import { QrCodeIcon } from "./icons.js"

function getIsDarkMode() {
  if (typeof document === "undefined") return false
  return document.documentElement.classList.contains("dark")
}

function QrCodePreview({ value }: { value: string }) {
  const qrCodeSrc = useMemo(() => {
    const isDarkMode = getIsDarkMode()
    try {
      return toSvgDataURL(generate(value), {
        on: "black",
        off: isDarkMode ? "#dddddd" : "white",
        pad: 1,
        width: 200,
        height: 200,
      })
    } catch {
      return undefined
    }
  }, [value])

  if (qrCodeSrc === undefined) {
    return <div className="px-2 py-1 text-sm">QR code unavailable</div>
  }

  return (
    <div className="rounded-md bg-white p-1 dark:bg-[#dddddd]">
      <img
        src={qrCodeSrc}
        alt="QR code"
        className="block aspect-square max-w-[200px]"
        style={{ width: "min(200px, calc(100vw - 3rem))" }}
      />
    </div>
  )
}

export function QrCodeTooltip({
  value,
  placement = "top",
  className = "",
  tooltip,
}: {
  value: string
  placement?: "auto" | "top" | "bottom"
  className?: string
  tooltip?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const actualPlacement = placement === "auto" ? "top" : placement

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  const button = (
    <Button
      type="button"
      isIconOnly
      size="sm"
      variant="light"
      aria-label={tooltip ?? "Show QR code"}
      aria-expanded={open}
      className={`cursor-pointer text-default-600 focus:ring-0 ${className || "hover:bg-default-200"}`}
      onPress={() => setOpen((current) => !current)}
    >
      <QrCodeIcon className="size-6" />
    </Button>
  )

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex ${open ? "z-50" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false)
        }
      }}
    >
      {tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button}
      {open && (
        <div
          role="dialog"
          aria-label="QR code"
          className={`absolute right-0 z-50 h-fit w-fit max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border border-default-200 bg-content1 p-1 shadow-medium ${
            actualPlacement === "top" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <QrCodePreview value={value} />
        </div>
      )}
    </div>
  )
}
