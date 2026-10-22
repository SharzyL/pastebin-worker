import React from "react"

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  isSelected?: boolean
  onValueChange?: (checked: boolean) => void
  classNames?: {
    base?: string
    wrapper?: string
    thumb?: string
  }
}

export function Switch({
  isSelected,
  onValueChange,
  onKeyDown,
  children,
  classNames = {},
  className = "",
  ...rest
}: SwitchProps) {
  const checked = isSelected ?? false

  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer ${classNames.base || className}`}>
      <div className={`relative w-11 h-6 ${classNames.wrapper || ""}`}>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onValueChange?.(e.target.checked)}
          // checkboxes only toggle with Space; switches commonly take Enter too
          onKeyDown={(e) => {
            onKeyDown?.(e)
            if (e.key === "Enter" && !e.defaultPrevented) {
              e.preventDefault()
              onValueChange?.(!checked)
            }
          }}
          className="sr-only peer"
          {...rest}
        />
        <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-default-400 transition-colors" />
        <div
          className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5 ${classNames.thumb || ""}`}
        />
      </div>
      {children}
    </label>
  )
}
