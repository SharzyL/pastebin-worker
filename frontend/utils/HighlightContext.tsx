import { createContext, useContext } from "react"
import type { HLJSApi } from "highlight.js"

// A hook that resolves an HLJSApi for the given language. Components consume
// `useHljsForLang(lang)` which delegates to whatever hook the surrounding
// provider supplies. The default is a no-op so that worker SSR can render the
// component tree without ever touching the highlight.js loader (which would
// drag the entire library into the worker bundle).
export type UseHljsHook = (lang: string | undefined) => HLJSApi | undefined

const noopUseHljs: UseHljsHook = () => undefined

const HljsHookContext = createContext<UseHljsHook>(noopUseHljs)

export const HljsHookProvider = HljsHookContext.Provider

// The context value is a stable hook reference for the lifetime of a component
// (either always `noopUseHljs` or always the real `useHLJS` from HljsProvider),
// so calling it as a hook satisfies the rules of hooks.
export function useHljsForLang(lang: string | undefined): HLJSApi | undefined {
  const useHljsFn = useContext(HljsHookContext)
  return useHljsFn(lang)
}
