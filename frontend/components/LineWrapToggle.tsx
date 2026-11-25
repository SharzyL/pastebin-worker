import { useEffect, useState } from "react"
import type { ButtonProps } from "./ui/index.js"
import { Button, Tooltip } from "./ui/index.js"
import { WrapLinesIcon } from "./icons.js"
import { tst } from "../utils/overrides.js"

const storageKey = "wrapLines"

// Whether long lines of code wrap, remembered across pages. It starts off and
// is read from storage only after mount, so the SSR markup hydrates as is.
export function useLineWrap(): [boolean, (wrap: boolean) => void] {
  const [wrap, setWrap] = useState(false)

  useEffect(() => {
    setWrap(localStorage.getItem(storageKey) === "true")
  }, [])

  const update = (wrap: boolean) => {
    setWrap(wrap)
    localStorage.setItem(storageKey, String(wrap))
  }

  return [wrap, update]
}

interface LineWrapToggleProps extends ButtonProps {
  wrap: boolean
  onToggle: () => void
}

export function LineWrapToggle({ wrap, onToggle, ...rest }: LineWrapToggleProps) {
  return (
    <Tooltip content={wrap ? "Don't wrap long lines" : "Wrap long lines"}>
      <Button
        isIconOnly
        size="sm"
        variant="light"
        className={tst}
        aria-label="Wrap lines"
        aria-pressed={wrap}
        onPress={onToggle}
        {...rest}
      >
        <WrapLinesIcon className={`size-5 ${wrap ? "text-primary" : ""}`} />
      </Button>
    </Tooltip>
  )
}
