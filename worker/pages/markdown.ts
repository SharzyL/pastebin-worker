import { unified } from "unified"
import type { Root, Heading } from "mdast"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import { toString } from "mdast-util-to-string"
import { visit } from "unist-util-visit"
import GithubSlugger from "github-slugger"

import { escapeHtml } from "../common.js"

const descriptionLimit = 200
const defaultTitle = "Untitled"
const TOC_MIN_DEPTH = 2
const TOC_MAX_DEPTH = 4
const TOC_THRESHOLD = 3

interface TocEntry {
  depth: number
  text: string
  id: string
}

interface DocMetadata {
  title: string
  description: string
  toc: TocEntry[]
}

function collectMetadata(options: { result: DocMetadata }): (_: Root) => void {
  return (tree: Root) => {
    if (tree.children.length > 0) {
      const firstChild = tree.children[0]
      if (firstChild.type === "heading" && firstChild.depth === 1) {
        options.result.title = escapeHtml(toString(firstChild))
        if (tree.children.length > 1) {
          const secondChild = tree.children[1]
          options.result.description = escapeHtml(toString(secondChild).slice(0, descriptionLimit))
        }
      } else {
        options.result.description = escapeHtml(toString(firstChild).slice(0, descriptionLimit))
      }
    }

    const slugger = new GithubSlugger()
    visit(tree, "heading", (node: Heading) => {
      const text = toString(node)
      const id = slugger.slug(text)

      node.data ??= {}
      const data = node.data as { hProperties?: Record<string, unknown> }
      data.hProperties ??= {}
      data.hProperties.id = id

      options.result.toc.push({ depth: node.depth, text, id })

      node.children.unshift({
        type: "link",
        url: `#${id}`,
        data: {
          hProperties: { class: "header-anchor", "aria-label": `Permalink to ${text}` },
        },
        children: [{ type: "text", value: "#" }],
      })
    })
  }
}

function renderToc(toc: TocEntry[]): string {
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
  const convertedHtml = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(collectMetadata, { result: metadata })
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(content)
    .value.toString()

  const tocHtml = renderToc(metadata.toc)
  const hasToc = tocHtml.length > 0

  return `<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>
  <title>${metadata.title}</title>
  ${metadata.description.length > 0 ? `<meta name='description' content='${metadata.description}'>` : ""}
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/themes/prism.css' rel='stylesheet' />
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/plugins/line-numbers/prism-line-numbers.css' rel='stylesheet' />
  <link rel='stylesheet' href='https://pages.github.com/assets/css/style.css'>
  <style>${sidebarStyles}</style>
  <script id="MathJax-script" async
          src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js">
  </script>
</head>
<body>
<div class='page${hasToc ? " has-toc" : ""}'>
${tocHtml}
<article class='line-numbers px-3 markdown-body'>
${convertedHtml}
</article>
</div>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/components/prism-core.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/plugins/line-numbers/prism-line-numbers.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/plugins/autoloader/prism-autoloader.min.js'></script>
  ${hasToc ? `<script>${scrollSpyScript}</script>` : ""}
</html>
`
}
