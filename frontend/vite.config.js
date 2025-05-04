/* global __dirname */

import { defineConfig } from "vite"
import { resolve } from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { readFileSync } from "node:fs"
import * as toml from "toml"

export default defineConfig(({ mode }) => {
  const wranglerConfigPath = "wrangler.toml"
  const devAPIUrl = "http://localhost:8787"
  const wranglerConfigText = readFileSync(wranglerConfigPath, "utf8")
  const wranglerConfigParsed = toml.parse(wranglerConfigText)

  function getVar(name) {
    if (wranglerConfigParsed.vars !== undefined && wranglerConfigParsed.vars[name] !== undefined) {
      return wranglerConfigParsed.vars[name]
    } else {
      throw new Error(`Cannot find vars.${name} in ${wranglerConfigPath}`)
    }
  }
  const deployUrl = getVar("DEPLOY_URL")

  const indexTitle = getVar("INDEX_PAGE_TITLE") + (mode === "development" ? " (dev)" : "")
  const transformHtmlPlugin = () => ({
    name: "transform-html",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(/%INDEX_PAGE_TITLE%/g, () => indexTitle)
      },
    },
  })

  return {
    plugins: [react(), tailwindcss(), transformHtmlPlugin()],
    define: {
      DEPLOY_URL: mode === "development" ? JSON.stringify(devAPIUrl) : JSON.stringify(deployUrl),
      API_URL: mode === "development" ? JSON.stringify(devAPIUrl) : JSON.stringify(deployUrl),
      REPO: JSON.stringify(getVar("REPO")),
      MAX_EXPIRATION: JSON.stringify(getVar("MAX_EXPIRATION")),
      DEFAULT_EXPIRATION: JSON.stringify(getVar("DEFAULT_EXPIRATION")),
      INDEX_PAGE_TITLE: JSON.stringify(indexTitle),
    },
    server: {
      port: 5173,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
          display: resolve(__dirname, "display.html"),
        },
      },
    },
  }
})
