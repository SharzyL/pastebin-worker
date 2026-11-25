// Worker-safe highlight.js plumbing — pure helpers and React contexts that
// can be imported from any component (including ones rendered by the worker
// SSR), because nothing here pulls highlight.js at runtime.
//
// The actual loader (glob + dynamic imports + the `useHLJS` hook + the
// `HljsProvider` component) lives in `./highlight-client.tsx` and must only
// be imported from client entries.
import { createContext, useContext } from "react"
import type { HLJSApi } from "highlight.js"
import { escapeHtml } from "../../shared/html.js"

export type { HLJSApi }

export function highlightHTML(hljs: HLJSApi | undefined, lang: string | undefined, content: string): string {
  // `getLanguage` resolves aliases ("html" → xml, "py" → python), which
  // `listLanguages` does not include
  if (hljs && lang && lang !== "plaintext" && hljs.getLanguage(lang)) {
    return hljs.highlight(content, { language: lang }).value
  }
  return escapeHtml(content)
}

// Splits the output of `highlightHTML` into lines. A span that crosses a line
// break (a multi-line comment or string) is closed at the end of the line and
// reopened at the start of the next one, so each line is well-formed HTML.
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = []
  const openTags: string[] = []
  let line = ""
  for (const [token] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+/g)) {
    if (token === "\n") {
      lines.push(line + "</span>".repeat(openTags.length))
      line = openTags.join("")
    } else {
      if (token === "</span>") openTags.pop()
      else if (token.startsWith("<")) openTags.push(token)
      line += token
    }
  }
  lines.push(line)
  return lines
}

// Contexts default to no-ops so worker SSR can render the tree without ever
// reaching the highlight.js loader. `HljsProvider` (client-only) supplies the
// real implementations.
export type UseHljsHook = (lang: string | undefined) => HLJSApi | undefined

const noopUseHljs: UseHljsHook = () => undefined

const HljsHookContext = createContext<UseHljsHook>(noopUseHljs)
const LanguagesContext = createContext<readonly string[]>([])

export const HljsHookProvider = HljsHookContext.Provider
export const LanguagesProvider = LanguagesContext.Provider

// The context value is a stable hook reference for the lifetime of a component
// (always either `noopUseHljs` or the real `useHLJS`), so calling it as a hook
// satisfies the rules of hooks.
export function useHljsForLang(lang: string | undefined): HLJSApi | undefined {
  return useContext(HljsHookContext)(lang)
}

export function useAvailableLanguages(): readonly string[] {
  return useContext(LanguagesContext)
}
