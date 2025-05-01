import { expect, test, it, describe, beforeEach, afterEach } from "vitest"
import { areBlobsEqual, BASE_URL, genRandomBlob, upload, uploadExpectStatus, workerFetch } from "./testUtils"
import { encodeBasicAuth, decodeBasicAuth } from "../pages/auth"
import { createExecutionContext, env } from "cloudflare:test"

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

describe("basic auth", () => {
  const ctx = createExecutionContext()
  const users: Record<string, string> = {
    user1: "passwd1",
    user2: "passwd2",
  }
  const authHeader = { Authorization: encodeBasicAuth("user1", users["user1"]) }
  const wrongAuthHeader = { Authorization: encodeBasicAuth("user1", "wrong-password") }
  const blob1 = genRandomBlob(1024)

  /* TODO: Due to the limitation of workers-sdk, setting env here may also affect other tests occasionally
   It means that other tests may fail with 400 error occasionally
   ref: https://github.com/cloudflare/workers-sdk/issues/7339
  */
  beforeEach(() => {
    env.BASIC_AUTH = users
  })

  afterEach(() => {
    env.BASIC_AUTH = {}
  })

  it("should forbid accessing index without auth", async () => {
    for (const page of ["", "index", "index.html"]) {
      expect((await workerFetch(ctx, `${BASE_URL}/${page}`)).status, `visiting ${page}`).toStrictEqual(401)
    }
  })

  it("should allow accessing index without auth", async () => {
    expect((await workerFetch(ctx, new Request(BASE_URL, { headers: authHeader }))).status).toStrictEqual(200)
  })

  it("should forbid upload without auth", async () => {
    await uploadExpectStatus(ctx, { c: blob1 }, 401, { method: "POST" })
  })

  it("should allow upload index without auth", async () => {
    await upload(ctx, { c: blob1 }, { headers: authHeader })
  })

  // upload with wrong auth
  it("should forbid upload with wrong auth", async () => {
    await uploadExpectStatus(ctx, { c: blob1 }, 401, { headers: wrongAuthHeader })
  })

  it("should allow visit paste without auth", async () => {
    const uploadResp1 = await upload(ctx, { c: blob1 }, { headers: authHeader })
    const revisitResp = await workerFetch(ctx, uploadResp1.url)
    expect(revisitResp.status).toStrictEqual(200)
    expect(await areBlobsEqual(await revisitResp.blob(), blob1)).toStrictEqual(true)
  })

  it("should allow update without auth", async () => {
    const uploadResp1 = await upload(ctx, { c: blob1 }, { headers: authHeader })
    const blob2 = genRandomBlob(1024)
    const updateResp = await upload(ctx, { c: blob2 }, { method: "PUT", url: uploadResp1.manageUrl })
    const revisitUpdatedResp = await workerFetch(ctx, updateResp.url)
    expect(revisitUpdatedResp.status).toStrictEqual(200)
    expect(await areBlobsEqual(await revisitUpdatedResp.blob(), blob2)).toStrictEqual(true)
  })

  it("should delete without auth", async () => {
    const uploadResp1 = await upload(ctx, { c: blob1 }, { headers: authHeader })
    const deleteResp = await workerFetch(
      ctx,
      new Request(uploadResp1.manageUrl, {
        method: "DELETE",
      }),
    )
    expect(deleteResp.status).toStrictEqual(200)
    expect((await workerFetch(ctx, uploadResp1.url)).status).toStrictEqual(404)
  })
})
