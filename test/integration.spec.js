import { env } from "cloudflare:test"
import { test, expect } from "vitest"

import { params, genRandStr } from "../src/common.js"
import {
  randomBlob, areBlobsEqual, createFormData, workerFetch, upload,
  BASE_URL, RAND_NAME_REGEX, staticPages,
} from "./testUtils.js"

test("static page", async () => {
  for (const page of staticPages) {
    expect((await workerFetch(`${BASE_URL}/${page}`)).status).toStrictEqual(200)
  }
})

test("basic", async () => {
  const blob1 = randomBlob(1024)
  const blob2 = randomBlob(1024)

  // upload
  const uploadResponse = await workerFetch(new Request(`${BASE_URL}`, {
    method: "POST",
    body: createFormData({ "c": blob1 }),
  }))
  expect(uploadResponse.status).toStrictEqual(200)
  const responseJson = JSON.parse(await uploadResponse.text())

  // check url
  const url = responseJson["url"]
  expect(url.startsWith(BASE_URL))

  // check name
  const name = url.slice(BASE_URL.length + 1)
  expect(name.length).toStrictEqual(params.RAND_LEN)
  expect(RAND_NAME_REGEX.test(name))

  // check admin
  const admin = responseJson["admin"]
  expect(admin.startsWith(BASE_URL))
  expect(admin.slice(BASE_URL.length + 1, admin.lastIndexOf(":"))).toStrictEqual(name)

  // check passwd
  const passwd = admin.slice(admin.lastIndexOf(":") + 1)
  expect(passwd.length).toStrictEqual(params.ADMIN_PATH_LEN)

  // check revisit
  const revisitSesponse = await workerFetch(url)
  expect(revisitSesponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitSesponse.blob(), blob1)).toBeTruthy()

  // check 404
  let newName
  do {
    newName = genRandStr(params.RAND_LEN)
  } while (newName === name)  // roll until finding a different name
  const missingResponse = await workerFetch(new Request(`${BASE_URL}/${newName}`))
  expect(missingResponse.status).toStrictEqual(404)

  // check modify with wrong admin
  let wrongPasswd
  do {
    wrongPasswd = genRandStr(params.ADMIN_PATH_LEN)
  } while (wrongPasswd === passwd)
  expect((await workerFetch(`${url}:${wrongPasswd}`, {
    method: "PUT",
    body: createFormData({ "c": blob2 }),
  })).status).toStrictEqual(403)

  // check modify
  const putResponse = await workerFetch(new Request(admin, {
    method: "PUT",
    body: createFormData({ "c": blob2 }),
  }))
  expect(putResponse.status).toStrictEqual(200)
  const putResponseJson = JSON.parse(await putResponse.text())
  expect(putResponseJson["url"]).toStrictEqual(url)
  expect(putResponseJson["admin"]).toStrictEqual(admin)

  // check visit modified
  const revisitModifiedResponse = await workerFetch(url)
  expect(revisitModifiedResponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitModifiedResponse.blob(), blob2)).toBeTruthy()

  // check delete with wrong admin
  expect((await workerFetch(new Request(`${url}:${wrongPasswd}`, {
      method: "DELETE",
    },
  ))).status).toStrictEqual(403)

  // check delete
  const deleteResponse = await workerFetch(new Request(admin, { method: "DELETE" }))
  expect(deleteResponse.status).toStrictEqual(200)

  // check visit modified
  const revisitDeletedResponse = await workerFetch(url)
  expect(revisitDeletedResponse.status).toStrictEqual(404)
})

test("upload long", async () => {
  const blob1 = randomBlob(1024)

  // upload
  const uploadResponse = await workerFetch(new Request(BASE_URL, {
    method: "POST",
    body: createFormData({ "c": blob1, "p": 1 }),
  }))
  expect(uploadResponse.status).toStrictEqual(200)
  const responseJson = JSON.parse(await uploadResponse.text())

  // check url
  const url = responseJson["url"]
  expect(url.startsWith(BASE_URL))

  // check name
  const name = url.slice(BASE_URL.length + 1)
  expect(name.length).toStrictEqual(params.PRIVATE_RAND_LEN)
  expect(RAND_NAME_REGEX.test(name))

  // check revisit
  const revisitSesponse = await workerFetch(url)
  expect(revisitSesponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitSesponse.blob(), blob1)).toBeTruthy()
})

test("expire", async () => {
  const blob1 = randomBlob(1024)

  async function testExpireParse(expire, expireSecs) {
    const responseJson = await upload({ "c": blob1, "e": expire })
    expect(responseJson["expire"]).toStrictEqual(expireSecs)
  }

  await testExpireParse("1000", 1000)
  await testExpireParse("100m", 6000)
  await testExpireParse("100h", 360000)
  await testExpireParse("1d", 86400)
  await testExpireParse("1M", 18144000)
  await testExpireParse("100  m", 6000)

  const testFailParse = async (expire) => {
    const uploadResponse = await workerFetch(new Request(BASE_URL, {
      method: "POST",
      body: createFormData({ "c": blob1, "e": expire }),
    }))
    expect(uploadResponse.status).toStrictEqual(400)
  }

  await testFailParse("abc")
  await testFailParse("1c")
  await testFailParse("-100m")
})

