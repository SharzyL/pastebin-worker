import { escapeHtml } from "../common.js"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"
import { arrayBufferToBase64, getAssetPaths, renderCssLinks } from "../ssrUtils.js"
import { renderMarkdownDoc } from "../../shared/markdownDoc.js"
import { ENCRYPTED_MARKDOWN_ID } from "../../shared/constants.js"

const sidebarStyles = `
  /* Same font as the external GitHub stylesheet, inlined so the first paint
     already uses it even if that stylesheet arrives late */
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; }
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
  /* Shown only if decrypting an encrypted paste takes a while, so a quick
     decryption goes straight from a blank page to the content. Fixed to the
     middle of the viewport with its own box, so neither the page layout nor
     the external stylesheet arriving late can move it. */
  #${ENCRYPTED_MARKDOWN_ID} .pending-notice { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; margin: 0; padding: 0; font-size: 16px; line-height: 1.5; color: #57606a; opacity: 0; animation: pending-notice-appear 0s 0.5s forwards; }
  @keyframes pending-notice-appear { to { opacity: 1; } }
  .line-number-rows > span::before { content: counter(linenumber); counter-increment: linenumber; display: block; text-align: right; min-width: 1.5em; }
`

interface MarkdownPage {
  // plain text, escaped here
  title: string
  description: string
  tocHtml: string
  bodyHtml: string
}

function makeMarkdownPage({ title, description, tocHtml, bodyHtml }: MarkdownPage): string {
  const { jsFile, cssPaths } = getAssetPaths(manifest, "pages/render/markdown.ts")

  return `<!DOCTYPE html>
<html lang='en' class='light'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>
  <title>${escapeHtml(title)}</title>
  ${description.length > 0 ? `<meta name='description' content='${escapeHtml(description)}'>` : ""}
  <link rel='stylesheet' href='https://pages.github.com/assets/css/style.css'>
  ${renderCssLinks(cssPaths)}
  <style>${sidebarStyles}</style>
  <script id="MathJax-script" async
          src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js">
  </script>
  <script type='module' src='/${jsFile}'></script>
</head>
<body>
<div class='page${tocHtml ? " has-toc" : ""}'>
${tocHtml}
<article class='px-3 markdown-body'>
${bodyHtml}
</article>
</div>
</html>
`
}

export function makeMarkdown(content: string): string {
  const doc = renderMarkdownDoc(content)
  return makeMarkdownPage({ ...doc, bodyHtml: doc.html })
}

// The server cannot read an encrypted paste, so it sends a page without
// content, and the browser decrypts and renders the paste with the key in the
// URL fragment. Nothing derived from the content is in this page. A small
// paste comes with its ciphertext, which saves a request; a large one is
// fetched from `rawPath`.
export function makeEncryptedMarkdown(rawPath: string, scheme: string, ciphertext?: ArrayBuffer): string {
  const embedded = ciphertext ? ` data-ciphertext="${arrayBufferToBase64(ciphertext)}"` : ""
  return makeMarkdownPage({
    title: "Encrypted paste",
    description: "",
    tocHtml: "",
    bodyHtml:
      `<div id="${ENCRYPTED_MARKDOWN_ID}" data-src="${escapeHtml(rawPath)}" data-scheme="${escapeHtml(scheme)}"${embedded}>` +
      `<div class="pending-notice">Decrypting…</div><noscript><p>This paste is encrypted, and is decrypted with JavaScript.</p></noscript>` +
      `</div>`,
  })
}
