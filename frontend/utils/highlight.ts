// Worker-safe highlight.js plumbing — pure helpers and React contexts that
// can be imported from any component (including ones rendered by the worker
// SSR), because nothing here pulls highlight.js at runtime.
//
// The actual loader (glob + dynamic imports + the `useHLJS` hook + the
// `HljsProvider` component) lives in `./highlight-client.tsx` and must only
// be imported from client entries.
import { createContext, useContext } from "react"
import type { HLJSApi } from "highlight.js"
import { escapeHtml } from "../../worker/common.js"

export type { HLJSApi }

export function highlightHTML(hljs: HLJSApi | undefined, lang: string | undefined, content: string): string {
  if (hljs && lang && hljs.listLanguages().includes(lang) && lang !== "plaintext") {
    return hljs.highlight(content, { language: lang }).value
  }
  return escapeHtml(content)
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
