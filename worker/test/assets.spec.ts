import { test, expect, describe } from "vitest"
import { workerFetch, upload, BASE_URL } from "./testUtils.js"
import { createExecutionContext, env } from "cloudflare:test"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"

// A page asks for every chunk its entry imports up front, in the head and in
// the Link header, instead of leaving the browser to discover them one import
// level at a time.
function expectPreloads(resp: Response, html: string, entry: keyof typeof manifest) {
  const { preloadPaths, cssPaths } = manifest[entry]
  expect(preloadPaths.length).toBeGreaterThan(0)
  const link = resp.headers.get("Link")!
  expect(link).not.toBeNull()
  for (const p of preloadPaths) {
    expect(html).toContain(`<link rel="modulepreload" href="/${p}">`)
    expect(link).toContain(`</${p}>; rel=modulepreload`)
  }
  for (const p of cssPaths) {
    expect(link).toContain(`</${p}>; rel=preload; as=style`)
  }
}

describe("asset hints", () => {
  const ctx = createExecutionContext()

  test("index page", async () => {
    const resp = await workerFetch(ctx, BASE_URL)
    expectPreloads(resp, await resp.text(), "index.html")
  })

  test("display page", async () => {
    const name = new URL((await upload(ctx, { c: "hello" })).url).pathname.slice(1)
    const resp = await workerFetch(ctx, `${BASE_URL}/d/${name}`)
    expectPreloads(resp, await resp.text(), "display.html")
  })
})

describe("asset caching", () => {
  const ctx = createExecutionContext()

  test("a hashed bundle is immutable and answers conditional requests", async () => {
    const url = `${BASE_URL}/${manifest["index.html"].jsFile}`
    const resp = await workerFetch(ctx, url)
    expect(resp.status).toBe(200)
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
    expect(resp.headers.get("Content-Type")).toBe("text/javascript;charset=UTF-8")
    const etag = resp.headers.get("ETag")
    expect(etag).not.toBeNull()
    expect((await resp.text()).length).toBeGreaterThan(0)

    const again = await workerFetch(ctx, new Request(url, { headers: { "If-None-Match": etag! } }))
    expect(again.status).toBe(304)
  })

  test("the favicon keeps the static page age", async () => {
    const resp = await workerFetch(ctx, `${BASE_URL}/favicon.ico`)
    expect(resp.status).toBe(200)
    expect(resp.headers.get("Cache-Control")).toBe(`public, max-age=${env.CACHE_STATIC_PAGE_AGE}`)
  })

  test("a missing asset is a 404", async () => {
    const resp = await workerFetch(ctx, `${BASE_URL}/assets/nope.js`)
    expect(resp.status).toBe(404)
  })
})
