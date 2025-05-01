import ReactDOM from "react-dom/client"
import React from "react"
import { HeroUIProvider } from "@heroui/react"
import { DecryptPaste } from "../DecryptPaste.js"

const root = ReactDOM.createRoot(document.getElementById("root")!)

root.render(
  <React.StrictMode>
    <HeroUIProvider>
      <DecryptPaste />
    </HeroUIProvider>
  </React.StrictMode>,
)
