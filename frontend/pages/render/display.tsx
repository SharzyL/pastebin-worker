import ReactDOM from "react-dom/client"
import React from "react"
import { HeroUIProvider } from "@heroui/react"
import { DisplayPaste } from "../DisplayPaste.js"

const root = ReactDOM.createRoot(document.getElementById("root")!)

root.render(
  <React.StrictMode>
    <HeroUIProvider>
      <DisplayPaste />
    </HeroUIProvider>
  </React.StrictMode>,
)
