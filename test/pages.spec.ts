import { expect, test } from "vitest"
import { BASE_URL, staticPages, upload, workerFetch } from "./testUtils.js"
import { createExecutionContext } from "cloudflare:test"

test("static pages", async () => {
  const ctx = createExecutionContext()
  for (const page of staticPages) {
    expect((await workerFetch(ctx, `${BASE_URL}/${page}`)).status).toStrictEqual(200)
  }
})

test("markdown", async () => {
  const testMd = `# Hello` // TODO: use a stronger test file
  const ctx = createExecutionContext()
  const url = (await upload(ctx, { c: testMd }))["url"]

  function makeMarkdownUrl(url: string): string {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/a" + url.slice(splitPoint)
  }

  const revisitResponse = await workerFetch(ctx, makeMarkdownUrl(url))
  expect(revisitResponse.status).toStrictEqual(200)
  expect(revisitResponse.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
  const responseHtml = await revisitResponse.text()
  expect(responseHtml.indexOf("<title>Hello</title>")).toBeGreaterThan(-1)
  expect(responseHtml.indexOf("<h1>Hello</h1>")).toBeGreaterThan(-1)
})

test("url redirect", async () => {
  const contentUrl = "https://example.com:1234/abc-def?g=hi&jk=l"
  const ctx = createExecutionContext()
  const uploadResp = await upload(ctx, { c: contentUrl })
  const url = uploadResp["url"]

  function makeRedirectUrl(url: string): string {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/u" + url.slice(splitPoint)
  }

  expect(uploadResp["suggestedUrl"].includes(makeRedirectUrl(url)))

  const resp = await workerFetch(ctx, makeRedirectUrl(url))
  expect(resp.status).toStrictEqual(302)
  expect(resp.headers.get("location")).toStrictEqual(contentUrl)
})

test("url redirect with illegal url", async () => {
  const ctx = createExecutionContext()
  const contentUrl = "xxxx"
  const uploadResp = await upload(ctx, { c: contentUrl })
  const url = uploadResp["url"]

  function makeRedirectUrl(url: string): string {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/u" + url.slice(splitPoint)
  }

  expect(uploadResp["suggestedUrl"]).toBeUndefined()

  const resp = await workerFetch(ctx, makeRedirectUrl(url))
  expect(resp.status).toStrictEqual(400)
})

test("highlight", async () => {
  const content = 'print("hello world")'
  const ctx = createExecutionContext()
  const url = (await upload(ctx, { c: content }))["url"]
  const resp = await workerFetch(ctx, `${url}?lang=html`)
  expect(resp.status).toStrictEqual(200)
  const body = await resp.text()
  expect(body.includes("language-html")).toBeTruthy()
  expect(body.includes(content)).toBeTruthy()
})
