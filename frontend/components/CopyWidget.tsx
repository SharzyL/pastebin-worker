import { Button, ButtonProps } from "@heroui/react"
import { useRef, useState } from "react"
import { CopyIcon, CheckIcon } from "./icons.js"

interface CopyIconProps extends ButtonProps {
  getCopyContent: () => string
}

export function CopyWidget({ className, getCopyContent, ...rest }: CopyIconProps) {
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
    <Button isIconOnly aria-label="Copy" className={className} onPress={onCopy} {...rest}>
      {hasIssuedCopies ? <CheckIcon className="size-6" /> : <CopyIcon className="size-6" />}
    </Button>
  )
}
