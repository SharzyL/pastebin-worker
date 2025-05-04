import { useEffect, useState } from "react"
import type { HLJSApi } from "highlight.js"

export function usePrism() {
  const [prism, setPrism] = useState<HLJSApi | undefined>(undefined)

  useEffect(() => {
    import("highlight.js")
      .then((p) => {
        setPrism(p.default)
      })
      .catch(console.error)
  }, [])

  return prism
}
