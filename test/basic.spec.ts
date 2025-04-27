import { test, expect } from "vitest"

import { genRandStr } from "../src/common"

import {
  genRandomBlob,
  areBlobsEqual,
  createFormData,
  workerFetch,
  upload,
  BASE_URL,
  RAND_NAME_REGEX,
  uploadExpectStatus,
} from "./testUtils.js"
import { createExecutionContext } from "cloudflare:test"
import {
  DEFAULT_PASSWD_LEN,
  MAX_PASSWD_LEN,
  MIN_PASSWD_LEN,
  PASTE_NAME_LEN,
  PasteResponse,
  PRIVATE_PASTE_NAME_LEN,
} from "../src/shared"

test("basic", async () => {
  const blob1 = genRandomBlob(1024)
  const blob2 = new Blob(["hello"])
  const ctx = createExecutionContext()

  // upload
  const uploadResponse = await workerFetch(
    ctx,
    new Request(`${BASE_URL}`, {
      method: "POST",
      body: createFormData({ c: blob1 }),
    }),
  )
  expect(uploadResponse.status).toStrictEqual(200)
  const responseJson = JSON.parse(await uploadResponse.text()) as PasteResponse

  // check url
  const url: string = responseJson["url"]
  expect(url.startsWith(BASE_URL))

  // check name
  const name: string = url.slice(BASE_URL.length + 1)
  expect(name.length).toStrictEqual(PASTE_NAME_LEN)
  expect(RAND_NAME_REGEX.test(name))

  // check manageUrl
  const manageUrl: string = responseJson["manageUrl"]
  expect(manageUrl).toBeDefined()
  expect(manageUrl.startsWith(BASE_URL))
  expect(manageUrl.slice(BASE_URL.length + 1, manageUrl.lastIndexOf(":"))).toStrictEqual(name)

  // check passwd
  const passwd = manageUrl.slice(manageUrl.lastIndexOf(":") + 1)
  expect(passwd.length).toStrictEqual(DEFAULT_PASSWD_LEN)

  // check revisit
  const revisitSesponse = await workerFetch(ctx, url)
  expect(revisitSesponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitSesponse.blob(), blob1)).toBeTruthy()

  // check 404
  let newName
  do {
    newName = genRandStr(PASTE_NAME_LEN)
  } while (newName === name) // roll until finding a different name
  const missingResponse = await workerFetch(ctx, new Request(`${BASE_URL}/${newName}`))
  expect(missingResponse.status).toStrictEqual(404)

  // check modify with wrong manageUrl
  let wrongPasswd
  do {
    wrongPasswd = genRandStr(DEFAULT_PASSWD_LEN)
  } while (wrongPasswd === passwd)
  expect(
    (
      await workerFetch(
        ctx,
        new Request(`${url}:${wrongPasswd}`, {
          method: "PUT",
          body: createFormData({ c: blob2 }),
        }),
      )
    ).status,
  ).toStrictEqual(403)

  // check modify
  const putResponse = await workerFetch(
    ctx,
    new Request(manageUrl, {
      method: "PUT",
      body: createFormData({ c: blob2 }),
    }),
  )
  expect(putResponse.status).toStrictEqual(200)
  const putResponseJson = JSON.parse(await putResponse.text()) as PasteResponse
  expect(putResponseJson["url"]).toStrictEqual(url)
  expect(putResponseJson["manageUrl"]).toStrictEqual(manageUrl)

  // check visit modified
  const revisitModifiedResponse = await workerFetch(ctx, url)
  expect(revisitModifiedResponse.status).toStrictEqual(200)
  const revisitBlob = await revisitModifiedResponse.blob()
  expect(await areBlobsEqual(revisitBlob, blob2)).toBeTruthy()

  // check delete with wrong manageUrl
  expect(
    (
      await workerFetch(
        ctx,
        new Request(`${url}:${wrongPasswd}`, {
          method: "DELETE",
        }),
      )
    ).status,
  ).toStrictEqual(403)

  // check delete
  const deleteResponse = await workerFetch(ctx, new Request(manageUrl, { method: "DELETE" }))
  expect(deleteResponse.status).toStrictEqual(200)

  // check visit modified
  const revisitDeletedResponse = await workerFetch(ctx, url)
  expect(revisitDeletedResponse.status).toStrictEqual(404)
})

