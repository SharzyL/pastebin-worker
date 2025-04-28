import React, { JSX, useEffect } from "react"
import { ComputerIcon, MoonIcon, SunIcon } from "../icons.js"
import { Tooltip, TooltipProps } from "@heroui/react"

export type DarkMode = "dark" | "light" | "system"

interface MyComponentProps extends TooltipProps {
  mode: DarkMode
  onModeChange: (newMode: DarkMode) => void
}

const icons: { name: DarkMode; icon: JSX.Element }[] = [
  { name: "system", icon: <ComputerIcon className="size-6 inline" /> },
  { name: "dark", icon: <MoonIcon className="size-6 inline" /> },
  { name: "light", icon: <SunIcon className="size-6 inline" /> },
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
    <Tooltip content={`Toggle dark mode (${mode} mode now)`} {...rest}>
      <span
        className="absolute right-0"
        data-testid="pastebin-darkmode-toggle"
        role="button"
        aria-label="Toggle Dark Mode"
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
