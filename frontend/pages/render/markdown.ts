// Client-side syntax highlighting for the /a/<paste> (and /doc/*) markdown
// pages. Scans the page for fenced code blocks marked by marked as
// <pre><code class="language-X">, then loads highlight.js core plus only the
// languages actually present. Shares language chunks with the React display
// page so the browser hits cache when navigating between the two.
import "../../styles/highlight-theme-light.css"
import "../../styles/highlight-theme-dark.css"
import { highlightCodeBlocks } from "../../utils/highlight-client.js"

void highlightCodeBlocks(document).catch(console.error)
