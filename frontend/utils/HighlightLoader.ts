import { useEffect, useState } from "react"
import type { HLJSApi } from "highlight.js"
import { escapeHtml } from "../../worker/common.js"

export function useHLJS() {
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

export function highlightHTML(hljs: HLJSApi | undefined, lang: string | undefined, content: string) {
  if (hljs && lang && hljs.listLanguages().includes(lang) && lang !== "plaintext") {
    const highlighted = hljs.highlight(content, { language: lang })
    return highlighted.value
  } else {
    return escapeHtml(content)
  }
}
