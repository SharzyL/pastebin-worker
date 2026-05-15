/* global __dirname */

import { defineConfig } from "vite"
import { resolve } from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { readFileSync, writeFileSync } from "node:fs"
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

  // The full Vite manifest lists every emitted chunk (~80KB once per-language
  // highlight.js splitting kicks in). The worker only needs the resolved
  // {jsFile, cssPath} for the two HTML entries — emit a slim version next to
  // the full manifest and have the worker import that.
  const ssrManifestPlugin = () => ({
    name: "ssr-manifest",
    apply: "build",
    closeBundle() {
      const manifestPath = resolve(__dirname, "../dist/frontend/.vite/manifest.json")
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      const resolveEntry = (entryKey) => {
        const entry = manifest[entryKey]
        const jsFile = entry?.file || `assets/${entryKey.replace(".html", ".js")}`
        const cssImport = entry?.imports?.find((i) => manifest[i]?.css)
        const cssPath = (cssImport && manifest[cssImport]?.css?.[0]) || "assets/style.css"
        return { jsFile, cssPath }
      }
      const slim = {
        "index.html": resolveEntry("index.html"),
        "display.html": resolveEntry("display.html"),
      }
      writeFileSync(resolve(__dirname, "../dist/frontend/.vite/ssr-manifest.json"), JSON.stringify(slim, null, 2))
    },
  })

  return {
    plugins: [react(), tailwindcss(), transformHtmlPlugin(), ssrManifestPlugin()],
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
