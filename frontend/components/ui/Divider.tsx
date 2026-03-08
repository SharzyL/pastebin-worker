import React from "react"

export type DividerProps = React.HTMLAttributes<HTMLHRElement>

export function Divider({ className = "", ...rest }: DividerProps) {
  return <hr className={`border-t-1 border-default-200 ${className}`} {...rest} />
}
