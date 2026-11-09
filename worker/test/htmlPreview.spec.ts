import { describe, expect, it } from "vitest"
import { createExecutionContext } from "cloudflare:test"
import { addRole, upload, workerFetch } from "./testUtils.js"
import { PASTE_SANDBOX_FLAGS, RAW_PASTE_CSP } from "../../shared/mime.js"

const html = "<!DOCTYPE html><html><body><script>document.title = 'hi'</script>hello</body></html>"

describe("raw paste headers", () => {
  const ctx = createExecutionContext()

  it("sandboxes everything but plain media", async () => {
    const url = (await upload(ctx, { c: html })).url
    for (const suffix of [
      "",
      ".html",
      ".svg",
      ".xhtml",
      ".xml",
      ".json",
      "?mime=text/html;charset=utf-8",
      "/x.txt",
      // +xml media is a document in disguise
      "?mime=image/x%2Bxml",
      "?mime=font/x%2Bxml",
    ]) {
      const resp = await workerFetch(ctx, url + suffix)
      expect(resp.status, suffix).toBe(200)
      expect(resp.headers.get("Content-Security-Policy"), suffix).toBe(RAW_PASTE_CSP)
      expect(resp.headers.get("X-Content-Type-Options"), suffix).toBe("nosniff")
    }
    for (const suffix of [".png", ".mp3", ".mp4", ".pdf", "?mime=Image/JPEG"]) {
      const resp = await workerFetch(ctx, url + suffix)
      expect(resp.headers.has("Content-Security-Policy"), suffix).toBe(false)
      expect(resp.headers.get("X-Content-Type-Options"), suffix).toBe("nosniff")
    }
  })

  it("serves html as plain text, whoever asks", async () => {
    const url = (await upload(ctx, { c: html })).url
    for (const dest of [undefined, "document", "empty", "image", "iframe", "frame"]) {
      const headers: Record<string, string> = dest ? { "Sec-Fetch-Dest": dest } : {}
      for (const suffix of [".html", "?mime=text/html", "/index.html"]) {
        const resp = await workerFetch(ctx, new Request(url + suffix, { headers }))
        expect(resp.status, `${dest} ${suffix}`).toBe(200)
        expect(resp.headers.get("Content-Type"), `${dest} ${suffix}`).toBe("text/plain;charset=UTF-8")
        expect(resp.headers.get("Content-Security-Policy"), `${dest} ${suffix}`).toBe(RAW_PASTE_CSP)
        expect(resp.headers.has("Vary"), `${dest} ${suffix}`).toBe(false)
        expect(await resp.text()).toBe(html)
      }
    }
  })

  it("tells a client the decrypted type the same way", async () => {
    const url = (await upload(ctx, { c: html, "encryption-scheme": "AES-GCM" })).url
    const resp = await workerFetch(ctx, `${url}.html`)
    expect(resp.headers.get("Content-Type")).toBe("text/plain;charset=UTF-8")
    expect(resp.headers.get("X-PB-Decrypted-Content-Type")).toBe("text/plain;charset=UTF-8")
  })
})

