import React from "react"
import { HljsHookProvider, LanguagesProvider } from "./HighlightContext.js"
import { ALL_LANGUAGES, useHLJS } from "./useHLJS.js"

// Client-only wrapper that wires the real highlight.js loader and the full
// language name list into the highlight contexts. Importing this file pulls
// highlight.js into the bundle, so only client entries should import it —
// never any module reachable from the worker SSR entries.
export function HljsProvider({ children }: { children: React.ReactNode }) {
  return (
    <HljsHookProvider value={useHLJS}>
      <LanguagesProvider value={ALL_LANGUAGES}>{children}</LanguagesProvider>
    </HljsHookProvider>
  )
}
