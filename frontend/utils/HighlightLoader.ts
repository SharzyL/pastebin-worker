import type { HLJSApi } from "highlight.js"
import { escapeHtml } from "../../worker/common.js"

export type { HLJSApi }

export function highlightHTML(hljs: HLJSApi | undefined, lang: string | undefined, content: string) {
  if (hljs && lang && hljs.listLanguages().includes(lang) && lang !== "plaintext") {
    const highlighted = hljs.highlight(content, { language: lang })
    return highlighted.value
  } else {
    return escapeHtml(content)
  }
}
