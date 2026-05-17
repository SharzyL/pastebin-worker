// Client-only highlight.js loader: glob + alias resolution + the `useHLJS`
// hook + the `HljsProvider` that wires those into the worker-safe contexts in
// `./highlight.ts`.
//
// IMPORTANT: importing this file pulls highlight.js into the bundle (via the
// glob and dynamic imports below). Only client entries may import it — never
// any module reachable from the worker SSR entries.
import React, { useEffect, useState } from "react"
import type { HLJSApi, LanguageFn } from "highlight.js"
import aliasMap from "virtual:hljs-aliases"

import { HljsHookProvider, LanguagesProvider } from "./highlight.js"

// `*.js.js` files are CJS deprecation shims highlight.js ships alongside the
// real ESM modules; exclude them or Vite emits a chunk for each.
const languageLoaders = import.meta.glob<{ default: LanguageFn }>([
  "../../node_modules/highlight.js/es/languages/*.js",
  "!../../node_modules/highlight.js/es/languages/*.js.js",
])

function pathOf(canonical: string): string {
  return `../../node_modules/highlight.js/es/languages/${canonical}.js`
}

// Resolve a language name (canonical OR an alias declared by the language
// module, e.g. "js" → "javascript", "py" → "python") to the canonical name
// highlight.js uses internally. Returns undefined for unknown names.
export function canonicalLangName(name: string): string | undefined {
  if (pathOf(name) in languageLoaders) return name
  return aliasMap[name]
}

export function loaderForLang(lang: string): (() => Promise<{ default: LanguageFn }>) | undefined {
  const canonical = canonicalLangName(lang)
  if (!canonical) return undefined
  return languageLoaders[pathOf(canonical)]
}

// All canonical language names known to the bundled highlight.js, derived at
// build time from the glob keys. Used by the editor's language picker, which
// must know the full set even though only one language is loaded at a time.
export const ALL_LANGUAGES: readonly string[] = Object.keys(languageLoaders)
  .map((p) => /\/([^/]+)\.js$/.exec(p)?.[1])
  .filter((s): s is string => !!s)
  .sort()

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

// Wires the real loader + language name list into the worker-safe contexts so
// consumers reached via `useHljsForLang` / `useAvailableLanguages` get them.
export function HljsProvider({ children }: { children: React.ReactNode }) {
  return (
    <HljsHookProvider value={useHLJS}>
      <LanguagesProvider value={ALL_LANGUAGES}>{children}</LanguagesProvider>
    </HljsHookProvider>
  )
}
