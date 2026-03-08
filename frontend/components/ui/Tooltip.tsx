import React, { useState, useRef, useEffect } from "react"

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactElement<{ onMouseEnter?: () => void; onMouseLeave?: () => void }>
}

export function Tooltip({ content, children }: TooltipProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState<"top" | "bottom">("top")
  const [align, setAlign] = useState<"center" | "left" | "right">("center")
  const tooltipRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (show && tooltipRef.current && containerRef.current) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect()
      const containerRect = containerRef.current.getBoundingClientRect()

      // Check vertical position
      if (containerRect.top - tooltipRect.height - 8 < 0) {
        setPosition("bottom")
      } else {
        setPosition("top")
      }

      // Check horizontal position
      const centerX = containerRect.left + containerRect.width / 2
      const tooltipHalfWidth = tooltipRect.width / 2

      if (centerX - tooltipHalfWidth < 0) {
        setAlign("left")
      } else if (centerX + tooltipHalfWidth > window.innerWidth) {
        setAlign("right")
      } else {
        setAlign("center")
      }
    }
  }, [show])

  return (
    <div ref={containerRef} className="relative inline-block">
      {React.cloneElement(children, {
        onMouseEnter: () => setShow(true),
        onMouseLeave: () => setShow(false),
      })}
      {show && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 px-2 py-1 text-sm bg-gray-800 text-white rounded shadow-lg w-max max-w-xs pointer-events-none ${
            position === "top" ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "center" ? "left-1/2 -translate-x-1/2" : align === "left" ? "left-0" : "right-0"}`}
        >
          {content}
        </div>
      )}
    </div>
  )
}
