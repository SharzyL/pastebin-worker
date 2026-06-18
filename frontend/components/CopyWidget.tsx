import type { ButtonProps } from "./ui/index.js"
import { Button } from "./ui/index.js"
import { useRef, useState } from "react"
import { CopyIcon, CheckIcon } from "./icons.js"

interface CopyIconProps extends ButtonProps {
  getCopyContent: () => string
  label?: string
}

export function CopyWidget({ className = "", getCopyContent, label, ...rest }: CopyIconProps) {
  const numOfIssuedCopies = useRef(0)
  const [hasIssuedCopies, setHasIssuedCopies] = useState<boolean>(false)
  const onCopy = () => {
    const content = getCopyContent()
    navigator.clipboard
      .writeText(content)
      .then(() => {
        numOfIssuedCopies.current = numOfIssuedCopies.current + 1
        setHasIssuedCopies(numOfIssuedCopies.current > 0)

        setTimeout(() => {
          numOfIssuedCopies.current = numOfIssuedCopies.current - 1
          setHasIssuedCopies(numOfIssuedCopies.current > 0)
        }, 1000)
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
      {hasIssuedCopies ? <CheckIcon className="size-6" /> : <CopyIcon className="size-6" />}
      {label && <span>{label}</span>}
    </Button>
  )
}
