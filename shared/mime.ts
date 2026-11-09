// MIME handling for raw paste responses.
//
// A paste's Content-Type comes from the `?mime=` query, the URL extension or
// the uploaded filename, so it is user input. Whatever the type, a raw paste
// may carry markup and scripts, so instead of guessing which types a browser
// would render, every raw response that is not plain media is served under a
// CSP sandbox (an opaque origin: no cookies, storage or credentials of this
// site). On top of that, document types (HTML, XHTML, XML; everything but
// SVG, which has to stay an image for `<img>`) and the types in
// `DISALLOWED_MIME_FOR_PASTE` are served as plain text, so a raw URL never
// shows up as a web page under this site's name. To render a paste, the
// preview page `/h/<name>` fetches it and puts it in a sandboxed frame itself.

export const PLAIN_TEXT_MIME = "text/plain;charset=UTF-8"
const SVG_MIME = "image/svg+xml"

// RFC 7231 token characters, in `type/subtype`
const ESSENCE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/

/** Lowercased `type/subtype` of a MIME string without its parameters, or null if it is not one. */
export function mimeEssence(m: string): string | null {
  const essence = m.split(";", 1)[0].trim().toLowerCase()
  return ESSENCE_RE.test(essence) ? essence : null
}

/**
 * A MIME string safe to put in a header: trimmed, with a well-formed
 * `type/subtype` that is neither a document type (SVG aside) nor in
 * `disallowed`. Anything else is plain text. Parameters such as `charset`
 * are kept as given.
 */
export function sanitizeMime(m: string, disallowed: readonly string[]): string {
  const trimmed = m.trim()
  const essence = mimeEssence(trimmed)
  if (
    essence === null ||
    (isDocumentMime(essence) && essence !== SVG_MIME) ||
    disallowed.includes(essence) ||
    /[^\x20-\x7e]/.test(trimmed)
  )
    return PLAIN_TEXT_MIME
  return trimmed
}

/** Types a browser renders as a document that can carry markup and scripts. */
export function isDocumentMime(essence: string): boolean {
  return (
    essence === "text/html" ||
    essence === "text/xml" ||
    essence === "application/xml" ||
    essence === "text/xsl" ||
    essence.endsWith("+xml")
  )
}

/** Media the browser shows by itself, with no markup or script. These are the only raw responses served without a sandbox. */
export function isPlainMedia(essence: string): boolean {
  // `+xml` media such as SVG is a document in disguise
  if (essence.endsWith("+xml")) return false
  return /^(image|audio|video|font)\//.test(essence) || essence === "application/pdf"
}

// Sandbox flags for a rendered paste. Scripts and forms run, but in an opaque
// origin: without `allow-same-origin` the content can never reach this site's
// cookies, storage or credentials, and without `allow-top-navigation` it
// cannot navigate the preview page away from its header.
export const PASTE_SANDBOX_FLAGS = "allow-scripts allow-forms allow-popups allow-modals"
export const RAW_PASTE_CSP = `sandbox ${PASTE_SANDBOX_FLAGS}`
