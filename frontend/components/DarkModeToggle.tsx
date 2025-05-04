import React, { JSX, useEffect, useState, useSyncExternalStore } from "react"
import { ComputerIcon, MoonIcon, SunIcon } from "./icons.js"
import { Button, ButtonProps, Tooltip } from "@heroui/react"
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
  const [modeSelection, setModeSelection] = useState<ModeSelection | undefined>(undefined)

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

  useEffect(() => {
    const item = localStorage.getItem("darkModeSelect")
    let storedSelect: ModeSelection | undefined
    if (item !== null) {
      if (item && modeSelections.includes(item)) {
        storedSelect = item
      } else {
        storedSelect = "system"
      }
    } else {
      storedSelect = "system"
    }
    setModeSelection(storedSelect)
  }, [])

  const isDark = modeSelection === undefined || modeSelection === "system" ? isSystemDark : modeSelection === "dark"

  useEffect(() => {
    if (isDark) {
      document.body.classList.remove("light")
      document.body.classList.add("dark")
    } else {
      document.body.classList.remove("dark")
      document.body.classList.add("light")
    }
  }, [isDark])

  return [isDark, modeSelection, setModeSelection]
}

interface MyComponentProps extends ButtonProps {
  modeSelection: ModeSelection | undefined
  setModeSelection: React.Dispatch<React.SetStateAction<ModeSelection | undefined>>
}

export function DarkModeToggle({ modeSelection, setModeSelection, className, ...rest }: MyComponentProps) {
  return modeSelection ? (
    <Tooltip content={`Toggle dark mode (currently ${modeSelection} mode)`}>
      <Button
        isIconOnly
        className={`mr-2 rounded-full ${tst} bg-background hover:bg-default-100` + " " + className}
        aria-label="Toggle dark mode"
        onPress={() => {
          const newSelected = modeSelections[(modeSelections.indexOf(modeSelection) + 1) % modeSelections.length]
          setModeSelection(newSelected)
        }}
        {...rest}
      >
        {icons[modeSelection]}
      </Button>
    </Tooltip>
  ) : null
}
