import { useEffect, useState } from "react"
import type { HLJSApi } from "highlight.js"
import { canonicalLangName, loaderForLang } from "./hljsLanguages.js"

export { ALL_LANGUAGES } from "./hljsLanguages.js"

// IMPORTANT: this hook performs the runtime imports of highlight.js and MUST
// NOT be imported from any module that the worker SSR entry transitively
// reaches — doing so would drag highlight.js into the worker bundle.
export function useHLJS(lang: string | undefined): HLJSApi | undefined {
  const [hljs, setHljs] = useState<HLJSApi | undefined>(undefined)

  useEffect(() => {
    if (!lang || lang === "plaintext") return
    const canonical = canonicalLangName(lang)
    if (!canonical) return
    const loader = loaderForLang(canonical)
    if (!loader) return
    let cancelled = false
    ;(async () => {
      const core = (await import("highlight.js/lib/core")).default
      if (cancelled) return
      if (!core.getLanguage(canonical)) {
        const langMod = await loader()
        if (cancelled) return
        // Register under the canonical name. highlight.js wires up the
        // module's declared aliases automatically, so `getLanguage("js")`
        // resolves after registering "javascript".
        core.registerLanguage(canonical, langMod.default)
      }
      setHljs(core)
    })().catch((e) => console.warn(`highlight.js: failed to load language "${lang}":`, e))
    return () => {
      cancelled = true
    }
  }, [lang])

  return hljs
}
