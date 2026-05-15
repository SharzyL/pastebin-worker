import { hydrateRoot, createRoot } from "react-dom/client"
import React from "react"
import { PasteBin } from "../PasteBin.js"
import { HljsProvider } from "../../utils/HljsProvider.js"

const rootElement = document.getElementById("root")!
const config = __WRANGLER_CONFIG__

// Check if this is an SSR-rendered page
const isSSR = rootElement.hasChildNodes()

const tree = (
  <React.StrictMode>
    <HljsProvider>
      <PasteBin config={config} />
    </HljsProvider>
  </React.StrictMode>
)

if (isSSR) {
  hydrateRoot(rootElement, tree)
} else {
  // CSR (admin URL or SSR failed)
  createRoot(rootElement).render(tree)
}
