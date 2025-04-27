import { expect, test } from "vitest"
import { areBlobsEqual, BASE_URL, createFormData, genRandomBlob, workerFetch } from "./testUtils.js"
import { encodeBasicAuth, decodeBasicAuth } from "../src/auth.js"
import { createExecutionContext, env } from "cloudflare:test"
import { PasteResponse } from "../src/shared"

test("basic auth encode and decode", () => {
  const userPasswdPairs = [
    ["user1", "passwd1"],
    ["あおい", "まなか"],
    ["1234#", "اهلا"],
  ]
  for (const [user, passwd] of userPasswdPairs) {
    const encoded = encodeBasicAuth(user, passwd)
    const decoded = decodeBasicAuth(encoded)
    expect(decoded.username).toStrictEqual(user)
    expect(decoded.password).toStrictEqual(passwd)
  }
})

test("basic auth", async () => {
  const ctx = createExecutionContext()
  const users: Record<string, string> = {
    user1: "passwd1",
    user2: "passwd2",
  }

  /* TODO: Due to the limitation of workers-sdk, setting env here may also affect other tests occasionally
   It means that other tests may fail with 400 error occasionally
   ref: https://github.com/cloudflare/workers-sdk/issues/7339
  */
  env.BASIC_AUTH = users

  // access index page
  for (const page of ["", "index", "index.html"]) {
    expect((await workerFetch(ctx, `${BASE_URL}/${page}`)).status).toStrictEqual(401)
  }
  expect(
    (
      await workerFetch(
        ctx,
        new Request(BASE_URL, {
          headers: { Authorization: encodeBasicAuth("user1", users["user1"]) },
        }),
      )
    ).status,
  ).toStrictEqual(200)

  // upload with no auth
  const blob1 = genRandomBlob(1024)
  const uploadResp = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "POST",
      body: createFormData({ c: blob1 }),
    }),
  )
  expect(uploadResp.status).toStrictEqual(401)

  // upload with true auth
  const uploadResp1 = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "POST",
      body: createFormData({ c: blob1 }),
      headers: { Authorization: encodeBasicAuth("user2", users["user2"]) },
    }),
  )
  expect(uploadResp1.status).toStrictEqual(200)

  // upload with wrong auth
  const uploadResp2 = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "POST",
      body: createFormData({ c: blob1 }),
      headers: { Authorization: encodeBasicAuth("user1", "wrong-password") },
    }),
  )
  expect(uploadResp2.status).toStrictEqual(401)

  // revisit without auth
  const uploadJson = JSON.parse(await uploadResp1.text()) as PasteResponse
  const url = uploadJson["url"]
  const revisitResp = await workerFetch(ctx, url)
  expect(revisitResp.status).toStrictEqual(200)
  expect(areBlobsEqual(await revisitResp.blob(), blob1)).toBeTruthy()

  // update with no auth
  const blob2 = genRandomBlob(1024)
  const admin = uploadJson["manageUrl"]
  const updateResp = await workerFetch(
    ctx,
    new Request(admin, {
      method: "PUT",
      body: createFormData({ c: blob2 }),
    }),
  )
  expect(updateResp.status).toStrictEqual(200)
  const revisitUpdatedResp = await workerFetch(ctx, url)
  expect(revisitUpdatedResp.status).toStrictEqual(200)
  expect(areBlobsEqual(await revisitUpdatedResp.blob(), blob2)).toBeTruthy()

  // delete with no auth
  const deleteResp = await workerFetch(
    ctx,
    new Request(admin, {
      method: "DELETE",
    }),
  )
  expect(deleteResp.status).toStrictEqual(200)
  expect((await workerFetch(ctx, url)).status).toStrictEqual(404)

  env.BASIC_AUTH = {}
})
