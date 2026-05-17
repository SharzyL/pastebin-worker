import type { LanguageFn } from "highlight.js"
import aliasMap from "virtual:hljs-aliases"

// Vite globs every language file at build time and emits one chunk per
// language. Both `useHLJS` (the React hook for the display page / editor) and
// the vanilla bootstrap for the markdown render page (`/a/<name>`) load
// languages through this map, so the chunks are deduplicated and cacheable
// across pages.
//
// IMPORTANT: any module reachable from the worker SSR entries must not import
// this file (it pulls highlight.js into the bundle).
//
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
