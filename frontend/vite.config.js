/* global __dirname */

import { defineConfig } from "vite"
import { resolve } from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
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
  // highlight.js splitting kicks in). The worker only needs each HTML/JS
  // entry's resolved jsFile + the set of CSS chunks reachable through its
  // import graph — emit a slim version next to the full manifest and have
  // the worker import that.
  const ssrManifestPlugin = () => ({
    name: "ssr-manifest",
    apply: "build",
    closeBundle() {
      const manifestPath = resolve(__dirname, "../dist/frontend/.vite/manifest.json")
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      const resolveEntry = (entryKey) => {
        const entry = manifest[entryKey]
        const jsFile = entry?.file || `assets/${entryKey.replace(".html", ".js")}`
        // Walk the import graph to collect every CSS chunk reachable from
        // this entry. An entry may transitively reach several CSS chunks
        // (e.g. a Tailwind chunk + a highlight-theme chunk via different
        // imported components), and the page needs all of them.
        //
        // `visited` tracks manifest keys (strings), not entry objects: that
        // way the cycle guard doesn't rely on the JSON parse cache returning
        // the same object reference on repeated lookups.
        const css = new Set()
        const visited = new Set()
        const walk = (key) => {
          if (!key || visited.has(key)) return
          visited.add(key)
          const e = manifest[key]
          if (!e) return
          for (const p of e.css || []) css.add(p)
          for (const k of e.imports || []) walk(k)
        }
        walk(entryKey)
        const cssPaths = css.size > 0 ? [...css] : ["assets/style.css"]
        return { jsFile, cssPaths }
      }
      const slim = {
        "index.html": resolveEntry("index.html"),
        "display.html": resolveEntry("display.html"),
        // Vanilla bootstrap for the /a/<paste> markdown render page.
        "pages/render/markdown.ts": resolveEntry("pages/render/markdown.ts"),
      }
      writeFileSync(resolve(__dirname, "../dist/frontend/.vite/ssr-manifest.json"), JSON.stringify(slim, null, 2))
    },
  })

  // Each highlight.js language module declares its own aliases (e.g. js → javascript,
  // py → python). Markdown fences and the editor's `lang` URL param can be any of
  // those aliases, but our per-language glob keys are only canonical filenames, so
  // we'd otherwise fail to load the right chunk. Scan the language sources once at
  // build start and expose alias → canonical as a virtual module.
  const hljsAliasesPlugin = () => {
    const VIRTUAL_ID = "virtual:hljs-aliases"
    const RESOLVED_ID = "\0" + VIRTUAL_ID
    return {
      name: "hljs-aliases",
      resolveId(id) {
        if (id === VIRTUAL_ID) return RESOLVED_ID
      },
      load(id) {
        if (id !== RESOLVED_ID) return
        const langDir = resolve(__dirname, "../node_modules/highlight.js/lib/languages")
        const aliases = {}
        for (const f of readdirSync(langDir).sort()) {
          if (!f.endsWith(".js") || f.endsWith(".js.js")) continue
          const canonical = f.slice(0, -3)
          const src = readFileSync(resolve(langDir, f), "utf8")
          // Take the LAST `aliases:` declaration in the file: some modules
          // (e.g. typescript.js) define a base language inline and then
          // overwrite `name` + `aliases` later (Object.assign(..., { name:
          // 'TypeScript', aliases: ['ts', ...] })). The runtime sees the
          // final mutation, so we must too — otherwise `js` ends up pointing
          // at typescript instead of javascript.
          //
          // Require the match to look like a real object property — preceded
          // by `,` or `{` — so a stray `aliases: [...]` inside a comment or
          // string literal in a future upstream version doesn't poison the
          // map.
          const matches = [...src.matchAll(/[,{]\s*aliases:\s*\[([^\]]+)\]/g)]
          if (!matches.length) continue
          for (const raw of matches[matches.length - 1][1].split(",")) {
            const a = raw.replace(/['"]/g, "").trim()
            if (a) aliases[a] = canonical
          }
        }
        return `export default ${JSON.stringify(aliases)}`
      },
    }
  }

  return {
    plugins: [react(), tailwindcss(), transformHtmlPlugin(), ssrManifestPlugin(), hljsAliasesPlugin()],
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
          markdown: resolve(__dirname, "pages/render/markdown.ts"),
        },
      },
    },
  }
})
