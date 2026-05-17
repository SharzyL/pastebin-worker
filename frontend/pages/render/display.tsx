import { hydrateRoot } from "react-dom/client"
import React from "react"
import { DisplayPaste } from "../DisplayPaste.js"
import { HljsProvider } from "../../utils/highlight-client.js"

const rootElement = document.getElementById("root")!
const config = __WRANGLER_CONFIG__

const tree = (
  <React.StrictMode>
    <HljsProvider>
      <DisplayPaste config={config} />
    </HljsProvider>
  </React.StrictMode>
)

if (window.__PASTE_DATA__) {
  hydrateRoot(rootElement, tree)
} else {
  const { createRoot } = await import("react-dom/client")
  createRoot(rootElement).render(tree)
}
