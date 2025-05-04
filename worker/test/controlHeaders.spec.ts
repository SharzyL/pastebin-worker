import { createExecutionContext, env } from "cloudflare:test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { BASE_URL, genRandomBlob, upload, workerFetch } from "./testUtils"

test("mime type", async () => {
  const ctx = createExecutionContext()
  const url = (await upload(ctx, { c: genRandomBlob(1024) })).url

  const url_pic = (await upload(ctx, { c: { content: genRandomBlob(1024), filename: "xx.jpg" } })).url

  async function testMime(accessUrl: string, mime: string) {
    const resp = await workerFetch(ctx, accessUrl)
    expect(resp.headers.get("Content-Type")).toStrictEqual(mime)
  }

  await testMime(url, "text/plain;charset=UTF-8")
  await testMime(`${url}.jpg`, "image/jpeg")
  await testMime(`${url}/test.jpg`, "image/jpeg")
  await testMime(`${url}?mime=random-mime`, "random-mime")
  await testMime(`${url}.jpg?mime=random-mime`, "random-mime")
  await testMime(`${url}/test.jpg?mime=random-mime`, "random-mime")

  await testMime(url_pic, "image/jpeg")
  await testMime(`${url_pic}.png`, "image/png")

  // test disallowed mimetypes
  await testMime(`${url_pic}.html`, "text/plain;charset=UTF-8")
  await testMime(`${url_pic}?mime=text/html`, "text/plain;charset=UTF-8")
})

test("cache control", async () => {
  beforeEach(vi.useFakeTimers)
  afterEach(vi.useRealTimers)
  const t1 = new Date(2035, 0, 0)
  vi.setSystemTime(t1)

  const ctx = createExecutionContext()
  const uploadResp = await upload(ctx, { c: genRandomBlob(1024) })
  const url = uploadResp["url"]
  const resp = await workerFetch(ctx, url)
  expect(resp.headers.has("Last-Modified")).toStrictEqual(true)
  expect(new Date(resp.headers.get("Last-Modified")!).getTime()).toStrictEqual(t1.getTime())

  if ("CACHE_PASTE_AGE" in env) {
    expect(resp.headers.get("Cache-Control")).toStrictEqual(`public, max-age=${env.CACHE_PASTE_AGE}`)
  } else {
    expect(resp.headers.get("Cache-Control")).toBeUndefined()
  }

  const indexResp = await workerFetch(ctx, BASE_URL)
  if ("CACHE_STATIC_PAGE_AGE" in env) {
    expect(indexResp.headers.get("Cache-Control")).toStrictEqual(`public, max-age=${env.CACHE_STATIC_PAGE_AGE}`)
  } else {
    expect(indexResp.headers.get("Cache-Control")).toBeUndefined()
  }

  const t2 = new Date(2035, 0, 1)
  const staleResp = await workerFetch(
    ctx,
    new Request(url, {
      headers: {
        "If-Modified-Since": t2.toUTCString(),
      },
    }),
  )
  expect(staleResp.status).toStrictEqual(304)
})

test("content disposition without specifying filename", async () => {
  const content = "hello" // not using Blob here, since FormData.append() automatically add filename for Blob
  const filename = "hello.jpg"
  const ctx = createExecutionContext()

  const uploadResp = await upload(ctx, { c: content })
  const url = uploadResp["url"]

  expect(
    (await workerFetch(ctx, url)).headers.get("Access-Control-Expose-Headers")?.includes("Content-Disposition"),
  ).toStrictEqual(true)
  expect((await workerFetch(ctx, url)).headers.get("Content-Disposition")).toStrictEqual("inline")
  expect((await workerFetch(ctx, `${url}?a`)).headers.get("Content-Disposition")).toStrictEqual("attachment")

  expect((await workerFetch(ctx, `${url}/${filename}`)).headers.get("Content-Disposition")).toStrictEqual(
    `inline; filename*=UTF-8''${filename}`,
  )
  expect((await workerFetch(ctx, `${url}/${filename}?a`)).headers.get("Content-Disposition")).toStrictEqual(
    `attachment; filename*=UTF-8''${filename}`,
  )
})

test("content disposition with specifying filename", async () => {
  const content = genRandomBlob(1024)
  const filename = "りんご たいへん.jpg"
  const filenameEncoded = encodeURIComponent(filename)
  const altFilename = "التفاح"
  const altFilenameEncoded = encodeURIComponent(altFilename)

  const ctx = createExecutionContext()

  const uploadResp = await upload(ctx, { c: { content, filename } })
  const url = uploadResp.url

  expect((await workerFetch(ctx, url)).headers.get("Content-Disposition")).toStrictEqual(
    `inline; filename*=UTF-8''${filenameEncoded}`,
  )
  expect((await workerFetch(ctx, `${url}?a`)).headers.get("Content-Disposition")).toStrictEqual(
    `attachment; filename*=UTF-8''${filenameEncoded}`,
  )

  expect((await workerFetch(ctx, `${url}/${altFilename}`)).headers.get("Content-Disposition")).toStrictEqual(
    `inline; filename*=UTF-8''${altFilenameEncoded}`,
  )
  expect((await workerFetch(ctx, `${url}/${altFilename}?a`)).headers.get("Content-Disposition")).toStrictEqual(
    `attachment; filename*=UTF-8''${altFilenameEncoded}`,
  )
})

test("other HTTP methods", async () => {
  const ctx = createExecutionContext()
  const resp = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "PATCH",
    }),
  )
  expect(resp.status).toStrictEqual(405)
  expect(resp.headers.has("Allow")).toStrictEqual(true)
})

test("option method", async () => {
  const ctx = createExecutionContext()

  const resp = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "PUT",
      },
    }),
  )
  expect(resp.status).toStrictEqual(200)
  expect(resp.headers.has("Access-Control-Allow-Origin")).toStrictEqual(true)
  expect(resp.headers.has("Access-Control-Allow-Methods")).toStrictEqual(true)
  expect(resp.headers.has("Access-Control-Max-Age")).toStrictEqual(true)

  const resp1 = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
      },
    }),
  )
  expect(resp1.status).toStrictEqual(200)
  expect(resp1.headers.has("Allow")).toStrictEqual(true)
})
