import type { Token, Tokens } from "marked"

import { escapeHtml } from "../common.js"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"
import { getAssetPaths, renderCssLinks } from "../ssrUtils.js"
import type { MarkdownHeading } from "../../shared/markdown.js"
import { renderMarkdown, tokenText } from "../../shared/markdown.js"

const descriptionLimit = 200
const defaultTitle = "Untitled"
const TOC_MIN_DEPTH = 2
const TOC_MAX_DEPTH = 4
const TOC_THRESHOLD = 3

interface DocMetadata {
  title: string
  description: string
  toc: MarkdownHeading[]
}

function firstContentToken(tokens: Token[]): Token | undefined {
  return tokens.find((t) => t.type !== "space")
}

function extractMetadata(tokens: Token[], result: DocMetadata): void {
  const first = firstContentToken(tokens)
  if (!first) return
  if (first.type === "heading" && (first as Tokens.Heading).depth === 1) {
    result.title = escapeHtml(tokenText(first))
    const rest = tokens.slice(tokens.indexOf(first) + 1)
    const second = firstContentToken(rest)
    if (second) result.description = escapeHtml(tokenText(second).slice(0, descriptionLimit))
  } else {
    result.description = escapeHtml(tokenText(first).slice(0, descriptionLimit))
  }
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

const sidebarStyles = `
  body { margin: 0; }
  .page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2rem; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; box-sizing: border-box; }
  .page > article { min-width: 0; }
  @media (min-width: 1024px) { .page.has-toc { grid-template-columns: 240px minmax(0, 1fr); } }
  .toc { font-size: 0.9em; line-height: 1.5; }
  @media (min-width: 1024px) { .toc { position: sticky; top: 1rem; align-self: start; max-height: calc(100vh - 2rem); overflow-y: auto; } }
  .toc ol { list-style: none; padding-left: 1em; margin: 0; }
  .toc > ol { padding-left: 0; }
  .toc li { margin: 0; }
  .toc a { display: block; padding: 0.2rem 0 0.2rem 0.5rem; color: #57606a; text-decoration: none; border-left: 2px solid transparent; }
  .toc a:hover { color: #0969da; }
  .toc a.active { color: #0969da; border-left-color: #0969da; background: rgba(9, 105, 218, 0.06); }
  .markdown-body :is(h1, h2, h3, h4, h5, h6) .header-anchor { opacity: 0; margin-left: -0.8em; padding-right: 0.2em; color: #57606a; text-decoration: none; font-weight: normal; }
  .markdown-body :is(h1, h2, h3, h4, h5, h6):hover .header-anchor,
  .markdown-body .header-anchor:focus { opacity: 1; }
  /* Fenced code block layout. The line-number gutter is rendered server-side
     and uses CSS counters, so it's visible immediately (no JS / no CLS) and
     stays put once highlight.js swaps the code's children. */
  .markdown-body .code-block { display: grid; grid-template-columns: auto minmax(0, 1fr); margin: 1em 0; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; overflow: hidden; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 85%; line-height: 1.45; }
  .markdown-body .code-block > pre { grid-column: 2; margin: 0; padding: 12px 16px; overflow-x: auto; background: transparent; font: inherit; border: 0; border-radius: 0; }
  .markdown-body .code-block > pre > code { background: transparent; padding: 0; font: inherit; border-radius: 0; }
  .markdown-body .code-block > .line-number-rows { grid-column: 1; padding: 12px 8px 12px 12px; border-right: 1px solid #d0d7de; color: #6e7681; user-select: none; counter-reset: linenumber; }
  .line-number-rows > span::before { content: counter(linenumber); counter-increment: linenumber; display: block; text-align: right; min-width: 1.5em; }
`

const scrollSpyScript = `
(() => {
  const links = new Map();
  document.querySelectorAll('.toc a[href^="#"]').forEach((a) => {
    links.set(decodeURIComponent(a.getAttribute('href').slice(1)), a);
  });
  if (!links.size) return;
  const headings = [];
  links.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) headings.push(el);
  });
  if (!headings.length) return;
  let active = null;
  let lockUntil = 0;
  const setActive = (link) => {
    if (link === active) return;
    if (active) active.classList.remove('active');
    if (link) link.classList.add('active');
    active = link;
  };
  const update = () => {
    if (Date.now() < lockUntil) return;
    const threshold = 80;
    let current = null;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= threshold) current = h;
      else break;
    }
    if (!current) current = headings[0];
    setActive(links.get(current.id));
  };
  const setActiveByHash = () => {
    if (!location.hash) return false;
    const id = decodeURIComponent(location.hash.slice(1));
    const link = links.get(id);
    if (!link) return false;
    setActive(link);
    lockUntil = Date.now() + 800;
    return true;
  };
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window.addEventListener('hashchange', setActiveByHash);
  if (!setActiveByHash()) update();
})();
`

export function makeMarkdown(content: string): string {
  const metadata: DocMetadata = { title: defaultTitle, description: "", toc: [] }
  const { html: convertedHtml, tokens } = renderMarkdown(content, { onHeading: (h) => metadata.toc.push(h) })
  extractMetadata(tokens, metadata)

  const tocHtml = renderToc(metadata.toc)
  const hasToc = tocHtml.length > 0
  const { jsFile, cssPaths } = getAssetPaths(manifest, "pages/render/markdown.ts")

  return `<!DOCTYPE html>
<html lang='en' class='light'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>
  <title>${metadata.title}</title>
  ${metadata.description.length > 0 ? `<meta name='description' content='${metadata.description}'>` : ""}
  <link rel='stylesheet' href='https://pages.github.com/assets/css/style.css'>
  ${renderCssLinks(cssPaths)}
  <style>${sidebarStyles}</style>
  <script id="MathJax-script" async
          src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js">
  </script>
  <script type='module' src='/${jsFile}'></script>
</head>
<body>
<div class='page${hasToc ? " has-toc" : ""}'>
${tocHtml}
<article class='px-3 markdown-body'>
${convertedHtml}
</article>
</div>
  ${hasToc ? `<script>${scrollSpyScript}</script>` : ""}
</html>
`
}
