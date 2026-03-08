import React from "react"

export interface CircularProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  label?: string
}

export function CircularProgress({ value, label, className = "", ...rest }: CircularProgressProps) {
  const radius = 20
  const circumference = 2 * Math.PI * radius
  const progress = value !== undefined ? ((100 - value) / 100) * circumference : 0

  return (
    <div className={`inline-flex flex-col items-center gap-2 ${className}`} {...rest}>
      <svg width="48" height="48" viewBox="0 0 48 48" className="animate-spin">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="4" opacity="0.25" />
        {value !== undefined && (
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={progress}
            strokeLinecap="round"
            transform="rotate(-90 24 24)"
          />
        )}
      </svg>
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
