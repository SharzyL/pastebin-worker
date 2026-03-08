import React from "react"

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>

export function Link({ children, className = "", ...rest }: LinkProps) {
  return (
    <a className={`text-primary hover:opacity-80 transition-opacity ${className}`} {...rest}>
      {children}
    </a>
  )
}
