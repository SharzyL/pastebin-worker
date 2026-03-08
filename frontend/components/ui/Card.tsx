import React from "react"

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  classNames?: {
    base?: string
    header?: string
    body?: string
  }
}

export function Card({ children, className = "", classNames = {}, ...rest }: CardProps) {
  return (
    <div className={`rounded-2xl bg-content1 shadow-medium ${classNames.base || ""} ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 py-3 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardBody({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 py-3 ${className}`} {...rest}>
      {children}
    </div>
  )
}
