import { hydrateRoot, createRoot } from "react-dom/client"
import React from "react"
import { PasteBin } from "../PasteBin.js"

const rootElement = document.getElementById("root")!
const config = __WRANGLER_CONFIG__

// Check if this is an SSR-rendered page
const isSSR = rootElement.hasChildNodes()

if (isSSR) {
  // Hydrate SSR content
  hydrateRoot(
    rootElement,
    <React.StrictMode>
      <PasteBin config={config} />
    </React.StrictMode>,
  )
} else {
  // CSR (admin URL or SSR failed)
  createRoot(rootElement).render(
    <React.StrictMode>
      <PasteBin config={config} />
    </React.StrictMode>,
  )
}
