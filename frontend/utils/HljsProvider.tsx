import React from "react"
import { HljsHookProvider } from "./HighlightContext.js"
import { useHLJS } from "./useHLJS.js"

// Client-only wrapper that wires the real highlight.js loader into
// HljsHookContext. Importing this file pulls highlight.js into the bundle, so
// only client entries should import it — never any module reachable from the
// worker SSR entries.
export function HljsProvider({ children }: { children: React.ReactNode }) {
  return <HljsHookProvider value={useHLJS}>{children}</HljsHookProvider>
}
