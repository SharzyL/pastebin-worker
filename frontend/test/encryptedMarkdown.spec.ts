import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"

import { encodeKey, encrypt, genKey } from "../utils/encryption.js"
import { parseFragment, renderEncryptedMarkdown, sectionHref } from "../pages/render/encryptedMarkdown.js"
import { ENCRYPTED_MARKDOWN_ID } from "../../shared/constants.js"

const doc = `# Title

Intro with a [link to usage](#usage).

## Install

\`\`\`js
console.log(1)
\`\`\`

## Usage

Text.

## Notes

More.
`

async function setup(content: string, embed = false): Promise<{ key: string; root: HTMLElement }> {
  const cryptoKey = await genKey("AES-GCM")
  const ciphertext = await encrypt("AES-GCM", cryptoKey, new TextEncoder().encode(content))
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(ciphertext as BlobPart))),
  )
  document.body.innerHTML =
    `<div class="page"><article class="markdown-body">` +
    `<div id="${ENCRYPTED_MARKDOWN_ID}" data-src="/abcd" data-scheme="AES-GCM"` +
    (embed ? ` data-ciphertext="${btoa(String.fromCharCode(...ciphertext))}"` : "") +
    `></div>` +
    `</article></div>`
  return { key: await encodeKey(cryptoKey), root: document.getElementById(ENCRYPTED_MARKDOWN_ID)! }
}

describe("encrypted markdown page", () => {
  const scrolled: string[] = []

  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    history.replaceState(null, "", "/")
    document.body.innerHTML = ""
  })

  it("parses key and section from the fragment", () => {
    expect(parseFragment("#abc")).toStrictEqual({ key: "abc" })
    expect(parseFragment("#abc:usage")).toStrictEqual({ key: "abc", section: "usage" })
    expect(parseFragment("#abc:")).toStrictEqual({ key: "abc" })
    expect(parseFragment(sectionHref("abc", "使い方 a:b"))).toStrictEqual({ key: "abc", section: "使い方 a:b" })
    expect(parseFragment("")).toStrictEqual({ key: "" })
  })

  it("decrypts, renders, and keeps the key in in-page links", async () => {
    const { key, root } = await setup(doc)
    history.replaceState(null, "", `/a/abcd#${key}:usage`)
    await renderEncryptedMarkdown(root)

    expect(fetch).toHaveBeenCalledWith("/abcd")
    expect(document.title).toStrictEqual("Title")
    expect(root.querySelector("h2#install")).not.toBeNull()
    expect(root.querySelector("code.language-js")).not.toBeNull()
    expect(document.querySelector(".page")!.classList.contains("has-toc")).toStrictEqual(true)

    // the table of contents, heading anchors and links in the text all carry the key
    const tocHrefs = Array.from(document.querySelectorAll(".toc a"), (a) => a.getAttribute("href"))
    expect(tocHrefs).toStrictEqual([`#${key}:install`, `#${key}:usage`, `#${key}:notes`])
    expect(root.querySelector("h2#notes .header-anchor")!.getAttribute("href")).toStrictEqual(`#${key}:notes`)
    expect(root.querySelector('p a[href*="usage"]')!.getAttribute("href")).toStrictEqual(`#${key}:usage`)

    // the section in the initial fragment is scrolled to, and so are later ones
    expect(scrolled).toStrictEqual(["usage"])
    location.hash = `${key}:notes`
    await waitFor(() => expect(scrolled).toStrictEqual(["usage", "notes"]))
    expect(parseFragment(location.hash).key).toStrictEqual(key)
  })

  it("uses the embedded ciphertext without fetching", async () => {
    const { key, root } = await setup(doc, true)
    history.replaceState(null, "", `/a/abcd#${key}`)
    await renderEncryptedMarkdown(root)
    expect(fetch).not.toHaveBeenCalled()
    expect(document.title).toStrictEqual("Title")
  })

  it("shows an error without a key or with a wrong key", async () => {
    const { root } = await setup(doc)
    history.replaceState(null, "", "/a/abcd")
    await renderEncryptedMarkdown(root)
    expect(root.textContent).toContain("including the key")
    expect(fetch).not.toHaveBeenCalled()

    const other = await setup(doc)
    history.replaceState(null, "", `/a/abcd#${await encodeKey(await genKey("AES-GCM"))}`)
    await renderEncryptedMarkdown(other.root)
    expect(other.root.textContent).toContain("Decryption failed")
    expect(other.root.textContent).not.toContain("Install")
  })
})
