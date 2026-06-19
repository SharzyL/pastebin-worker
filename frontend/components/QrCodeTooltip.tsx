import { useEffect, useMemo, useRef, useState } from "react"
import { generate } from "lean-qr/nano"
import { toSvgDataURL } from "lean-qr/extras/svg"

import { Button, Tooltip } from "./ui/index.js"
import { QrCodeIcon } from "./icons.js"

function QrCodePreview({ value }: { value: string }) {
  const qrCodeSrc = useMemo(() => {
    try {
      return toSvgDataURL(generate(value), {
        on: "black",
        off: "white",
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
    <div className="rounded-md bg-white p-1">
      <img src={qrCodeSrc} alt="QR code" className="block h-[200px] w-[200px]" />
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
          className={`absolute z-50 w-max rounded-lg border border-default-200 bg-content1 p-1 shadow-medium ${
            actualPlacement === "top" ? "bottom-full mb-2" : "top-full mt-2"
          } left-1/2 -translate-x-1/2`}
        >
          <QrCodePreview value={value} />
        </div>
      )}
    </div>
  )
}
