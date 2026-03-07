/* global __dirname */

import { defineConfig } from "vite"
import { resolve } from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { readFileSync } from "node:fs"
import * as toml from "toml"

export default defineConfig(({ mode }) => {
  const wranglerConfigText = readFileSync("wrangler.toml", "utf8")
  const wranglerConfigParsed = toml.parse(wranglerConfigText)

  const vars =
    mode === "development"
      ? { ...wranglerConfigParsed.vars, DEPLOY_URL: "http://localhost:8787", INDEX_PAGE_TITLE: "Pastebin Worker (dev)" }
      : wranglerConfigParsed.vars

  const transformHtmlPlugin = () => ({
    name: "transform-html",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(/%INDEX_PAGE_TITLE%/g, vars.INDEX_PAGE_TITLE)
      },
    },
  })

  return {
    plugins: [react(), tailwindcss(), transformHtmlPlugin()],
    define: {
      __WRANGLER_CONFIG__: JSON.stringify(vars),
    },
    server: {
      port: 5173,
    },
    build: {
      manifest: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
          display: resolve(__dirname, "display.html"),
        },
      },
    },
  }
})
