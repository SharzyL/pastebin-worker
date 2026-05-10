import React, { useRef } from "react"
import { XIcon } from "../icons.js"

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string
  labelExtra?: React.ReactNode
  size?: "sm" | "md" | "lg"
  description?: string
  errorMessage?: string
  warningMessage?: string
  successMessage?: string
  isInvalid?: boolean
  isRequired?: boolean
  isClearable?: boolean
  color?: "default" | "success"
  startContent?: React.ReactNode
  endContent?: React.ReactNode
  onValueChange?: (value: string) => void
  onClear?: () => void
  classNames?: {
    base?: string
    label?: string
    input?: string
    box?: string
    description?: string
    errorMessage?: string
  }
}

export function Input({
  label,
  labelExtra,
  size: _size,
  description,
  errorMessage,
  warningMessage,
  successMessage,
  isInvalid,
  isRequired,
  isClearable,
  color = "default",
  startContent,
  endContent,
  onValueChange,
  onClear,
  className = "",
  classNames = {},
  onChange,
  defaultValue: _defaultValue,
  value,
  ...rest
}: InputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e)
    onValueChange?.(e.target.value)
  }

  const handleClear = () => {
    onValueChange?.("")
    onClear?.()
    inputRef.current?.focus()
  }

  const showClearButton = isClearable && value !== undefined && value !== ""

  const borderColor = isInvalid
    ? "border-danger focus-within:border-danger"
    : color === "success"
      ? "border-success focus-within:border-success"
      : "border-default-200 focus-within:border-default-400 hover:border-default-400"
  const boxBg = color === "success" ? "bg-success-50" : "bg-default-100"

  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className} ${classNames.base || ""}`}>
      {label && (
        <label className={`pl-1 text-sm text-default-500 ${classNames.label || ""}`}>
          {label}
          {isRequired && <span className="text-red-500 ml-1">*</span>}
          {labelExtra}
        </label>
      )}
      <div
        className={`flex items-center ${boxBg} border rounded-xl color-tst ${borderColor} ${startContent || endContent || showClearButton ? "px-3" : ""} ${classNames.box || ""}`}
      >
        {startContent && <div className="flex-shrink-0">{startContent}</div>}
        <input
          ref={inputRef}
          aria-label={label}
          aria-invalid={isInvalid}
          className={`flex-1 py-2 bg-transparent text-sm text-foreground focus:outline-none color-tst ${startContent || endContent || showClearButton ? "" : "px-3"} ${classNames.input || ""}`}
          onChange={handleChange}
          value={value}
          {...rest}
        />
        {showClearButton && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClear}
            className="flex-shrink-0 text-default-400 hover:text-default-700 color-tst focus:outline-none"
            aria-label="Clear input"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
        {endContent && <div className="flex-shrink-0">{endContent}</div>}
      </div>
      {(description || errorMessage || warningMessage || successMessage) && (
        <div
          className={`pl-1 text-xs ${
            isInvalid ? "text-danger" : warningMessage ? "text-yellow-600" : "text-default-500"
          } ${classNames.description || classNames.errorMessage || ""}`}
        >
          {isInvalid ? errorMessage : warningMessage || successMessage || description}
        </div>
      )}
    </div>
  )
}
