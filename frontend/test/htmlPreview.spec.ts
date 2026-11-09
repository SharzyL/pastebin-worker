import { afterEach, describe, expect, it, vi } from "vitest"
import { userEvent } from "@testing-library/user-event"

import { encodeKey, encrypt, genKey } from "../utils/encryption.js"
import { initPreview, titleOf } from "../pages/render/htmlPreview.js"
import {
  HTML_PREVIEW_GATE_ID,
  HTML_PREVIEW_ID,
  HTML_PREVIEW_RENDER_ID,
  HTML_PREVIEW_STATUS_ID,
} from "../../shared/constants.js"

const html =
  "<!DOCTYPE html><html><head><title> My page </title></head><body><h1>secret</h1><script>alert(1)</script></body></html>"

function stubFetch(body: Uint8Array) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        // as for any request that is not a frame, the header says plain text
        new Response(body as BlobPart, { headers: { "Content-Type": "text/plain;charset=UTF-8" } }),
      ),
    ),
  )
}

function mount(frameAttrs: string): HTMLIFrameElement {
  document.body.innerHTML =
    `<a href="/d/abcd.html" data-keep-key>View source</a>` +
    `<section id="${HTML_PREVIEW_GATE_ID}"><button id="${HTML_PREVIEW_RENDER_ID}" type="button">Render</button></section>` +
    `<p id="${HTML_PREVIEW_STATUS_ID}" hidden></p>` +
    `<iframe id="${HTML_PREVIEW_ID}" sandbox="allow-scripts" ${frameAttrs} hidden></iframe>`
  const frame = document.getElementById(HTML_PREVIEW_ID) as HTMLIFrameElement
  initPreview(frame)
  return frame
}

// Stubs fetch with the ciphertext of `content` and returns its key. The page
// is mounted separately, after the key is put in the URL fragment
async function prepareEncrypted(content: string): Promise<string> {
  const cryptoKey = await genKey("AES-GCM")
  stubFetch(await encrypt("AES-GCM", cryptoKey, new TextEncoder().encode(content)))
  return encodeKey(cryptoKey)
}
const encryptedFrame = (type = "text/html", path = "/abcd.html") =>
  mount(`data-src="${path}" data-type="${type}" data-scheme="AES-GCM"`)

const clickRender = () => userEvent.click(document.getElementById(HTML_PREVIEW_RENDER_ID)!)
const status = () => document.getElementById(HTML_PREVIEW_STATUS_ID)
// the render handler is async: wait for it to settle
const settle = () => new Promise((r) => setTimeout(r, 20))

describe("html preview page", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    history.replaceState(null, "", "/")
    document.body.innerHTML = ""
    document.title = ""
  })

  it("loads nothing until the viewer agrees, then fetches a plain paste into the frame", async () => {
    stubFetch(new TextEncoder().encode(html))
    const frame = mount(`data-src="/abcd.html" data-type="text/html"`)
    expect(fetch).not.toHaveBeenCalled()
    expect(frame.hidden).toBe(true)
    expect(document.getElementById(HTML_PREVIEW_GATE_ID)).not.toBeNull()
    // a plain paste's links are left alone
    expect(document.querySelector("a")!.getAttribute("href")).toBe("/d/abcd.html")

    await clickRender()
    await settle()
    expect(fetch).toHaveBeenCalledWith("/abcd.html")
    expect(frame.srcdoc).toBe(html)
    expect(frame.getAttribute("src")).toBeNull()
    expect(frame.hidden).toBe(false)
    expect(document.getElementById(HTML_PREVIEW_GATE_ID)).toBeNull()
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts")
  })

  it("names the tab after the paste's title, parsed without running it", async () => {
    document.title = "abcd.html - Pastebin"
    stubFetch(new TextEncoder().encode(html))
    mount(`data-src="/abcd.html" data-type="text/html"`)
    await clickRender()
    await settle()
    expect(document.title).toBe("My page")

    expect(titleOf("<title>a</title><script>document.title='x'</script>")).toBe("a")
    expect(titleOf("<p>no title</p>")).toBeUndefined()
    expect(titleOf("<title>   </title>")).toBeUndefined()
    expect(titleOf(`<title>${"x".repeat(500)}</title>`)!.length).toBe(200)
  })

  it("leaves the tab title alone when the paste has none", async () => {
    document.title = "abcd.html - Pastebin"
    stubFetch(new TextEncoder().encode("<p>hi</p>"))
    mount(`data-src="/abcd.html" data-type="text/html"`)
    await clickRender()
    await settle()
    expect(document.title).toBe("abcd.html - Pastebin")
  })

  it("decrypts an encrypted paste into the frame after agreement, and keeps the key on links", async () => {
    const key = await prepareEncrypted(html)
    history.replaceState(null, "", `/h/abcd.html#${key}`)
    const frame = encryptedFrame()
    // the link gets the key right away, the content only after agreeing
    expect(document.querySelector("a")!.getAttribute("href")).toBe(`/d/abcd.html#${key}`)
    expect(fetch).not.toHaveBeenCalled()

    await clickRender()
    await settle()
    expect(fetch).toHaveBeenCalledWith("/abcd.html")
    expect(frame.srcdoc).toBe(html)
    expect(document.title).toBe("My page")
    expect(frame.hidden).toBe(false)
    expect(status()).toBeNull()
    expect(document.getElementById(HTML_PREVIEW_GATE_ID)).toBeNull()
  })

  it("takes only the key from a markdown-style fragment", async () => {
    const key = await prepareEncrypted(html)
    history.replaceState(null, "", `/h/abcd.html#${key}:section`)
    const frame = encryptedFrame()
    await clickRender()
    await settle()
    expect(frame.srcdoc).toBe(html)
  })

  it("loads other document types from the raw URL, which is sandboxed by the server", async () => {
    stubFetch(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))
    const frame = mount(`data-src="/abcd.svg" data-type="image/svg+xml"`)
    await clickRender()
    await settle()
    expect(fetch).not.toHaveBeenCalled()
    expect(frame.getAttribute("src")).toBe("/abcd.svg")
    expect(frame.srcdoc).toBe("")
    expect(frame.hidden).toBe(false)
  })

  it("puts other encrypted document types in a data URL, never a blob of this origin", async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>"
    const key = await prepareEncrypted(svg)
    history.replaceState(null, "", `/h/abcd.svg#${key}`)
    const frame = encryptedFrame("image/svg+xml", "/abcd.svg")
    const createObjectURL = vi.fn((_: Blob) => "blob:mock")
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }))
    await clickRender()
    await settle()
    expect(createObjectURL).not.toHaveBeenCalled()
    const src = frame.getAttribute("src")!
    expect(src.startsWith("data:image/svg+xml;base64,")).toBe(true)
    expect(atob(src.slice(src.indexOf(",") + 1))).toBe(svg)
    expect(frame.srcdoc).toBe("")
  })

  it("explains a missing or wrong key without touching the frame", async () => {
    const key = await prepareEncrypted(html)
    const frame = encryptedFrame()
    await clickRender()
    await settle()
    expect(status()!.textContent).toContain("including the key")
    expect(status()!.hidden).toBe(false)
    expect(frame.hidden).toBe(true)
    expect(frame.srcdoc).toBe("")

    history.replaceState(null, "", `/h/abcd.html#${key.slice(1)}x`)
    const again = encryptedFrame()
    await clickRender()
    await settle()
    expect(status()!.textContent).toMatch(/Invalid decryption key|Decryption failed/)
    expect(again.hidden).toBe(true)
  })
})
