// Client-side syntax highlighting for the /a/<paste> (and /doc/*) markdown
// pages. Scans the page for fenced code blocks marked by marked as
// <pre><code class="language-X">, then loads highlight.js core plus only the
// languages actually present. Shares language chunks with the React display
// page so the browser hits cache when navigating between the two.
import "../../styles/highlight-theme-light.css"
import "../../styles/highlight-theme-dark.css"
import { canonicalLangName, loaderForLang } from "../../utils/hljsLanguages.js"

const LANG_RE = /language-([\w-]+)/i

async function highlightAll(): Promise<void> {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>("pre > code[class*='language-']"))
  if (!blocks.length) return

  // Collect the *canonical* set of languages to load. Markdown fences use
  // aliases freely (```js, ```py); we must dedupe at the canonical level so
  // we don't fetch javascript twice for ```js and ```javascript.
  const canonicals = new Set<string>()
  for (const el of blocks) {
    const m = LANG_RE.exec(el.className)
    if (!m || m[1] === "plaintext") continue
    const canonical = canonicalLangName(m[1])
    if (canonical) canonicals.add(canonical)
  }
  if (!canonicals.size) return

  const { default: hljs } = await import("highlight.js/lib/core")

  await Promise.all(
    Array.from(canonicals, async (canonical) => {
      const loader = loaderForLang(canonical)
      if (!loader) return
      try {
        const mod = await loader()
        hljs.registerLanguage(canonical, mod.default)
      } catch (e) {
        console.warn(`highlight.js: failed to load language "${canonical}":`, e)
      }
    }),
  )

  // highlightElement reads the language-X class itself, including aliases,
  // because hljs resolves alias → registered canonical internally. Mark each
  // node as we go so a second run of this bootstrap (e.g. if the module is
  // imported twice for any reason) doesn't re-wrap already-highlighted spans.
  for (const el of blocks) {
    if (el.dataset.hljsHighlighted === "true") continue
    const m = LANG_RE.exec(el.className)
    if (m && hljs.getLanguage(m[1])) {
      hljs.highlightElement(el)
      el.dataset.hljsHighlighted = "true"
    }
  }
}

void highlightAll().catch(console.error)
