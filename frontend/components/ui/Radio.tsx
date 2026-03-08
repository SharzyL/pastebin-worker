import React, { createContext, useContext } from "react"

interface RadioGroupContextValue {
  value: string
  onChange: (value: string) => void
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null)

export interface RadioGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
}

export function RadioGroup({ value, onValueChange, children, className = "", ...rest }: RadioGroupProps) {
  return (
    <RadioGroupContext.Provider value={{ value, onChange: onValueChange }}>
      <div className={`flex flex-col gap-2 ${className}`} {...rest}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  )
}

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  value: string
  description?: string
  classNames?: {
    base?: string
    label?: string
    labelWrapper?: string
    description?: string
  }
}

export function Radio({ value, children, description, classNames = {}, className = "", ...rest }: RadioProps) {
  const context = useContext(RadioGroupContext)
  if (!context) throw new Error("Radio must be used within RadioGroup")

  const isChecked = context.value === value

  return (
    <label className={`flex items-center gap-2 cursor-pointer ${classNames.base || className}`}>
      <input
        type="radio"
        checked={isChecked}
        onChange={() => context.onChange(value)}
        className="w-4 h-4 text-primary bg-transparent border-2 border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary"
        {...rest}
      />
      <div className={classNames.labelWrapper || ""}>
        <div className={`text-sm ${classNames.label || ""}`}>{children}</div>
        {description && (
          <div className={`text-xs text-gray-400 mt-0.2 ${classNames.description || ""}`}>{description}</div>
        )}
      </div>
    </label>
  )
}
