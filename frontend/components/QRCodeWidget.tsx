import { useMemo, useState } from "react"
import { encode } from "uqr"

import type { ButtonProps } from "./ui/index.js"
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "./ui/index.js"
import { QRCodeIcon } from "./icons.js"

// Quiet zone of 2 modules. The spec asks for 4, but scanners read 2 fine,
// and 4 makes the code look much smaller than its dialog.
const QR_BORDER = 2

// Build a single SVG path covering all dark modules, one 1x1 square each
function qrPath(data: boolean[][]): string {
  const parts: string[] = []
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`)
    })
  })
  return parts.join("")
}

export function QRCode({ value, className }: { value: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: QR_BORDER })
    return { size: qr.size, path: qrPath(qr.data) }
  }, [value])

  // Dark on white, inverted in dark mode so the code does not show as a white
  // block. Most phone scanners read inverted codes, though some older ones do not.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
      className={className}
    >
      <rect width={size} height={size} className="fill-white dark:fill-transparent" />
      <path d={path} className="fill-black dark:fill-white" />
    </svg>
  )
}

interface QRCodeWidgetProps extends ButtonProps {
  label: string
  getContent: () => string
}

export function QRCodeWidget({ className, label, getContent, ...rest }: QRCodeWidgetProps) {
  const [content, setContent] = useState<string | undefined>(undefined)
  const onClose = () => setContent(undefined)

  return (
    <>
      <Button
        isIconOnly
        size="sm"
        variant="light"
        aria-label="Show QR code"
        className={`focus:ring-0 hover:bg-default-200 ${className}`}
        onPress={() => setContent(getContent())}
        {...rest}
      >
        <QRCodeIcon className="size-6" />
      </Button>
      <Modal isOpen={content !== undefined} onClose={onClose}>
        <ModalContent role="dialog" aria-modal="true" aria-label={`${label} QR code`}>
          <ModalHeader>{label}</ModalHeader>
          {content !== undefined && (
            <ModalBody className="flex flex-col items-center gap-3">
              <QRCode value={content} className="w-full rounded-lg" />
              <code className="font-mono text-xs break-all text-center">{content}</code>
            </ModalBody>
          )}
          <ModalFooter>
            <Button variant="solid" onPress={onClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
