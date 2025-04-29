import React, { JSX, useEffect } from "react"
import { ComputerIcon, MoonIcon, SunIcon } from "./icons.js"
import { Button, ButtonProps, Tooltip } from "@heroui/react"

export type DarkMode = "dark" | "light" | "system"

interface MyComponentProps extends ButtonProps {
  mode: DarkMode
  onModeChange: (newMode: DarkMode) => void
}

const icons: { name: DarkMode; icon: JSX.Element }[] = [
  { name: "system", icon: <ComputerIcon className="size-6 inline" /> },
  { name: "light", icon: <SunIcon className="size-6 inline" /> },
  { name: "dark", icon: <MoonIcon className="size-6 inline" /> },
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

export function DarkModeToggle({ mode, onModeChange, className, ...rest }: MyComponentProps) {
  useEffect(() => {
    localStorage.setItem("darkModeSelect", mode)
  }, [mode])

  return (
    <Tooltip content={`Toggle dark mode (currently ${mode})`}>
      <Button
        isIconOnly
        className={"mr-2 rounded-full bg-background" + " " + className}
        aria-label="Toggle dark mode"
        onPress={() => {
          const curModeIdx = icons.findIndex(({ name }) => name === mode)
          onModeChange(icons[(curModeIdx + 1) % icons.length].name)
        }}
        {...rest}
      >
        {icons.find(({ name }) => name === mode)!.icon}
      </Button>
    </Tooltip>
  )
}
