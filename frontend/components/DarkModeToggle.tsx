import React, { JSX, useEffect } from "react"
import { computerIcon, moonIcon, sunIcon } from "../icons.js"
import { Tooltip, TooltipProps } from "@heroui/react"

export type DarkMode = "dark" | "light" | "system"

interface MyComponentProps extends TooltipProps {
  mode: DarkMode
  onModeChange: (newMode: DarkMode) => void
}

const icons: { name: DarkMode; icon: JSX.Element }[] = [
  { name: "system", icon: computerIcon },
  { name: "dark", icon: moonIcon },
  { name: "light", icon: sunIcon },
]

export function defaultDarkMode(): DarkMode {
  const storedDarkModeSelect = localStorage.getItem("darkModeSelect")

  if (storedDarkModeSelect !== null && ["light", "dark", "system"].includes(storedDarkModeSelect)) {
    return storedDarkModeSelect as DarkMode
  } else {
    return "system"
  }
}

export function shouldBeDark(mode: DarkMode): boolean {
  // when matchMedia not available (e.g. in tests), set to light mode
  const systemDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  return mode === "system" ? systemDark : mode === "dark"
}

export function DarkModeToggle({ mode, onModeChange, ...rest }: MyComponentProps) {
  useEffect(() => {
    localStorage.setItem("darkModeSelect", mode)
  }, [mode])

  return (
    <Tooltip content="Toggle Dark Mode" {...rest}>
      <span
        className="absolute right-0"
        data-testid="pastebin-darkmode-toggle"
        onClick={() => {
          const curModeIdx = icons.findIndex(({ name }) => name === mode)
          onModeChange(icons[(curModeIdx + 1) % icons.length].name)
        }}
      >
        {icons.find(({ name }) => name === mode)!.icon}
      </span>
    </Tooltip>
  )
}
