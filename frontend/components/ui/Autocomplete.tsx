import React, { useState, useRef, useEffect } from "react"

export interface AutocompleteItemProps {
  value: string
  children: string
}

export function AutocompleteItem({ children }: AutocompleteItemProps) {
  return <>{children}</>
}

export interface AutocompleteProps {
  label?: string
  size?: "sm" | "md" | "lg"
  inputValue?: string
  selectedKey?: string | null
  defaultItems?: { key: string }[]
  onInputChange?: (value: string) => void
  onSelectionChange?: (key: string | null) => void
  className?: string
  classNames?: {
    base?: string
    input?: string
    listbox?: string
  }
  children: (item: { key: string }) => React.ReactElement<AutocompleteItemProps>
  placeholder?: string
  readOnly?: boolean
}

export function Autocomplete({
  label,
  size: _size = "md",
  inputValue = "",
  selectedKey,
  defaultItems = [],
  onInputChange,
  onSelectionChange,
  className,
  classNames = {},
  children,
  placeholder,
  readOnly,
}: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [internalValue, setInternalValue] = useState(selectedKey || inputValue)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setInternalValue(selectedKey || inputValue)
  }, [selectedKey, inputValue])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const filtered = defaultItems.filter((item) => item.key.toLowerCase().includes(internalValue.toLowerCase()))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setFocusedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault()
      const item = filtered[focusedIndex]
      onSelectionChange?.(item.key)
      setInternalValue(item.key)
      onInputChange?.(item.key)
      setIsOpen(false)
      setFocusedIndex(-1)
    } else if (e.key === "Escape") {
      setIsOpen(false)
      setFocusedIndex(-1)
    }
  }

  return (
    <div ref={ref} className={`relative ${classNames.base || ""} ${className || ""}`}>
      {label && <label className="pl-1 text-sm text-default-500 block mb-1.5">{label}</label>}
      <input
        type="text"
        value={internalValue}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => {
          const val = e.target.value
          setInternalValue(val)
          onInputChange?.(val)
          setIsOpen(true)
          setFocusedIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsOpen(true)}
        className={`w-full px-3 py-2 bg-default-100 border border-default-200 rounded-xl text-sm text-foreground hover:border-default-300 focus:border-default-400 focus:outline-none transition-colors ${classNames.input || ""}`}
      />
      {isOpen && filtered.length > 0 && (
        <div
          className={`absolute z-10 w-full mt-1 bg-content1 border border-default-200 rounded-lg overflow-hidden shadow-medium ${classNames.listbox || ""}`}
        >
          <div className="overflow-auto max-h-60">
            {filtered.map((item, index) => {
              const element = children(item)
              return (
                <button
                  key={item.key}
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    onSelectionChange?.(item.key)
                    setInternalValue(item.key)
                    onInputChange?.(item.key)
                    setIsOpen(false)
                    setFocusedIndex(-1)
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${index === focusedIndex ? "bg-default-100" : "hover:bg-default-100"}`}
                >
                  {element.props.children as React.ReactNode}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
