import { test, it, expect, describe } from "vitest"

import { genRandStr } from "../common"

import {
  genRandomBlob,
  areBlobsEqual,
  workerFetch,
  upload,
  BASE_URL,
  RAND_NAME_REGEX,
  uploadExpectStatus,
  staticPages,
  addRole,
} from "./testUtils"
import { createExecutionContext } from "cloudflare:test"
import { DEFAULT_PASSWD_LEN, PASTE_NAME_LEN } from "../../shared/constants"
import { parsePath } from "../../shared/parsers"

describe("upload", () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  it("should upload", async () => {
    // upload
    const responseJson = await upload(ctx, { c: blob1 })

    // check url
    const url: string = responseJson.url
    expect(url.startsWith(BASE_URL))

    // check name
    const name: string = url.slice(BASE_URL.length + 1)
    expect(name.length).toStrictEqual(PASTE_NAME_LEN)
    expect(RAND_NAME_REGEX.test(name))

    // check manageUrl
    const manageUrl: string = responseJson.manageUrl
    expect(manageUrl).toBeDefined()
    expect(manageUrl.startsWith(BASE_URL))
    expect(manageUrl.slice(BASE_URL.length + 1, manageUrl.lastIndexOf(":"))).toStrictEqual(name)

    // check passwd
    const passwd = manageUrl.slice(manageUrl.lastIndexOf(":") + 1)
    expect(passwd.length).toStrictEqual(DEFAULT_PASSWD_LEN)
  })

  it("should return original paste", async () => {
    const resp = await upload(ctx, { c: blob1 })
    const revisitSesponse = await workerFetch(ctx, resp.url)
    expect(revisitSesponse.status).toStrictEqual(200)
    expect(await areBlobsEqual(await revisitSesponse.blob(), blob1)).toStrictEqual(true)
  })

  it("should return 404 for non-existent", async () => {
    const resp = await upload(ctx, { c: blob1 })
    const name: string = resp.url.slice(BASE_URL.length + 1)
    let newName
    do {
      newName = genRandStr(PASTE_NAME_LEN)
    } while (newName === name) // roll until finding a different name
    const missingResponse = await workerFetch(ctx, new Request(`${BASE_URL}/${newName}`))
    expect(missingResponse.status).toStrictEqual(404)
  })
})

describe("update", () => {
  const blob1 = genRandomBlob(1024)
  const blob2 = new Blob(["hello"])
  const passwd1 = "7365ca6eac619ca3f118"
  const ctx = createExecutionContext()

  it("should disallow modify with wrong manageUrl", async () => {
    const resp = await upload(ctx, { c: blob1 })
    await uploadExpectStatus(ctx, { c: blob2 }, 403, { method: "PUT", url: `${resp.url}:${passwd1}` })
  })

  it("should allow modify with manageUrl", async () => {
    const resp = await upload(ctx, { c: blob1 })

    const putResponseJson = await upload(ctx, { c: blob2 }, { method: "PUT", url: resp.manageUrl })
    expect(putResponseJson.url).toStrictEqual(resp.url)
    expect(putResponseJson.manageUrl).toStrictEqual(resp.manageUrl)

    // check visit modified
    const revisitModifiedResponse = await workerFetch(ctx, resp.url)
    expect(revisitModifiedResponse.status).toStrictEqual(200)
    const revisitBlob = await revisitModifiedResponse.blob()
    expect(await areBlobsEqual(revisitBlob, blob2)).toStrictEqual(true)
  })
})

describe("delete", () => {
  const blob1 = genRandomBlob(1024)
  const passwd1 = "7365ca6eac619ca3f118"
  const ctx = createExecutionContext()

  it("should disallow delete with wrong manageUrl", async () => {
    const resp = await upload(ctx, { c: blob1 })
    // check delete with wrong manageUrl
    expect((await workerFetch(ctx, new Request(`${resp.url}:${passwd1}`, { method: "DELETE" }))).status).toStrictEqual(
      403,
    )
  })

  it("should allow delete with wrong manageUrl", async () => {
    const resp = await upload(ctx, { c: blob1 })

    const deleteResponse = await workerFetch(ctx, new Request(resp.manageUrl, { method: "DELETE" }))
    expect(deleteResponse.status).toStrictEqual(200)

    // check visit deleted
    const revisitDeletedResponse = await workerFetch(ctx, resp.url)
    expect(revisitDeletedResponse.status).toStrictEqual(404)
  })
})

test("static pages", async () => {
  const ctx = createExecutionContext()
  for (const page of staticPages) {
    const url = `${BASE_URL}/${page}`
    expect((await workerFetch(ctx, url)).status, `visiting ${url}`).toStrictEqual(200)
  }
})

test("GET special static pages", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()
  const resp = await upload(ctx, { c: blob1 })

  // test display page
  const decUrl = addRole(resp.url, "d")
  const { name } = parsePath(new URL(resp.url).pathname)
  const decResp = await workerFetch(ctx, decUrl)
  expect(decResp.status, `visiting ${decUrl}`).toStrictEqual(200)
  expect(decResp.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")

  const testPairs = [
    [name, name],
    [name + ".jpg", name + ".jpg"],
    [name + ".jpg?lang=cpp", name + ".jpg"],
    [name + "/a.jpg", name + "/a.jpg"],
  ]
  for (const [accessPath, expectedTitle] of testPairs) {
    const resp = await (await workerFetch(ctx, `${BASE_URL}/d/${accessPath}`)).text()
    expect(
      resp.includes(`/ ${expectedTitle}</title>`),
      `testing access ${accessPath}, returning ${resp}`,
    ).toStrictEqual(true)
  }

  // test manage page
  const manageUrl = resp.manageUrl
  const manageResp = await workerFetch(ctx, manageUrl)
  expect(manageResp.status, `visiting ${manageUrl}`).toStrictEqual(200)
  expect(manageResp.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
})
