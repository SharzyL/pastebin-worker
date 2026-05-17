import { describe, it, expect } from "vitest"

import { makeMarkdown } from "../pages/markdown.js"

// Extract the article-body markup, which is where any user-supplied content
// would land. The surrounding shell (head/body/sidebar) is repo-controlled.
function articleBody(html: string): string {
  const m = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html)
  if (!m) throw new Error("no <article> in rendered output")
  return m[1]
}

function render(md: string): string {
  return articleBody(makeMarkdown(md))
}

describe("makeMarkdown sanitization", () => {
  it("strips block-level <script> body and tag", () => {
    const out = render("Hello\n\n<script>alert(1)</script>\n\nWorld")
    expect(out).not.toMatch(/<script[\s>]/i)
    expect(out).not.toContain("alert(1)")
  })

  it("strips <style> body", () => {
    const out = render("Before\n\n<style>body{background:url(javascript:alert(1))}</style>\n\nAfter")
    expect(out).not.toMatch(/<style[\s>]/i)
    expect(out).not.toContain("javascript:alert")
  })

  it("escapes (but renders inert) <iframe>, <object>, <embed>", () => {
    for (const tag of ["iframe", "object", "embed"]) {
      const out = render(`Before\n\n<${tag} src="evil">x</${tag}>\n\nAfter`)
      expect(out, `tag ${tag}`).not.toMatch(new RegExp(`<${tag}[\\s>]`, "i"))
    }
  })

  it("strips event-handler attributes on inline HTML", () => {
    const out = render(`Hello <img onerror="alert(1)" src="x"> world`)
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("alert(1)")
  })

  it("strips javascript: href in raw inline <a>", () => {
    const out = render(`Try <a href="javascript:alert(1)">this</a>`)
    expect(out).not.toMatch(/href=["']?javascript:/i)
  })

  it("blocks javascript: in markdown links", () => {
    const out = render("[click me](javascript:alert(1))")
    expect(out).not.toMatch(/href=["']?javascript:/i)
    expect(out).toContain("click me")
  })

  it("blocks javascript: with leading whitespace and mixed case", () => {
    const out = render("[a]( JaVaScRiPt:alert(1))\n\n[b](\tvbscript:alert(2))")
    expect(out).not.toMatch(/href=["']?\s*javascript:/i)
    expect(out).not.toMatch(/href=["']?\s*vbscript:/i)
  })

  it("blocks data:text/html in links", () => {
    const out = render("[x](data:text/html,<script>alert(1)</script>)")
    expect(out).not.toMatch(/href=["']?data:text\/html/i)
  })

  it("preserves http(s), mailto, fragment, and relative links", () => {
    const out = render(
      "[a](https://example.com)\n\n[b](http://example.com)\n\n[c](mailto:me@example.com)\n\n[d](#section)\n\n[e](/path)\n\n[f](./other.md)",
    )
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('href="http://example.com"')
    expect(out).toContain('href="mailto:me@example.com"')
    expect(out).toContain('href="#section"')
    expect(out).toContain('href="/path"')
    expect(out).toContain('href="./other.md"')
  })

  it("preserves data:image/* on <img> (legitimate inline images)", () => {
    const out = render("![pixel](data:image/png;base64,iVBORw0KGgo)")
    expect(out).toMatch(/<img[^>]+src=["']?data:image\/png/i)
  })

  it("renders code fences as escaped text, not active HTML", () => {
    const out = render("```html\n<script>alert(1)</script>\n```")
    expect(out).toContain("&lt;script&gt;")
    expect(out).not.toMatch(/<script[\s>][^<]*alert/i)
  })

  it("preserves headings with TOC ids and anchor links", () => {
    const out = render("# Hello World\n\nbody")
    expect(out).toMatch(/<h1 id="hello-world">/)
    expect(out).toContain('class="header-anchor"')
    expect(out).toContain('href="#hello-world"')
  })

  it("preserves fenced code language class", () => {
    const out = render("```javascript\nconst x = 1\n```")
    expect(out).toContain('class="language-javascript"')
  })

  it("preserves GFM task list checkboxes", () => {
    const out = render("- [x] done\n- [ ] todo")
    expect(out).toMatch(/<input[^>]+type="checkbox"/i)
    expect(out).toMatch(/<input[^>]+disabled/i)
  })

  it("preserves GFM tables", () => {
    const out = render("| a | b |\n|---|---|\n| 1 | 2 |\n")
    expect(out).toContain("<table>")
    expect(out).toContain("<th>")
    expect(out).toContain("<td>")
  })

  it("emits a line-number gutter with one span per line, surviving sanitization", () => {
    const out = render("```js\nconst a = 1\nconst b = 2\nconst c = 3\n```")
    // outer wrapper present
    expect(out).toContain('<div class="code-block">')
    // gutter sibling preserved with class + aria-hidden attrs (both whitelisted)
    expect(out).toMatch(/<span class="line-number-rows" aria-hidden="true">/)
    // language class still on the inner <code>
    expect(out).toContain('<code class="language-js">')
    // 3 gutter cells for 3 lines (one empty <span></span> per line).
    expect((out.match(/<span><\/span>/g) ?? []).length).toBe(3)
  })

  it("includes a gutter for fenced blocks with no language", () => {
    const out = render("```\nfirst\nsecond\n```")
    expect(out).toContain('<div class="code-block">')
    expect(out).toMatch(/<span class="line-number-rows"[^>]*>(<span><\/span>){2}<\/span>/)
    expect(out).toMatch(/<pre><code>first\nsecond\n<\/code><\/pre>/)
  })

  it("emits inline math as \\(...\\) without mangling backslashes", () => {
    const out = render("Inline math: $E = mc^2$ and $e^{i\\pi} + 1 = 0$.")
    expect(out).toContain("\\(E = mc^2\\)")
    expect(out).toContain("\\(e^{i\\pi} + 1 = 0\\)")
  })

  it("emits display math as \\[...\\] preserving LaTeX line breaks and macros", () => {
    const out = render("$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$")
    expect(out).toContain('<div class="math math-display">')
    // `\,` macro and `\sqrt` must not be eaten by marked's escape handling
    expect(out).toContain("\\,dx = \\sqrt{\\pi}")
  })

  it("preserves LaTeX line breaks (\\\\) inside display math", () => {
    const out = render("$$\n\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}\n$$")
    // `\\` (LaTeX row separator) must survive verbatim, not collapse to `\`
    expect(out).toContain("a &amp; b \\\\")
  })

  it("does NOT mis-parse currency like $5 USD = $5 as inline math", () => {
    const out = render("I paid $5 USD for $0.50 each, total $50.")
    expect(out).not.toContain("\\(")
    expect(out).toContain("$5 USD")
  })

  it("auto-attaches rel=noopener noreferrer to target=_blank anchors", () => {
    // marked itself doesn't emit target=_blank from `[x](url)`, but raw HTML
    // anchors that survive sanitization can carry it. Cover both shapes.
    const out = render('<a href="https://example.com" target="_blank">x</a>')
    expect(out).toMatch(/<a [^>]*target="_blank"[^>]*rel="noopener noreferrer"/)
  })

  it("does not duplicate rel if one is already present", () => {
    const out = render('<a href="https://example.com" target="_blank" rel="nofollow">x</a>')
    // exactly one rel attribute, with its original value preserved
    expect((out.match(/\brel=/g) ?? []).length).toBe(1)
    expect(out).toContain('rel="nofollow"')
  })
})