test("upload long", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // upload
  const uploadResponse = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "POST",
      body: createFormData({ c: blob1, p: "1" }),
    }),
  )
  expect(uploadResponse.status).toStrictEqual(200)
  const responseJson = JSON.parse(await uploadResponse.text()) as PasteResponse

  // check url
  const url = responseJson["url"]
  expect(url.startsWith(BASE_URL))

  // check name
  const name = url.slice(BASE_URL.length + 1)
  expect(name.length).toStrictEqual(PRIVATE_PASTE_NAME_LEN)
  expect(RAND_NAME_REGEX.test(name))

  // check revisit
  const revisitSesponse = await workerFetch(ctx, url)
  expect(revisitSesponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitSesponse.blob(), blob1)).toBeTruthy()
})

test("expire", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()
  async function testExpireParse(expire: string, expireSecs: number | null) {
    const responseJson = await upload(ctx, { c: blob1, e: expire })
    expect(responseJson["expirationSeconds"]).toStrictEqual(expireSecs)
  }

  await testExpireParse("1000", 1000)
  await testExpireParse("100m", 6000)
  await testExpireParse("100h", 360000)
  await testExpireParse("1d", 86400)
  await testExpireParse("100d", 2592000) // longer expiration will be clipped to 30d
  await testExpireParse("100  m", 6000)
  await testExpireParse("", 604800)

  const testFailParse = async (expire: string) => {
    const uploadResponse = await workerFetch(
      ctx,
      new Request(BASE_URL, {
        method: "POST",
        body: createFormData({ c: blob1, e: expire }),
      }),
    )
    expect(uploadResponse.status).toStrictEqual(400)
  }

  await testFailParse("abc")
  await testFailParse("1c")
  await testFailParse("-100m")
})

test("custom path", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check bad names
  const badNames = ["a", "ab", "..."]
  for (const name of badNames) {
    const uploadResponse = await workerFetch(
      ctx,
      new Request(BASE_URL, {
        method: "POST",
        body: createFormData({ c: blob1, n: name }),
      }),
    )
    expect(uploadResponse.status).toStrictEqual(400)
  }

  // check good name upload
  const goodName = "goodName123+_-[]*$@,;"
  const uploadResponseJson = await upload(ctx, {
    c: blob1,
    n: goodName,
  })
  expect(uploadResponseJson["url"]).toStrictEqual(`${BASE_URL}/~${goodName}`)

  // check revisit
  const revisitResponse = await workerFetch(ctx, uploadResponseJson["url"])
  expect(revisitResponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitResponse.blob(), blob1)).toBeTruthy()
})

test("custom passwd", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check good name upload
  const passwd = "1366eaa20c071763dc94"
  const wrongPasswd = "7365ca6eac619ca3f118"
  const uploadResponseJson = await upload(ctx, {
    c: blob1,
    s: passwd,
  })
  const url = uploadResponseJson["url"]
  const manageUrl = uploadResponseJson["manageUrl"]
  const parsedPasswd = manageUrl.slice(manageUrl.lastIndexOf(":") + 1)
  expect(parsedPasswd).toStrictEqual(passwd)

  // check password format verification
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MIN_PASSWD_LEN - 1) }, 400)
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MIN_PASSWD_LEN) + "\n" }, 400)
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MAX_PASSWD_LEN + 1) }, 400)

  // check modify with wrong manageUrl
  expect(
    (
      await workerFetch(
        ctx,
        new Request(`${url}:${wrongPasswd}`, {
          method: "PUT",
          body: createFormData({ c: blob1 }),
        }),
      )
    ).status,
  ).toStrictEqual(403)

  // check modify
  const putResponse = await workerFetch(
    ctx,
    new Request(manageUrl, {
      method: "PUT",
      body: createFormData({ c: blob1, s: wrongPasswd }),
    }),
  )
  expect(putResponse.status).toStrictEqual(200)
  const putResponseJson = JSON.parse(await putResponse.text()) as PasteResponse
  expect(putResponseJson["url"]).toStrictEqual(url) // url will not change
  expect(putResponseJson["manageUrl"]).toStrictEqual(`${url}:${wrongPasswd}`) // passwd may change
})

// TODO: add tests for CORS
