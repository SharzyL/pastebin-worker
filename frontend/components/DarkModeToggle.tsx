import type { JSX } from "react"
import React, { useEffect, useState, useSyncExternalStore } from "react"
import type { ButtonProps } from "./ui/index.js"
import { Button, Tooltip } from "./ui/index.js"

import { ComputerIcon, MoonIcon, SunIcon } from "./icons.js"
import { tst } from "../utils/overrides.js"

const modeSelections = ["system", "light", "dark"]
type ModeSelection = (typeof modeSelections)[number]
const icons: Record<ModeSelection, JSX.Element> = {
  system: <ComputerIcon className="size-6 inline" />,
  light: <SunIcon className="size-6 inline" />,
  dark: <MoonIcon className="size-6 inline" />,
}

export function useDarkModeSelection(): [
  boolean,
  ModeSelection | undefined,
  React.Dispatch<React.SetStateAction<ModeSelection | undefined>>,
] {
  const [modeSelection, setModeSelection] = useState<ModeSelection | undefined>(() => {
    if (typeof window === "undefined") return "system"
    const item = localStorage.getItem("darkModeSelect")
    if (item && modeSelections.includes(item)) return item
    return "system"
  })

  const isSystemDark = useSyncExternalStore<boolean>(
    (callBack) => {
      const mql = window.matchMedia("(prefers-color-scheme: dark)")
      mql.addEventListener("change", callBack)
      return () => {
        mql.removeEventListener("change", callBack)
      }
    },
    () => {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
    },
    () => false,
  )

  useEffect(() => {
    if (modeSelection) {
      localStorage.setItem("darkModeSelect", modeSelection)
    }
  }, [modeSelection])

  const isDark = modeSelection === undefined || modeSelection === "system" ? isSystemDark : modeSelection === "dark"

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.remove("light")
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
      document.documentElement.classList.add("light")
    }
  }, [isDark])

  return [isDark, modeSelection, setModeSelection]
}

interface MyComponentProps extends ButtonProps {
  modeSelection: ModeSelection | undefined
  setModeSelection: React.Dispatch<React.SetStateAction<ModeSelection | undefined>>
}

export function DarkModeToggle({ modeSelection, setModeSelection, className, ...rest }: MyComponentProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const currentMode = modeSelection || "system"

  if (!mounted) {
    return (
      <Button
        isIconOnly
        size="sm"
        variant="light"
        className={`${tst}` + " " + className}
        aria-label="Toggle dark mode"
        style={{ visibility: "hidden" }}
        {...rest}
      >
        {icons.system}
      </Button>
    )
  }

  return (
    <Tooltip content={`Toggle dark mode (currently ${currentMode} mode)`}>
      <Button
        isIconOnly
        size="sm"
        variant="light"
        className={`${tst}` + " " + className}
        aria-label="Toggle dark mode"
        onPress={() => {
          const newSelected = modeSelections[(modeSelections.indexOf(currentMode) + 1) % modeSelections.length]
          setModeSelection(newSelected)
        }}
        {...rest}
      >
        {icons[currentMode]}
      </Button>
    </Tooltip>
  )
}
