import React from "react"

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string
  size?: "sm" | "md" | "lg"
  description?: string
  errorMessage?: string
  isInvalid?: boolean
  isRequired?: boolean
  color?: "default" | "success"
  startContent?: React.ReactNode
  endContent?: React.ReactNode
  onValueChange?: (value: string) => void
  classNames?: {
    base?: string
    label?: string
    input?: string
    description?: string
    errorMessage?: string
  }
}

export function Input({
  label,
  size: _size,
  description,
  errorMessage,
  isInvalid,
  isRequired,
  color = "default",
  startContent,
  endContent,
  onValueChange,
  className = "",
  classNames = {},
  onChange,
  defaultValue: _defaultValue,
  ...rest
}: InputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e)
    onValueChange?.(e.target.value)
  }

  const borderColor = isInvalid
    ? "border-danger focus:border-danger"
    : color === "success"
      ? "border-success focus:border-success"
      : "border-default-200 focus:border-default-400 hover:border-default-300"

  return (
    <div className={`flex flex-col gap-1.5 ${classNames.base || className}`}>
      {label && (
        <label className={`pl-1 text-sm text-default-500 ${classNames.label || ""}`}>
          {label}
          {isRequired && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative flex items-center">
        {startContent && <div className="absolute left-3 z-10">{startContent}</div>}
        <input
          aria-label={label}
          aria-invalid={isInvalid}
          className={`w-full px-3 py-2 bg-default-100 border rounded-xl text-sm text-foreground transition-colors focus:outline-none ${borderColor} ${startContent ? "pl-10" : ""} ${endContent ? "pr-10" : ""} ${classNames.input || ""}`}
          onChange={handleChange}
          {...rest}
        />
        {endContent && <div className="absolute right-1 z-10">{endContent}</div>}
      </div>
      {(description || errorMessage) && (
        <div
          className={`pl-1 text-xs ${isInvalid ? "text-danger" : "text-default-500"} ${classNames.description || classNames.errorMessage || ""}`}
        >
          {isInvalid ? errorMessage : description}
        </div>
      )}
    </div>
  )
}
