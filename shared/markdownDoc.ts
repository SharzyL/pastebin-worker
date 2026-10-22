import type { Token, Tokens } from "marked"

import { escapeHtml } from "./html.js"
import type { MarkdownHeading } from "./markdown.js"
import { renderMarkdown, tokenText } from "./markdown.js"

// A markdown paste rendered as a document page: the body plus the title,
// description and table of contents derived from it. Shared by the server,
// which renders plain pastes, and the browser, which renders encrypted ones.

const DESCRIPTION_LIMIT = 200
export const DEFAULT_DOC_TITLE = "Untitled"
const TOC_MIN_DEPTH = 2
const TOC_MAX_DEPTH = 4
const TOC_THRESHOLD = 3

export interface MarkdownDoc {
  // plain text, not escaped
  title: string
  description: string
  // HTML, empty when there are too few headings for a table of contents
  tocHtml: string
  html: string
}

function firstContentToken(tokens: Token[]): Token | undefined {
  return tokens.find((t) => t.type !== "space")
}

function extractTitle(tokens: Token[]): { title: string; description: string } {
  const first = firstContentToken(tokens)
  if (!first) return { title: DEFAULT_DOC_TITLE, description: "" }
  if (first.type === "heading" && (first as Tokens.Heading).depth === 1) {
    const rest = tokens.slice(tokens.indexOf(first) + 1)
    const second = firstContentToken(rest)
    return {
      title: tokenText(first),
      description: second ? tokenText(second).slice(0, DESCRIPTION_LIMIT) : "",
    }
  }
  return { title: DEFAULT_DOC_TITLE, description: tokenText(first).slice(0, DESCRIPTION_LIMIT) }
}

function renderToc(toc: MarkdownHeading[]): string {
  const filtered = toc.filter((h) => h.depth >= TOC_MIN_DEPTH && h.depth <= TOC_MAX_DEPTH)
  if (filtered.length < TOC_THRESHOLD) return ""

  const openDepths: number[] = []
  let html = ""

  for (const entry of filtered) {
    while (openDepths.length > 0 && openDepths[openDepths.length - 1] > entry.depth) {
      html += "</li></ol>"
      openDepths.pop()
    }
    const top = openDepths[openDepths.length - 1]
    if (top === entry.depth) {
      html += "</li>"
    } else {
      html += "<ol>"
      openDepths.push(entry.depth)
    }
    html += `<li><a href="#${entry.id}">${escapeHtml(entry.text)}</a>`
  }
  while (openDepths.length > 0) {
    html += "</li></ol>"
    openDepths.pop()
  }

  return `<nav class="toc" aria-label="Table of contents">${html}</nav>`
}

export function renderMarkdownDoc(content: string): MarkdownDoc {
  const toc: MarkdownHeading[] = []
  const { html, tokens } = renderMarkdown(content, { onHeading: (h) => toc.push(h) })
  return { ...extractTitle(tokens), tocHtml: renderToc(toc), html }
}
