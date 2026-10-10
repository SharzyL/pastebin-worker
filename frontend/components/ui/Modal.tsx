import React, { useEffect } from "react"

export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
}

export function Modal({ isOpen, onClose, children, ...rest }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose} {...rest}>
      {children}
    </div>
  )
}

export function ModalContent({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-content1 border border-divider rounded-xl shadow-xl max-w-md w-full mx-4 ${className}`}
      onClick={(e) => e.stopPropagation()}
      {...rest}
    >
      {children}
    </div>
  )
}

export function ModalHeader({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 pt-4 pb-2 text-lg font-semibold ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function ModalBody({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 py-2 text-sm text-default-500 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function ModalFooter({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 pb-4 pt-4 flex justify-end gap-2 ${className}`} {...rest}>
      {children}
    </div>
  )
}
