import type { ButtonProps } from "./ui/index.js"
import { Button, Tooltip } from "./ui/index.js"
import { ArrowsPointingInIcon, ArrowsPointingOutIcon } from "./icons.js"
import { tst } from "../utils/overrides.js"

interface FullscreenToggleProps extends ButtonProps {
  isFullscreen: boolean
  onToggle: () => void
}

// Enters or leaves viewport fullscreen (see useFullscreen). `className`
// positions the toggle, typically in a corner of the card it expands.
export function FullscreenToggle({ isFullscreen, onToggle, className = "", ...rest }: FullscreenToggleProps) {
  return (
    <div className={className}>
      <Tooltip content={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          className={tst}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={isFullscreen}
          onPress={onToggle}
          {...rest}
        >
          {isFullscreen ? <ArrowsPointingInIcon className="size-5" /> : <ArrowsPointingOutIcon className="size-5" />}
        </Button>
      </Tooltip>
    </div>
  )
}
