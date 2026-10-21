import { Marked, type Token, type Tokens } from "marked"
import GithubSlugger from "github-slugger"
import filterXSS from "xss"
import type { IFilterXSSOptions } from "xss"

import { escapeHtml } from "./html.js"

// Marked emits whatever HTML the markdown asked for, including raw <script>,
// event handlers, javascript: URLs, etc. Run its output through xss with an
// explicit allowlist of the tags + attributes marked actually produces, so any
// other element from inline HTML is stripped or escaped.
//
// Spelled out rather than spreading xss.getDefaultWhiteList() to:
//  - Avoid CJS/ESM interop fragility under @cloudflare/vitest-plugin
//    (the named `FilterXSS` constructor and `getDefaultWhiteList` helper
//    aren't always reachable; only the default-exported `filterXSS()`
//    function survives unmolested).
//  - Stay tighter than the upstream default, which permits a bunch of tags
//    (audio, video, details, font, ...) that markdown never emits.
const sanitizerOptions: IFilterXSSOptions = {
  whiteList: {
    // Headings carry `id` for the TOC + anchor-link target.
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    h5: ["id"],
    h6: ["id"],
    // Header-anchor links use `class` + `aria-label`; normal markdown links
    // use `target` + `href` + `title`. `rel` is allowlisted so the
    // `forceNoopener` hook below can attach `rel="noopener noreferrer"` to
    // any `target="_blank"` link (tabnabbing defence — even though modern
    // browsers default to noopener since Chrome 88 / Firefox 79, older
    // engines, embedded webviews, and crawlers may not).
    a: ["target", "href", "title", "class", "aria-label", "rel"],
    // `src` allows `data:image/*` including `data:image/svg+xml`. Browsers
    // run SVG in "image mode" when loaded via `<img>` — script execution,
    // event handlers, external links, and JS are all disabled by the SVG
    // image-mode spec, and have been across Chrome/Firefox/Safari for years.
    // The remaining risks are privacy (referrer leak via inline `<image
    // href>`) and the user choosing to open the data URL in a new tab — both
    // out of our threat model for now. Matches the prior remark/rehype
    // implementation's behaviour, which also passed `data:` URLs through.
    img: ["src", "alt", "title", "width", "height", "loading"],
    // Block structure.
    p: [],
    br: [],
    hr: [],
    blockquote: [],
    pre: ["class"],
    // Fenced code blocks render as <code class="language-X">.
    code: ["class"],
    // Inline emphasis & friends.
    strong: [],
    em: [],
    s: [],
    del: [],
    ins: [],
    sub: [],
    sup: [],
    mark: [],
    kbd: [],
    abbr: ["title"],
    // The fenced code-block layout uses `<div class="code-block">` as a grid
    // container and `<span class="line-number-rows" aria-hidden>` for the
    // gutter. The class names are server-controlled, so allowing `class` is
    // safe (xss escapes attribute values regardless).
    div: ["class"],
    span: ["class", "aria-hidden"],
    // Lists.
    ul: [],
    ol: ["start"],
    li: [],
    // GFM tables.
    table: [],
    thead: [],
    tbody: [],
    tfoot: [],
    tr: [],
    th: ["align"],
    td: ["align"],
    // GFM task lists.
    input: ["type", "checked", "disabled"],
  },
  // For these tags also drop the body (default behavior is to escape just the
  // wrapping tag, leaving inner text visible — ugly when the body is JS/CSS).
  stripIgnoreTagBody: ["script", "style"],
}

// Attach `rel="noopener noreferrer"` to every `<a target="_blank">` that came
// through sanitization without one. Defence in depth against tabnabbing for
// older browsers / webviews / crawlers that don't default to noopener.
function forceNoopener(html: string): string {
  return html.replace(/<a\b([^>]*\btarget="_blank"[^>]*)>/g, (m, attrs: string) => {
    if (/\brel="[^"]*"/.test(attrs)) return m
    return `<a${attrs} rel="noopener noreferrer">`
  })
}

// Classes the renderer itself emits. Any other class could pull in the host
// page's styles, e.g. to lay a fake dialog over the whole page.
const UNTRUSTED_CLASS_RE = /^(code-block|line-number-rows|language-[\w-]+)$/
// Remote images would tell their host who views the post and when
const UNTRUSTED_IMG_SRC_RE = /^data:image\/(png|jpeg|gif|webp|avif|bmp);/i

// For content shown to people other than its author: no form controls, no
// ids (which could clobber DOM globals), and only the classes and image
// sources above
const { input: _input, ...untrustedWhiteList } = sanitizerOptions.whiteList!
const untrustedSanitizerOptions: IFilterXSSOptions = {
  ...sanitizerOptions,
  whiteList: Object.fromEntries(
    Object.entries(untrustedWhiteList).map(([tag, attrs]) => [tag, attrs?.filter((a) => a !== "id")]),
  ),
  onTagAttr(tag, name, value) {
    if (name === "class" && !UNTRUSTED_CLASS_RE.test(value)) return ""
    if (tag === "img" && name === "src" && !UNTRUSTED_IMG_SRC_RE.test(value)) return ""
    return undefined
  },
}

