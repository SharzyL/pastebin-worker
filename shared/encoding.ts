import { BINARY_SNIFF_BYTES } from "./constants.js"

const HTML_ESCAPE_REPLACEMENTS: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_REPLACEMENTS[character])
}

export async function hasBinaryMarker(content: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await content.slice(0, BINARY_SNIFF_BYTES).arrayBuffer())
  return bytes.includes(0)
}

// Returns "UTF-8" if the bytes are valid UTF-8 (which subsumes pure ASCII), null otherwise.
// Used to decide whether a paste should render as text or be treated as a binary download.
//
// This is a deliberate simplification of full charset detection: legacy single-byte encodings
// (ISO-8859-1, Windows-1252, etc.) are reported as binary. UTF-8 is universal enough today
// that the regression is acceptable, and the user can still force-render via the UI.
export function detectUtf8(bytes: Uint8Array): "UTF-8" | null {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return "UTF-8"
  } catch {
    return null
  }
}
