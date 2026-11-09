import { useEffect, useState } from "react"

// Expands an element to fill the viewport. The element itself only switches
// to `fixed inset-0`; this hook keeps the page behind it from scrolling and
// leaves fullscreen on Escape. An Escape that a dropdown or dialog consumed
// (marked with preventDefault) does not leave fullscreen.
//
// This is not the browser's Fullscreen API: that one is unavailable for
// non-video elements on iOS and swallows Escape itself.
export function useFullscreen(): [boolean, (fullscreen: boolean) => void] {
  const [isFullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!isFullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setFullscreen(false)
    }
    // on window, so that document listeners (dialogs) run first and can mark the key handled
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [isFullscreen])

  return [isFullscreen, setFullscreen]
}
