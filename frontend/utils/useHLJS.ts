import { useEffect, useState } from "react"
import type { HLJSApi, LanguageFn } from "highlight.js"

// Vite globs every language file at build time and emits one chunk per
// language. The browser only fetches the core (~20KB gzip) plus the one
// language chunk for the current paste (each language is 1-10KB gzip).
//
// IMPORTANT: this hook performs the runtime imports of highlight.js and MUST
// NOT be imported from any module that the worker SSR entry transitively
// reaches — doing so would drag highlight.js into the worker bundle.
// `*.js.js` files are CJS deprecation shims that highlight.js ships alongside
// the real ESM modules; exclude them or Vite emits a chunk for each.
const languageLoaders = import.meta.glob<{ default: LanguageFn }>([
  "../../node_modules/highlight.js/es/languages/*.js",
  "!../../node_modules/highlight.js/es/languages/*.js.js",
])

function loaderForLang(lang: string): (() => Promise<{ default: LanguageFn }>) | undefined {
  return languageLoaders[`../../node_modules/highlight.js/es/languages/${lang}.js`]
}

export function useHLJS(lang: string | undefined): HLJSApi | undefined {
  const [hljs, setHljs] = useState<HLJSApi | undefined>(undefined)

  useEffect(() => {
    if (!lang || lang === "plaintext") return
    const loader = loaderForLang(lang)
    if (!loader) return
    let cancelled = false
    ;(async () => {
      const core = (await import("highlight.js/lib/core")).default
      if (cancelled) return
      if (!core.listLanguages().includes(lang)) {
        const langMod = await loader()
        if (cancelled) return
        core.registerLanguage(lang, langMod.default)
      }
      setHljs(core)
    })().catch((e) => console.warn(`highlight.js: failed to load language "${lang}":`, e))
    return () => {
      cancelled = true
    }
  }, [lang])

  return hljs
}
