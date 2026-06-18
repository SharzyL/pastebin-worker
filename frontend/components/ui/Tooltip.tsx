import React, { useId, useState, useRef, useEffect } from "react"

interface TriggerProps {
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onFocus?: () => void
  onBlur?: () => void
  "aria-describedby"?: string
}

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactElement<TriggerProps>
  placement?: "auto" | "top" | "bottom"
}

export function Tooltip({ content, children, placement = "auto" }: TooltipProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState<"top" | "bottom">("top")
  const [align, setAlign] = useState<"center" | "left" | "right">("center")
  const tooltipRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipId = `tooltip-${useId()}`

  useEffect(() => {
    if (show && tooltipRef.current && containerRef.current) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect()
      const containerRect = containerRef.current.getBoundingClientRect()

      // Check vertical position
      if (placement !== "auto") {
        setPosition(placement)
      } else if (containerRect.top - tooltipRect.height - 8 < 0) {
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
  }, [placement, show])

  // Compose aria-describedby with whatever the child already had so we don't clobber.
  const existingDescribedBy = children.props["aria-describedby"]
  const triggerProps: TriggerProps = {
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false),
  }

  if (show) {
    triggerProps["aria-describedby"] = existingDescribedBy ? `${existingDescribedBy} ${tooltipId}` : tooltipId
  } else if (existingDescribedBy) {
    triggerProps["aria-describedby"] = existingDescribedBy
  }

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex translate-y-[0.05em] ${show ? "z-50" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && show) {
          setShow(false)
        }
      }}
    >
      {React.cloneElement(children, triggerProps)}
      {show && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className={`absolute z-50 px-2 py-1 text-sm bg-gray-800 text-white rounded shadow-lg w-max pointer-events-none ${
            position === "top" ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "center" ? "left-1/2 -translate-x-1/2" : align === "left" ? "left-0" : "right-0"}`}
        >
          {content}
        </div>
      )}
    </div>
  )
}
