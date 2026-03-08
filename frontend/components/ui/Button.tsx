import React from "react"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isIconOnly?: boolean
  onPress?: () => void
  variant?: "solid" | "ghost" | "light"
  color?: "primary" | "danger"
  size?: "sm" | "md" | "lg"
  isDisabled?: boolean
}

export function Button({
  children,
  className = "",
  isIconOnly,
  onPress,
  variant = "solid",
  color = "primary",
  size = "md",
  isDisabled,
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  const baseClass = `inline-flex items-center justify-center ${isIconOnly ? "rounded-full" : "rounded-xl"} disabled:opacity-50 disabled:cursor-not-allowed`

  const variantClass =
    variant === "solid"
      ? color === "danger"
        ? "bg-danger text-white hover:opacity-80"
        : "bg-primary text-primary-foreground hover:opacity-80"
      : variant === "ghost"
        ? "border border-default-300 hover:bg-default-100"
        : "hover:bg-default-100"

  const sizeClass = isIconOnly
    ? { sm: "p-1.5", md: "p-2", lg: "p-2.5" }[size]
    : { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" }[size]

  return (
    <button
      className={`${baseClass} ${variantClass} ${sizeClass} ${className}`}
      disabled={isDisabled || disabled}
      onClick={onPress || onClick}
      {...rest}
    >
      {children}
    </button>
  )
}
