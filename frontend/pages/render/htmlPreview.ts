// Drives /h/<name>: the frame stays empty until the viewer agrees to render
// the paste. The paste is then fetched, decrypted if it is encrypted (with
// the key in the URL fragment, which is not sent to the server, see
// doc/paste-crypto.md), and put in the sandboxed frame. The raw URL never
// serves HTML, so this is the only way a paste is rendered.
import type { EncryptionScheme } from "../../utils/encryption.js"
import { decodeKey, decrypt } from "../../utils/encryption.js"
import {
  HTML_PREVIEW_GATE_ID,
  HTML_PREVIEW_ID,
  HTML_PREVIEW_RENDER_ID,
  HTML_PREVIEW_STATUS_ID,
} from "../../../shared/constants.js"

const MAX_TITLE_LENGTH = 200

function showStatus(text: string) {
  const status = document.getElementById(HTML_PREVIEW_STATUS_ID)
  if (status) {
    status.textContent = text
    status.hidden = false
  }
}

// The same "#<key>[:<section>]" fragment as the markdown page, so a link
// made for one page works on the other
const keyFromFragment = () => location.hash.slice(1).split(":")[0]

async function fetchPaste(frame: HTMLIFrameElement): Promise<Uint8Array | null> {
  const scheme = frame.dataset.scheme as EncryptionScheme | undefined
  let cryptoKey: CryptoKey | undefined
  if (scheme) {
    const key = keyFromFragment()
    if (!key) {
      showStatus('This paste is encrypted. Open it with the full link, including the key after "#".')
      return null
    }
    try {
      cryptoKey = await decodeKey(scheme, key)
    } catch (e) {
      showStatus(`Invalid decryption key: ${(e as Error).message}`)
      return null
    }
  }
  showStatus("Loading…")
  const resp = await fetch(frame.dataset.src!)
  if (!resp.ok) {
    showStatus(`Failed to fetch the paste: ${resp.status} ${await resp.text()}`)
    return null
  }
  const bytes = new Uint8Array(await resp.arrayBuffer())
  if (!scheme) return bytes
  const plaintext = await decrypt(scheme, cryptoKey!, bytes)
  if (plaintext === null) {
    showStatus("Decryption failed. The key may be wrong, or the paste has been replaced.")
  }
  return plaintext
}

// The title of an HTML document, parsed without running anything in it
export function titleOf(html: string): string | undefined {
  const title = new DOMParser().parseFromString(html, "text/html").title.trim()
  return title ? title.slice(0, MAX_TITLE_LENGTH) : undefined
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export async function renderPaste(frame: HTMLIFrameElement) {
  document.getElementById(HTML_PREVIEW_GATE_ID)?.remove()
  // `data-type` is what the server decided to render the paste as (see
  // handleRead): the response header says text/plain for HTML. HTML goes in
  // as srcdoc, with the page's base URL, `about:srcdoc`: links to its own
  // sections work, relative links to this site do not (see
  // worker/pages/htmlPreview.ts). Other document types are loaded from the raw URL, which
  // the server serves under a CSP sandbox, or, when encrypted, from a data
  // URL. Never from a blob URL: a blob belongs to this site's origin, and
  // opened outside the sandboxed frame it would run as this site.
  const type = frame.dataset.type || "text/html"
  if (type !== "text/html" && !frame.dataset.scheme) {
    frame.src = frame.dataset.src!
  } else {
    const bytes = await fetchPaste(frame)
    if (bytes === null) return
    if (type === "text/html") {
      const html = new TextDecoder().decode(bytes)
      const title = titleOf(html)
      if (title) document.title = title
      frame.srcdoc = html
    } else {
      frame.src = `data:${type};base64,${toBase64(bytes)}`
    }
  }
  document.getElementById(HTML_PREVIEW_STATUS_ID)?.remove()
  frame.hidden = false
}

export function initPreview(frame: HTMLIFrameElement) {
  // Links to the display page need the key too
  if (frame.dataset.scheme) {
    const key = keyFromFragment()
    if (key) {
      document.querySelectorAll<HTMLAnchorElement>("a[data-keep-key]").forEach((a) => {
        a.setAttribute("href", `${a.getAttribute("href")!}#${key}`)
      })
    }
    window.addEventListener("hashchange", () => location.reload())
  }
  document.getElementById(HTML_PREVIEW_RENDER_ID)?.addEventListener("click", () => {
    renderPaste(frame).catch((e: unknown) => {
      console.error(e)
      showStatus(`Failed to show the paste: ${(e as Error).message}`)
    })
  })
}

const frame = document.getElementById(HTML_PREVIEW_ID) as HTMLIFrameElement | null
if (frame) initPreview(frame)