describe("preview page", () => {
  const ctx = createExecutionContext()

  it("frames the raw paste in a sandbox below a header", async () => {
    const url = (await upload(ctx, { c: html })).url
    const name = new URL(url).pathname.slice(1)
    const resp = await workerFetch(ctx, addRole(`${url}.html`, "h"))
    expect(resp.status).toBe(200)
    expect(resp.headers.get("Content-Type")).toBe("text/html;charset=UTF-8")
    // the page itself is ours, not sandboxed
    expect(resp.headers.has("Content-Security-Policy")).toBe(false)
    const page = await resp.text()
    expect(page).toContain(
      `<iframe id="html-preview" sandbox="${PASTE_SANDBOX_FLAGS}" title="Paste content" data-src="/${name}.html" data-type="text/html" hidden>`,
    )
    expect(PASTE_SANDBOX_FLAGS).not.toContain("allow-same-origin")
    expect(PASTE_SANDBOX_FLAGS).not.toContain("allow-top-navigation")
    expect(page).toContain(`href="/d/${name}.html"`)
    expect(page).toContain(`href="/${name}.html?a"`)
    // nothing is loaded until the viewer agrees
    expect(/<iframe[^>]*>/.exec(page)![0]).not.toContain(" src=")
    expect(page).toContain('id="html-preview-gate"')
    expect(page).toContain('<button id="html-preview-render"')
    expect(page).toContain("It can</h2>")
    expect(page).toContain("It cannot</h2>")
    expect(page).toContain('<script type="module" src="/')
    // nothing of the paste is in the page
    expect(page).not.toContain("hello")
  })

  it("carries the filename and query string into the frame", async () => {
    const url = (await upload(ctx, { c: html })).url
    const name = new URL(url).pathname.slice(1)
    const page = await (await workerFetch(ctx, addRole(`${url}/my%20page.html?mime=text/html`, "h"))).text()
    expect(page).toContain(`data-src="/${name}/my%20page.html?mime=text/html" data-type="text/html"`)
    expect(page).toContain(`${name} / my page.html`)
  })

  it("renders as html unless something says otherwise", async () => {
    const name = (u: string) => new URL(u).pathname.slice(1)
    const frameOf = async (u: string) =>
      /<iframe[^>]*>/.exec(await (await workerFetch(ctx, addRole(u, "h"))).text())![0]
    // no hint at all
    const plain = (await upload(ctx, { c: html })).url
    expect(await frameOf(plain)).toContain(`data-src="/${name(plain)}" data-type="text/html"`)
    // the uploaded filename is not a document type
    const txt = (await upload(ctx, { c: { content: new Blob([html]), filename: "notes.txt" } })).url
    expect(await frameOf(txt)).toContain(`data-src="/${name(txt)}" data-type="text/html"`)
    // the uploaded filename is a document type
    const svg = (await upload(ctx, { c: { content: new Blob([html]), filename: "pic.svg" } })).url
    expect(await frameOf(svg)).toContain(`data-src="/${name(svg)}" data-type="image/svg+xml"`)
    // explicit hints in the URL are taken as is
    expect(await frameOf(`${plain}.txt`)).toContain(`data-src="/${name(plain)}.txt" data-type="text/plain"`)
    expect(await frameOf(`${plain}?mime=text/plain`)).toContain(
      `data-src="/${name(plain)}?mime=text/plain" data-type="text/plain"`,
    )
    expect(await frameOf(`${plain}?mime=TEXT/HTML;charset=utf-8`)).toContain(
      `data-src="/${name(plain)}?mime=TEXT/HTML;charset=utf-8" data-type="text/html"`,
    )
    expect(await frameOf(`${plain}?x=1`)).toContain(`data-src="/${name(plain)}?x=1" data-type="text/html"`)
    // the encrypted frame gets the same treatment
    const enc = (await upload(ctx, { c: html, "encryption-scheme": "AES-GCM" })).url
    expect(await frameOf(enc)).toContain(`data-src="/${name(enc)}" data-type="text/html" data-scheme="AES-GCM"`)
    expect(await frameOf(`${enc}.svg`)).toContain(
      `data-src="/${name(enc)}.svg" data-type="image/svg+xml" data-scheme="AES-GCM"`,
    )
  })

  it("escapes what it puts in the page", async () => {
    const url = (await upload(ctx, { c: html })).url
    const page = await (
      await workerFetch(ctx, addRole(`${url}/%3Cb%3E.html?mime=text/html%22%3E%3Cscript%3E`, "h"))
    ).text()
    expect(page).not.toContain("<b>")
    expect(page).not.toContain('"><script>')
  })

  it("lets the browser decrypt an encrypted paste", async () => {
    const url = (await upload(ctx, { c: html, "encryption-scheme": "AES-GCM" })).url
    const name = new URL(url).pathname.slice(1)
    const resp = await workerFetch(ctx, addRole(`${url}.html`, "h"))
    expect(resp.status).toBe(200)
    const page = await resp.text()
    expect(page).toContain(
      `<iframe id="html-preview" sandbox="${PASTE_SANDBOX_FLAGS}" title="Paste content" data-src="/${name}.html" data-type="text/html" data-scheme="AES-GCM" hidden>`,
    )
    expect(page).toContain('id="html-preview-status"')
    expect(page).toContain(`href="/d/${name}.html" data-keep-key`)
    expect(page).toContain('id="html-preview-gate"')
    expect(page).toContain('<script type="module" src="/')
    expect(page).not.toContain("hello")
  })

  it("is 404 for a missing paste", async () => {
    const resp = await workerFetch(ctx, addRole(`${new URL((await upload(ctx, { c: html })).url).origin}/zzzz`, "h"))
    expect(resp.status).toBe(404)
  })
})
