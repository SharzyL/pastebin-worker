import { createContext, useContext } from "react"
import type { HLJSApi } from "highlight.js"

// Bridges client-only highlight.js loading (useHLJS, plus the full language
// name list) into components that are also rendered by the worker SSR. The
// default values are no-ops, so worker SSR can render the tree without ever
// reaching the highlight.js loader.
export type UseHljsHook = (lang: string | undefined) => HLJSApi | undefined

const noopUseHljs: UseHljsHook = () => undefined

const HljsHookContext = createContext<UseHljsHook>(noopUseHljs)
const LanguagesContext = createContext<readonly string[]>([])

export const HljsHookProvider = HljsHookContext.Provider
export const LanguagesProvider = LanguagesContext.Provider

// The context value is a stable hook reference for the lifetime of a component
// (either always `noopUseHljs` or always the real `useHLJS` from HljsProvider),
// so calling it as a hook satisfies the rules of hooks.
export function useHljsForLang(lang: string | undefined): HLJSApi | undefined {
  const useHljsFn = useContext(HljsHookContext)
  return useHljsFn(lang)
}

export function useAvailableLanguages(): readonly string[] {
  return useContext(LanguagesContext)
}
