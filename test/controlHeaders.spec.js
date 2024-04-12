import { env } from "cloudflare:test"
import { expect, test } from "vitest"

import { BASE_URL, randomBlob, upload, workerFetch } from "./testUtils.js"

test("mime type", async () => {
  const url = (await upload(({ "c": randomBlob(1024) })))["url"]

  async function testMime(accessUrl, mime) {
    const resp = await workerFetch(accessUrl)
    expect(resp.headers.get("Content-Type")).toStrictEqual(mime)
  }

  await testMime(url, "text/plain;charset=UTF-8")
  await testMime(`${url}.jpg`, "image/jpeg;charset=UTF-8")
  await testMime(`${url}/test.jpg`, "image/jpeg;charset=UTF-8")
  await testMime(`${url}?mime=random-mime`, "random-mime;charset=UTF-8")
  await testMime(`${url}.jpg?mime=random-mime`, "random-mime;charset=UTF-8")
  await testMime(`${url}/test.jpg?mime=random-mime`, "random-mime;charset=UTF-8")
})

test("cache control", async () => {
  const uploadResp = await upload(({ "c": randomBlob(1024) }))
  const url = uploadResp["url"]
  const resp = await workerFetch(url)
  if ("CACHE_PASTE_AGE" in env) {
    expect(resp.headers.get("Cache-Control")).toStrictEqual(`public, max-age=${env.CACHE_PASTE_AGE}`)
  } else {
    expect(resp.headers.get("Cache-Control")).toBeUndefined()
  }

  const indexResp = await workerFetch(BASE_URL)
  if ("CACHE_STATIC_PAGE_AGE" in env) {
    expect(indexResp.headers.get("Cache-Control")).toStrictEqual(`public, max-age=${env.CACHE_STATIC_PAGE_AGE}`)
  } else {
    expect(indexResp.headers.get("Cache-Control")).toBeUndefined()
  }

  const staleResp = await workerFetch(url, {
    headers: {
      "If-Modified-Since": "Mon, 11 Mar 2030 00:00:00 GMT",
    },
  })
  expect(staleResp.status).toStrictEqual(304)
})

test("content disposition without specifying filename", async () => {
  const content = "hello"  // not using Blob here, since FormData.append() automatically add filename for Blob
  const filename = "hello.jpg"

  const uploadResp = await upload({ "c": content })
  const url = uploadResp["url"]

  expect((await workerFetch(url)).headers.get("Content-Disposition"))
    .toStrictEqual("inline")
  expect((await workerFetch(`${url}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual("attachment")

  expect((await workerFetch(`${url}/${filename}`)).headers.get("Content-Disposition"))
    .toStrictEqual(`inline; filename*=UTF-8''${filename}`)
  expect((await workerFetch(`${url}/${filename}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual(`attachment; filename*=UTF-8''${filename}`)
})

test("content disposition with specifying filename", async () => {
  const content = randomBlob(1024)
  const filename = "hello.jpg"
  const altFilename = "world.txt"

  const uploadResp = await upload({ "c": { value: content, filename: filename } })
  const url = uploadResp["url"]

  expect(uploadResp["suggestUrl"]).toStrictEqual(`${url}/${filename}`)

  expect((await workerFetch(url)).headers.get("Content-Disposition"))
    .toStrictEqual(`inline; filename*=UTF-8''${filename}`)
  expect((await workerFetch(`${url}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual(`attachment; filename*=UTF-8''${filename}`)

  expect((await workerFetch(`${url}/${altFilename}`)).headers.get("Content-Disposition"))
    .toStrictEqual(`inline; filename*=UTF-8''${altFilename}`)
  expect((await workerFetch(`${url}/${altFilename}?a`)).headers.get("Content-Disposition"))
    .toStrictEqual(`attachment; filename*=UTF-8''${altFilename}`)
})

