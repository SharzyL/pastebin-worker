import { describe, expect, it } from "vitest"

import { renderMarkdown } from "../markdown.js"

function untrusted(md: string): string {
  return renderMarkdown(md, { headingAnchors: false, untrusted: true }).html
}

describe("renderMarkdown for untrusted content", () => {
  it("drops classes it did not emit", () => {
    const html = untrusted('<div class="fixed inset-0">overlay</div>\n\n```js\nx\n```')
    expect(html).not.toContain("fixed")
    expect(html).toContain('class="code-block"')
    expect(html).toContain('class="line-number-rows"')
    expect(html).toContain('class="language-js"')
  })

  it("drops form controls and ids", () => {
    const html = untrusted('<input type="password"> <span id="config">x</span>\n\n# Title')
    expect(html).not.toContain("<input")
    expect(html).not.toContain("id=")
  })

  it("only loads inline raster images", () => {
    const remote = untrusted("![a](https://example.com/track.png)")
    expect(remote).not.toContain("example.com")
    const inline = untrusted("![a](data:image/png;base64,AAAA)")
    expect(inline).toContain('src="data:image/png;base64,AAAA"')
    expect(untrusted("![a](data:image/svg+xml;base64,AAAA)")).not.toContain("svg")
  })

  it("keeps the trusted renderer unchanged", () => {
    const html = renderMarkdown('<div class="note">x</div>\n\n# Title').html
    expect(html).toContain('class="note"')
    expect(html).toContain('id="title"')
  })
})
