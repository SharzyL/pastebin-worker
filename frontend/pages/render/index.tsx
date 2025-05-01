import ReactDOM from "react-dom/client"
import React from "react"
import { HeroUIProvider } from "@heroui/react"
import { PasteBin } from "../PasteBin.js"

const root = ReactDOM.createRoot(document.getElementById("root")!)

root.render(
  <React.StrictMode>
    <HeroUIProvider>
      <PasteBin />
    </HeroUIProvider>
  </React.StrictMode>,
)
