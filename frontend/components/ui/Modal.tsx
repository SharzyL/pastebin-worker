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
      className={`bg-gray-900 border border-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 ${className}`}
      onClick={(e) => e.stopPropagation()}
      {...rest}
    >
      {children}
    </div>
  )
}

export function ModalHeader({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-6 py-4 border-b border-gray-800 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function ModalBody({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-6 py-4 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function ModalFooter({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-6 py-4 border-t border-gray-800 flex justify-end gap-2 ${className}`} {...rest}>
      {children}
    </div>
  )
}