function sanitizeHtml(html: string, untrusted: boolean): string {
  return forceNoopener(filterXSS(html, untrusted ? untrustedSanitizerOptions : sanitizerOptions))
}

export interface MarkdownHeading {
  depth: number
  text: string
  id: string
}

export interface RenderMarkdownOptions {
  // Give headings an id and a permalink anchor
  headingAnchors?: boolean
  // Sanitize more strictly, for content shown to people other than its author
  untrusted?: boolean
  onHeading?: (heading: MarkdownHeading) => void
}

// Recursively concatenate the text content of a token tree. Equivalent to
// mdast-util-to-string for the cases we care about.
export function tokenText(token: Token): string {
  if (token.type === "list") {
    const list = token as Tokens.List
    return list.items.map(tokenText).join("")
  }
  if ("tokens" in token && Array.isArray(token.tokens)) {
    return token.tokens.map(tokenText).join("")
  }
  if ("text" in token && typeof token.text === "string") return token.text
  return ""
}

// Tokenize `$$...$$` blocks and `$...$` spans BEFORE marked's default rules
// see them — otherwise marked treats backslashes (`\\`, `\,`) as escapes and
// eats the LaTeX, then the page hands MathJax mangled input. We pass the math
// through unchanged inside MathJax-recognized `\(...\)` / `\[...\]` delimiters
// so the CDN-loaded MathJax picks it up with its default config.
const mathBlockExt = {
  name: "mathBlock",
  level: "block" as const,
  start(src: string): number | undefined {
    const m = /^[ \t]*\$\$/m.exec(src)
    return m?.index
  },
  tokenizer(src: string) {
    const m = /^[ \t]*\$\$\r?\n([\s\S]+?)\r?\n[ \t]*\$\$(?:\r?\n|$)/.exec(src)
    if (!m) return undefined
    return { type: "mathBlock", raw: m[0], math: m[1] }
  },
  renderer(token: { math: string }) {
    return `<div class="math math-display">\\[${escapeHtml(token.math)}\\]</div>\n`
  },
}

const mathInlineExt = {
  name: "mathInline",
  level: "inline" as const,
  start(src: string): number | undefined {
    const i = src.indexOf("$")
    return i < 0 ? undefined : i
  },
  tokenizer(src: string) {
    // Open `$`, non-empty content with no `$` or newline inside, close `$`
    // not followed by a digit (so "$5 USD = $5" isn't mis-parsed as math).
    const m = /^\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/.exec(src)
    if (!m) return undefined
    return { type: "mathInline", raw: m[0], math: m[1] }
  },
  renderer(token: { math: string }) {
    return `\\(${escapeHtml(token.math)}\\)`
  },
}

// Render markdown to sanitized HTML. Returns the lexed tokens as well, for
// callers that want to inspect the document structure.
export function renderMarkdown(
  content: string,
  { headingAnchors = true, untrusted = false, onHeading }: RenderMarkdownOptions = {},
): { html: string; tokens: Token[] } {
  const slugger = new GithubSlugger()

  const marked = new Marked({ gfm: true })
  marked.use({
    extensions: [mathBlockExt, mathInlineExt],
    renderer: {
      heading(this, { tokens, depth }: Tokens.Heading) {
        const innerHtml = this.parser.parseInline(tokens)
        const plainText = tokens.map(tokenText).join("")
        if (!headingAnchors) return `<h${depth}>${innerHtml}</h${depth}>\n`
        const id = slugger.slug(plainText)
        onHeading?.({ depth, text: plainText, id })
        return (
          `<h${depth} id="${id}">` +
          `<a class="header-anchor" aria-label="Permalink to ${escapeHtml(plainText)}" href="#${id}">#</a>` +
          innerHtml +
          `</h${depth}>\n`
        )
      },
      // Fenced code blocks render with a server-side line-number gutter, so
      // the layout is final before highlight.js loads. highlight.js's
      // `highlightElement(<code>)` later swaps the code's children but leaves
      // the sibling `.line-number-rows` untouched.
      code({ text, lang }: Tokens.Code) {
        // Match marked's default normalization: trim trailing newlines, add
        // exactly one back, so the line count matches what's rendered.
        const body = text.replace(/\n+$/, "") + "\n"
        const lineCount = body.match(/\n/g)?.length ?? 1
        const gutter = `<span></span>`.repeat(lineCount)
        const lang0 = /^\S*/.exec(lang || "")?.[0] || ""
        const classAttr = lang0 ? ` class="language-${escapeHtml(lang0)}"` : ""
        return (
          `<div class="code-block">` +
          `<span class="line-number-rows" aria-hidden="true">${gutter}</span>` +
          `<pre><code${classAttr}>${escapeHtml(body)}</code></pre>` +
          `</div>\n`
        )
      },
    },
  })

  const tokens = marked.lexer(content)
  return { html: sanitizeHtml(marked.parser(tokens), untrusted), tokens }
}
