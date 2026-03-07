import { hydrateRoot } from "react-dom/client"
import React from "react"
import { HeroUIProvider } from "@heroui/react"
import { DisplayPaste } from "../DisplayPaste.js"

const rootElement = document.getElementById("root")!
const config = __WRANGLER_CONFIG__

if (window.__PASTE_DATA__) {
  hydrateRoot(
    rootElement,
    <React.StrictMode>
      <HeroUIProvider>
        <DisplayPaste config={config} />
      </HeroUIProvider>
    </React.StrictMode>,
  )
} else {
  const { createRoot } = await import("react-dom/client")
  createRoot(rootElement).render(
    <React.StrictMode>
      <HeroUIProvider>
        <DisplayPaste config={config} />
      </HeroUIProvider>
    </React.StrictMode>,
  )
}
