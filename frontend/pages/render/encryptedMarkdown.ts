// Renders an encrypted markdown paste on /a/<name>, whose page arrives empty.
// The URL fragment is "#<key>" or "#<key>:<section>"; neither part is sent to
// the server. See doc/paste-crypto.md.
import type { EncryptionScheme } from "../../utils/encryption.js"
import { decodeKey, decrypt } from "../../utils/encryption.js"
import { highlightCodeBlocks } from "../../utils/highlight-client.js"
import { renderMarkdownDoc } from "../../../shared/markdownDoc.js"
import { initScrollSpy } from "./scrollSpy.js"

// Keys are base64 without "/" or padding, so they never contain this
const SECTION_SEP = ":"

interface Fragment {
  key: string
  section?: string
}

declare global {
  interface Window {
    MathJax?: { startup?: { promise: Promise<void> }; typesetPromise?: (elements?: Element[]) => Promise<void> }
  }
}

function decodeSection(s: string): string | undefined {
  try {
    return decodeURIComponent(s) || undefined
  } catch {
    return undefined
  }
}

// `hash` includes the leading "#"
export function parseFragment(hash: string): Fragment {
  const raw = hash.slice(1)
  const sep = raw.indexOf(SECTION_SEP)
  if (sep < 0) return { key: raw }
  const section = decodeSection(raw.slice(sep + 1))
  return section === undefined ? { key: raw.slice(0, sep) } : { key: raw.slice(0, sep), section }
}

export function sectionHref(key: string, section: string): string {
  return `#${key}${SECTION_SEP}${encodeURIComponent(section)}`
}

function showError(root: HTMLElement, title: string, detail: string) {
  root.replaceChildren()
  for (const [tag, text] of [
    ["h1", title],
    ["p", detail],
  ]) {
    const el = document.createElement(tag)
    el.textContent = text
    root.appendChild(el)
  }
}

function scrollToSection(section: string | undefined) {
  if (section !== undefined) document.getElementById(section)?.scrollIntoView()
}

// MathJax loads asynchronously. If it is still starting, its first pass picks
// the rendered math up; otherwise the new content is typeset explicitly.
async function typesetMath(root: HTMLElement) {
  const mathJax = window.MathJax
  if (!mathJax?.typesetPromise) return
  await mathJax.startup?.promise
  await mathJax.typesetPromise([root])
}

// Small pastes come embedded in the page as base64
function embeddedCiphertext(root: HTMLElement): Uint8Array | undefined {
  const embedded = root.dataset.ciphertext
  return embedded === undefined ? undefined : Uint8Array.from(atob(embedded), (c) => c.charCodeAt(0))
}

async function fetchCiphertext(root: HTMLElement, src: string): Promise<Uint8Array | null> {
  const resp = await fetch(src)
  if (!resp.ok) {
    showError(root, "Failed to fetch the paste", `${resp.status} ${await resp.text()}`)
    return null
  }
  return new Uint8Array(await resp.arrayBuffer())
}

async function decryptPaste(root: HTMLElement, key: string): Promise<string | null> {
  const src = root.dataset.src!
  const scheme = root.dataset.scheme as EncryptionScheme
  if (!key) {
    showError(root, "Encrypted paste", 'Open this paste with the full link, including the key after "#".')
    return null
  }
  let cryptoKey: CryptoKey
  try {
    cryptoKey = await decodeKey(scheme, key)
  } catch (e) {
    showError(root, "Invalid decryption key", (e as Error).message)
    return null
  }
  const ciphertext = embeddedCiphertext(root) ?? (await fetchCiphertext(root, src))
  if (ciphertext === null) return null
  const plaintext = await decrypt(scheme, cryptoKey, ciphertext)
  if (plaintext === null) {
    showError(
      root,
      "Decryption failed",
      "Could not decrypt the paste with the key in the URL. The key may be wrong, or the paste has been replaced.",
    )
    return null
  }
  return new TextDecoder().decode(plaintext)
}

export async function renderEncryptedMarkdown(root: HTMLElement) {
  const { key, section } = parseFragment(location.hash)
  const content = await decryptPaste(root, key)
  if (content === null) return

  const doc = renderMarkdownDoc(content)
  document.title = doc.title
  root.innerHTML = doc.html
  const page = root.closest(".page")
  if (doc.tocHtml && page) {
    page.insertAdjacentHTML("afterbegin", doc.tocHtml)
    page.classList.add("has-toc")
  }

  // Point in-page links at "#<key>:<section>", so following, copying or
  // opening them keeps the key in the URL
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    const target = decodeSection(a.getAttribute("href")!.slice(1))
    if (target !== undefined) a.setAttribute("href", sectionHref(key, target))
  })

  initScrollSpy((hash) => parseFragment(hash).section)
  // The browser looks for an element with the id "<key>:<section>" and does
  // not find one, so scrolling is up to us
  window.addEventListener("hashchange", () => {
    const next = parseFragment(location.hash)
    if (next.key !== key) location.reload()
    else scrollToSection(next.section)
  })
  scrollToSection(section)

  await highlightCodeBlocks(root)
  await typesetMath(root)
}
