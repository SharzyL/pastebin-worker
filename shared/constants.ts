export const CHAR_GEN = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678"
export const NAME_REGEX = /^[a-zA-Z0-9+_\-[\]*$@,;]{3,}$/
export const PASTE_NAME_LEN = 4
export const PRIVATE_PASTE_NAME_LEN = 24
export const DEFAULT_PASSWD_LEN = 24
export const MAX_PASSWD_LEN = 128
export const MIN_PASSWD_LEN = 8
export const MAX_URL_REDIRECT_LEN = 2000
export const PASSWD_SEP = ":"
export const MAX_AUTO_FETCH_BYTES = 256 * 1024
// Client-side encryption schemes a paste can declare, see doc/paste-crypto.md
export const ENCRYPTION_SCHEMES: readonly string[] = ["AES-GCM"]
// A highlight language name: what highlight.js and the editor accept, and
// safe in the X-PB-Highlight-Language header
export const HIGHLIGHT_LANG_REGEX = /^[\w+#.-]{1,64}$/
// Placeholder on /a/<name> for an encrypted paste, which the browser renders
export const ENCRYPTED_MARKDOWN_ID = "encrypted-markdown"
// Elements on /h/<name>: the sandboxed iframe showing the paste, the warning
// shown until the viewer agrees to render it, its button, and the notice
// shown while an encrypted paste is decrypted in the browser
export const HTML_PREVIEW_ID = "html-preview"
export const HTML_PREVIEW_GATE_ID = "html-preview-gate"
export const HTML_PREVIEW_RENDER_ID = "html-preview-render"
export const HTML_PREVIEW_STATUS_ID = "html-preview-status"
