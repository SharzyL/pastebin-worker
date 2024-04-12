import { test, expect } from "vitest"

import { params, genRandStr } from "../src/common.js"
import {
  randomBlob, areBlobsEqual, createFormData, workerFetch, upload,
  BASE_URL, RAND_NAME_REGEX
} from "./testUtils.js"

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

// TODO: add tests for CORS