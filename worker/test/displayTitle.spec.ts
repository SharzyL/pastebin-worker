import { expect, test } from "vitest"
import { createExecutionContext } from "cloudflare:test"
import { addRole, upload, workerFetch } from "./testUtils.js"
import { escapeHtml } from "../common.js"

// A filename that would close the <title> and run a script if not escaped
const evil = "</title><script>alert(1)</script>$'.txt"

async function displayPage(ctx: ExecutionContext, url: string): Promise<string> {
  const resp = await workerFetch(ctx, addRole(url, "d"))
  expect(resp.status).toBe(200)
  return resp.text()
}

function expectEscapedTitle(html: string, name: string) {
  expect(html).not.toContain("<script>alert(1)</script>")
  expect(html).toContain(`<title>${escapeHtml(`Pastebin Worker / ${name} / ${evil}`)}</title>`)
}

test("display page escapes the uploaded filename, with and without SSR", async () => {
  const ctx = createExecutionContext()
  // encrypted: no SSR, the page is the static template with the name filled in
  const encrypted = (
    await upload(ctx, { c: { content: new Blob(["x"]), filename: evil }, "encryption-scheme": "AES-GCM" })
  ).url
  expectEscapedTitle(await displayPage(ctx, encrypted), new URL(encrypted).pathname.slice(1))
  // large: no SSR either
  const large = (await upload(ctx, { c: { content: new Blob(["x".repeat(1024 * 1024 + 1)]), filename: evil } })).url
  expectEscapedTitle(await displayPage(ctx, large), new URL(large).pathname.slice(1))
  // plain: SSR
  const plain = (await upload(ctx, { c: { content: new Blob(["x"]), filename: evil } })).url
  expectEscapedTitle(await displayPage(ctx, plain), new URL(plain).pathname.slice(1))
})

test("display page escapes the filename in the URL, with and without SSR", async () => {
  const ctx = createExecutionContext()
  const cases: Parameters<typeof upload>[1][] = [{ c: "x", "encryption-scheme": "AES-GCM" }, { c: "x" }]
  for (const options of cases) {
    const url = (await upload(ctx, options)).url
    const name = new URL(url).pathname.slice(1)
    expectEscapedTitle(await displayPage(ctx, `${url}/${encodeURIComponent(evil)}`), name)
    // an extension stays percent-encoded, so it cannot carry markup
    const withExt = await displayPage(ctx, `${url}.%3Cb%3E`)
    expect(withExt).toContain(`<title>Pastebin Worker / ${name}.%3Cb%3E</title>`)
    expect(withExt).not.toContain("<b>")
  }
})
