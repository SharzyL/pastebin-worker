import { createExecutionContext, env } from "cloudflare:test"
import { expect, test } from "vitest"

import { BASE_URL, genRandomBlob, upload, workerFetch } from "./testUtils.js"

test("mime type", async () => {
  const ctx = createExecutionContext()
  const url = (await upload(ctx, { c: genRandomBlob(1024) }))["url"]

  const url_pic = (
    await upload(ctx, {
      c: { content: genRandomBlob(1024), filename: "xx.jpg" },
    })
  )["url"]

  async function testMime(accessUrl: string, mime: string) {
    const resp = await workerFetch(ctx, accessUrl)
    expect(resp.headers.get("Content-Type")).toStrictEqual(mime)
  }

  await testMime(url, "text/plain;charset=UTF-8")
  await testMime(`${url}.jpg`, "image/jpeg;charset=UTF-8")
  await testMime(`${url}/test.jpg`, "image/jpeg;charset=UTF-8")
  await testMime(`${url}?mime=random-mime`, "random-mime;charset=UTF-8")
  await testMime(`${url}.jpg?mime=random-mime`, "random-mime;charset=UTF-8")
  await testMime(`${url}/test.jpg?mime=random-mime`, "random-mime;charset=UTF-8")

  await testMime(url_pic, "image/jpeg;charset=UTF-8")
  await testMime(`${url_pic}.png`, "image/png;charset=UTF-8")
})

test("cache control", async () => {
  const ctx = createExecutionContext()
  const uploadResp = await upload(ctx, { c: genRandomBlob(1024) })
  const url = uploadResp["url"]
  const resp = await workerFetch(ctx, url)
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

  const staleResp = await workerFetch(
    ctx,
    new Request(url, {
      headers: {
        "If-Modified-Since": "Mon, 11 Mar 2030 00:00:00 GMT",
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
  const filename = "hello.jpg"
  const altFilename = "world.txt"
  const ctx = createExecutionContext()

  const uploadResp = await upload(ctx, { c: { content, filename } })
  const url = uploadResp["url"]

  expect(uploadResp["suggestedUrl"]).toStrictEqual(`${url}/${filename}`)

  expect((await workerFetch(ctx, url)).headers.get("Content-Disposition")).toStrictEqual(
    `inline; filename*=UTF-8''${filename}`,
  )
  expect((await workerFetch(ctx, `${url}?a`)).headers.get("Content-Disposition")).toStrictEqual(
    `attachment; filename*=UTF-8''${filename}`,
  )

  expect((await workerFetch(ctx, `${url}/${altFilename}`)).headers.get("Content-Disposition")).toStrictEqual(
    `inline; filename*=UTF-8''${altFilename}`,
  )
  expect((await workerFetch(ctx, `${url}/${altFilename}?a`)).headers.get("Content-Disposition")).toStrictEqual(
    `attachment; filename*=UTF-8''${altFilename}`,
  )
})