test("markdown", async () => {
  const testMd = `# Hello`  // TODO: use a stronger test file
  const url = (await upload({ "c": testMd }))["url"]

  function makeMarkdownUrl(url) {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/a" + url.slice(splitPoint)
  }

  const revisitResponse = await workerFetch(makeMarkdownUrl(url))
  expect(revisitResponse.status).toStrictEqual(200)
  expect(revisitResponse.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
  const responseHtml = await revisitResponse.text()
  expect(responseHtml.indexOf("<title>Hello</title>")).toBeGreaterThan(-1)
  expect(responseHtml.indexOf("<h1>Hello</h1>")).toBeGreaterThan(-1)
})

test("custom path", async () => {
  const blob1 = randomBlob(1024)

  // check bad names
  const badNames = ["a", "ab", "..."]
  for (const name of badNames) {
    const uploadResponse = await workerFetch(new Request(BASE_URL, {
      method: "POST",
      body: createFormData({ "c": blob1, "n": name }),
    }))
    expect(uploadResponse.status).toStrictEqual(400)
  }

  // check good name upload
  const goodName = "goodName123+_-[]*$@,;"
  const uploadResponseJson = await upload({
    "c": blob1,
    "n": goodName,
  })
  expect(uploadResponseJson["url"]).toStrictEqual(`${BASE_URL}/~${goodName}`)

  // check revisit
  const revisitResponse = await workerFetch(uploadResponseJson["url"])
  expect(revisitResponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitResponse.blob(), blob1)).toBeTruthy()
})

test("custom passwd", async () => {
  const blob1 = randomBlob(1024)

  // check good name upload
  const passwd = genRandStr(30)
  const uploadResponseJson = await upload({
    "c": blob1,
    "s": passwd,
  })
  const url = uploadResponseJson["url"]
  const admin = uploadResponseJson["admin"]
  const parsedPasswd = admin.slice(admin.lastIndexOf(":") + 1)
  expect(parsedPasswd).toStrictEqual(passwd)

  // check modify with wrong admin
  let wrongPasswd
  do {
    wrongPasswd = genRandStr(params.ADMIN_PATH_LEN)
  } while (wrongPasswd === passwd)
  expect((await workerFetch(`${url}:${wrongPasswd}`, {
    method: "PUT",
    body: createFormData({ "c": blob1 }),
  })).status).toStrictEqual(403)

  // check modify
  const putResponse = await workerFetch(new Request(admin, {
    method: "PUT",
    body: createFormData({ "c": blob1, "s": wrongPasswd }),
  }))
  expect(putResponse.status).toStrictEqual(200)
  const putResponseJson = JSON.parse(await putResponse.text())
  expect(putResponseJson["url"]).toStrictEqual(url)  // url will not change
  expect(putResponseJson["admin"]).toStrictEqual(`${url}:${wrongPasswd}`)  // passwd may change
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

test("url redirect", async () => {
  const contentUrl = "https://example.com:1234/abc-def?g=hi&jk=l"
  const uploadResp = await upload({ "c": contentUrl })
  const url = uploadResp["url"]

  function makeRedirectUrl(url) {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/u" + url.slice(splitPoint)
  }

  expect(uploadResp["suggestUrl"].includes(makeRedirectUrl(url)))

  const resp = await workerFetch(makeRedirectUrl(url))
  expect(resp.status).toStrictEqual(302)
  expect(resp.headers.get("location")).toStrictEqual(contentUrl)
})

test("url redirect with illegal url", async () => {
  const contentUrl = "xxxx"
  const uploadResp = await upload({ "c": contentUrl })
  const url = uploadResp["url"]

  function makeRedirectUrl(url) {
    const splitPoint = url.lastIndexOf("/")
    return url.slice(0, splitPoint) + "/u" + url.slice(splitPoint)
  }

  expect(uploadResp["suggestUrl"]).toBeNull()

  const resp = await workerFetch(makeRedirectUrl(url))
  expect(resp.status).toStrictEqual(400)
})

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

test("highlight", async () => {
  const content = "print(\"hello world\")"
  const url = (await upload(({ "c": content })))["url"]
  const resp = await workerFetch(`${url}?lang=html`)
  expect(resp.status).toStrictEqual(200)
  const body = await resp.text()
  expect(body.includes("language-html")).toBeTruthy()
  expect(body.includes(content)).toBeTruthy()
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

// TODO: add tests for CORS