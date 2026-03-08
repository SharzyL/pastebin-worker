import React, { useState, useRef, useEffect } from "react"

export interface SelectItemProps {
  children: React.ReactNode
  value?: string
}

export function SelectItem({ children }: SelectItemProps) {
  return <>{children}</>
}

export interface SelectProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  label?: string
  size?: "sm" | "md" | "lg"
  selectedKeys?: string[]
  onSelectionChange?: (keys: Set<string>) => void
  classNames?: {
    base?: string
    trigger?: string
    listbox?: string
  }
  children: React.ReactNode
}

export function Select({
  label,
  size: _size = "md",
  selectedKeys = [],
  onSelectionChange,
  className,
  classNames = {},
  children,
  ...rest
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
        setFocusedIndex(-1)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const items = React.Children.toArray(children).filter((child): child is React.ReactElement<SelectItemProps> =>
    React.isValidElement(child),
  )

  const selected = items.find((item) => {
    const itemValue = item.props.value ?? String(item.key).replace(/^\.\$/, "")
    return selectedKeys.includes(itemValue)
  })
  const displayText = selected?.props.children || label || "Select..."

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault()
        setIsOpen(true)
        setFocusedIndex(0)
      }
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setFocusedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault()
      const item = items[focusedIndex]
      const itemValue = item.props.value ?? String(item.key).replace(/^\.\$/, "")
      onSelectionChange?.(new Set([itemValue]))
      setIsOpen(false)
      setFocusedIndex(-1)
    } else if (e.key === "Escape") {
      setIsOpen(false)
      setFocusedIndex(-1)
    }
  }

  return (
    <div ref={ref} className={`relative ${classNames.base || ""} ${className || ""}`} {...rest}>
      {label && <label className="pl-1 text-sm text-default-500 block mb-1.5">{label}</label>}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className={`w-full px-3 py-2 bg-default-100 border border-default-200 rounded-xl text-left text-sm hover:border-default-300 transition-colors ${classNames.trigger || ""}`}
      >
        {displayText}
      </button>
      {isOpen && (
        <div
          className={`absolute z-10 left-0 right-0 mt-1 bg-content1 border border-default-200 rounded-lg max-h-60 overflow-hidden shadow-medium ${classNames.listbox || ""}`}
        >
          <div className="overflow-auto max-h-60">
            {items.map((item, index) => {
              const itemValue = item.props.value ?? String(item.key).replace(/^\.\$/, "")
              return (
                <button
                  key={itemValue}
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    onSelectionChange?.(new Set([itemValue]))
                    setIsOpen(false)
                    setFocusedIndex(-1)
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors whitespace-nowrap ${index === focusedIndex ? "bg-default-100" : "hover:bg-default-100"}`}
                >
                  {item.props.children}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
