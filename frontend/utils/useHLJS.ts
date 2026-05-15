import { useEffect, useState } from "react"
import type { HLJSApi } from "highlight.js"

// Loads `highlight.js/lib/common`, which bundles ~38 popular languages (xml, js,
// python, go, rust, etc.) at a fraction of the size of the full `highlight.js`
// import (~40KB gzip vs ~305KB). Less common languages (e.g. erlang, ocaml)
// will not be highlighted; `highlightHTML` falls back to escaped HTML for those.
//
// IMPORTANT: this hook performs the runtime `import("highlight.js/lib/common")`
// and MUST NOT be imported from any module that the worker SSR entry
// transitively reaches — doing so would drag highlight.js into the worker.
export function useHLJS(lang: string | undefined): HLJSApi | undefined {
  const [hljs, setHljs] = useState<HLJSApi | undefined>(undefined)

  useEffect(() => {
    if (!lang || lang === "plaintext") return
    let cancelled = false
    import("highlight.js/lib/common")
      .then((mod) => {
        if (!cancelled) setHljs(mod.default)
      })
      .catch((e) => console.warn("highlight.js: failed to load:", e))
    return () => {
      cancelled = true
    }
  }, [lang])

  return hljs
}
