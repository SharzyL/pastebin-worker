import { describe, expect, it } from "vitest"
import { createExecutionContext } from "cloudflare:test"

import { BASE_URL, workerFetch } from "./testUtils.js"

const curlHeaders = { "User-Agent": "curl/8.0.0" }
const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

describe("doc pages", () => {
  const ctx = createExecutionContext()

  it("returns rendered HTML to browsers", async () => {
    for (const page of ["/doc/api", "/doc/tos", "/doc/curl"]) {
      const resp = await workerFetch(ctx, new Request(`${BASE_URL}${page}`, { headers: browserHeaders }))
      expect(resp.status, `visiting ${page}`).toStrictEqual(200)
      expect(resp.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
      const body = await resp.text()
      expect(body.startsWith("<!DOCTYPE html>"), `body of ${page} should be HTML`).toStrictEqual(true)
    }
  })

  it("returns raw markdown to curl", async () => {
    for (const page of ["/doc/api", "/doc/tos", "/doc/curl"]) {
      const resp = await workerFetch(ctx, new Request(`${BASE_URL}${page}`, { headers: curlHeaders }))
      expect(resp.status, `visiting ${page}`).toStrictEqual(200)
      expect(resp.headers.get("Content-Type")).toStrictEqual("text/plain;charset=UTF-8")
      expect(resp.headers.get("Vary")).toStrictEqual("User-Agent")
      const body = await resp.text()
      expect(body.startsWith("<!DOCTYPE html>"), `body of ${page} should be markdown`).toStrictEqual(false)
    }
  })

  it("returns 404 for unknown doc paths", async () => {
    for (const page of ["/doc", "/doc/", "/doc/missing", "/doc/cli"]) {
      const resp = await workerFetch(ctx, `${BASE_URL}${page}`)
      expect(resp.status, `visiting ${page}`).toStrictEqual(404)
      expect(await resp.text(), `visiting ${page}`).toContain("doc page")
    }
  })

  it("expands {{BASE_URL}} in doc bodies", async () => {
    const resp = await workerFetch(ctx, new Request(`${BASE_URL}/doc/curl`, { headers: curlHeaders }))
    const body = await resp.text()
    expect(body.includes("{{BASE_URL}}"), "template should be expanded").toStrictEqual(false)
    expect(body.includes(BASE_URL), "should contain DEPLOY_URL").toStrictEqual(true)
  })

  it("serves doc/index.md as markdown to curl on /", async () => {
    const resp = await workerFetch(ctx, new Request(BASE_URL, { headers: curlHeaders }))
    expect(resp.status).toStrictEqual(200)
    expect(resp.headers.get("Content-Type")).toStrictEqual("text/plain;charset=UTF-8")
    expect(resp.headers.get("Vary")).toStrictEqual("User-Agent")
    const body = await resp.text()
    expect(body.includes("# Pastebin Worker"), "body should contain index heading").toStrictEqual(true)
    expect(body.includes("{{BASE_URL}}"), "template should be expanded").toStrictEqual(false)
  })

  it("serves the SPA to browsers on /", async () => {
    const resp = await workerFetch(ctx, new Request(BASE_URL, { headers: browserHeaders }))
    expect(resp.status).toStrictEqual(200)
    expect(resp.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
  })
})
