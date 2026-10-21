import { createRoot } from "react-dom/client"
import React from "react"
import { LivePaste } from "../LivePaste.js"
import { HljsProvider } from "../../utils/highlight-client.js"

const rootElement = document.getElementById("root")!
const config = __WRANGLER_CONFIG__

createRoot(rootElement).render(
  <React.StrictMode>
    <HljsProvider>
      <LivePaste config={config} />
    </HljsProvider>
  </React.StrictMode>,
)
