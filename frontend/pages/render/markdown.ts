// Client-side script for the /a/<paste> (and /doc/*) markdown pages.
//
// Plain pastes are rendered by the server: this script loads highlight.js
// core plus only the languages actually present in fenced code blocks
// (<pre><code class="language-X">), and highlights the table of contents
// while scrolling. Language chunks are shared with the React display page so
// the browser hits cache when navigating between the two.
//
// Encrypted pastes arrive as an empty page, which encryptedMarkdown.ts fills
// in after decrypting the paste.
import "../../styles/highlight-theme-light.css"
import "../../styles/highlight-theme-dark.css"
import { highlightCodeBlocks } from "../../utils/highlight-client.js"
import { ENCRYPTED_MARKDOWN_ID } from "../../../shared/constants.js"
import { initScrollSpy, plainSectionOf } from "./scrollSpy.js"

const encrypted = document.getElementById(ENCRYPTED_MARKDOWN_ID)
if (encrypted) {
  import("./encryptedMarkdown.js")
    .then(({ renderEncryptedMarkdown }) => renderEncryptedMarkdown(encrypted))
    .catch(console.error)
} else {
  void highlightCodeBlocks(document).catch(console.error)
  initScrollSpy(plainSectionOf)
}
