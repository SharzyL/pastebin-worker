import { describe, expect, it } from "vitest"
import hljs from "highlight.js/lib/core"
import xml from "highlight.js/lib/languages/xml"

import { highlightHTML } from "../utils/highlight.js"
import { ALL_LANGUAGES, canonicalLangName } from "../utils/highlight-client.js"

describe("highlight languages", () => {
  it("offers common aliases next to the canonical names", () => {
    for (const lang of ["xml", "html", "svg", "javascript", "js", "bash", "sh", "markdown", "md", "python", "py"]) {
      expect(ALL_LANGUAGES, lang).toContain(lang)
    }
    expect(new Set(ALL_LANGUAGES).size).toBe(ALL_LANGUAGES.length)
    expect([...ALL_LANGUAGES].sort()).toStrictEqual([...ALL_LANGUAGES])
  })

  it("resolves aliases to the module that is loaded", () => {
    expect(canonicalLangName("html")).toBe("xml")
    expect(canonicalLangName("xml")).toBe("xml")
    expect(canonicalLangName("nope")).toBeUndefined()
  })

  it("highlights by alias once the language is registered", () => {
    hljs.registerLanguage("xml", xml)
    const content = "<b>hi</b>"
    const byName = highlightHTML(hljs, "xml", content)
    expect(byName).toContain("hljs-tag")
    expect(highlightHTML(hljs, "html", content)).toBe(byName)
    expect(highlightHTML(hljs, "svg", content)).toBe(byName)
    // unknown or plain text is only escaped
    expect(highlightHTML(hljs, "nope", content)).toBe("&lt;b&gt;hi&lt;/b&gt;")
    expect(highlightHTML(hljs, "plaintext", content)).toBe("&lt;b&gt;hi&lt;/b&gt;")
    expect(highlightHTML(undefined, "html", content)).toBe("&lt;b&gt;hi&lt;/b&gt;")
  })
})
