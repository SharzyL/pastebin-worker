import type { ButtonProps } from "./ui/index.js"
import { Button } from "./ui/index.js"
import { useEffect, useRef, useState } from "react"
import { CopyIcon, CheckIcon } from "./icons.js"

interface CopyIconProps extends ButtonProps {
  getCopyContent: () => string
  label?: string
}

export function CopyWidget({ className = "", getCopyContent, label, ...rest }: CopyIconProps) {
  const numOfIssuedCopies = useRef(0)
  const mounted = useRef(true)
  const timeouts = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [hasIssuedCopies, setHasIssuedCopies] = useState<boolean>(false)

  useEffect(() => {
    return () => {
      mounted.current = false
      for (const timeout of timeouts.current) clearTimeout(timeout)
      timeouts.current.clear()
    }
  }, [])

  const onCopy = () => {
    const content = getCopyContent()
    navigator.clipboard
      .writeText(content)
      .then(() => {
        if (!mounted.current) return
        numOfIssuedCopies.current = numOfIssuedCopies.current + 1
        setHasIssuedCopies(numOfIssuedCopies.current > 0)

        const timeout = setTimeout(() => {
          timeouts.current.delete(timeout)
          if (!mounted.current) return
          numOfIssuedCopies.current = numOfIssuedCopies.current - 1
          setHasIssuedCopies(numOfIssuedCopies.current > 0)
        }, 1000)
        timeouts.current.add(timeout)
      })
      .catch(console.error)
  }

  return (
    <Button
      isIconOnly={label === undefined}
      size="sm"
      variant="light"
      aria-label={label || "Copy"}
      className={`cursor-pointer focus:ring-0 hover:bg-default-200 ${label ? "gap-1.5 whitespace-nowrap px-2" : ""} ${className}`}
      onPress={onCopy}
      {...rest}
    >
      {hasIssuedCopies ? (
        <CheckIcon className="size-6 text-default-600" />
      ) : (
        <CopyIcon className="size-6 text-default-600" />
      )}
      {label && <span>{hasIssuedCopies ? "Copied!" : label}</span>}
    </Button>
  )
}
