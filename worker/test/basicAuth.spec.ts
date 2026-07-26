import { expect, test, it, describe, beforeEach, afterEach } from "vitest"
import { areBlobsEqual, BASE_URL, genRandomBlob, upload, uploadExpectStatus, workerFetch } from "./testUtils.js"
import { encodeBasicAuth, decodeBasicAuth, verifyPasswordHash } from "../pages/auth.js"
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

test("Argon2 verification accepts configured hashes and rejects invalid formats", () => {
  const hash = "$argon2id$v=19$m=19456,t=2,p=1$SaOoXR1kQZC+4qnVu54dLA$qRSeRaayqqFX8A6Wbu7vP2iv241RpSBtbfKizEcXtHI"

  expect(verifyPasswordHash("correct horse battery staple", hash)).toStrictEqual(true)
  expect(verifyPasswordHash("wrong password", hash)).toStrictEqual(false)
  expect(verifyPasswordHash("password", "$2b$10$legacy-bcrypt-hash")).toStrictEqual(false)
  expect(verifyPasswordHash("password", "scrypt$16384$8$5$old$salt")).toStrictEqual(false)
  expect(verifyPasswordHash("password", "pbkdf2-sha256$600000$old$salt")).toStrictEqual(false)
})

describe("basic auth", () => {
  const ctx = createExecutionContext()
  const users: Record<string, string> = {
    user1: "passwd1",
    user2: "passwd2",
  }
  const passwordHashes: Record<string, string> = {
    user1: "$argon2id$v=19$m=19456,t=2,p=1$qh9JB5M4Sudl326ZDOXqUw$ZzKtZyq1MdjXEI4FMrOADuo1UQsTERPBmAj4hGhjJXM",
    user2: "$argon2id$v=19$m=19456,t=2,p=1$W0FV/wbg9mg+xUcUBj/7Wg$8PHhejjOp0j/yuaExxEaWTYlYM9GK5nXjXsaqggAsoE",
  }
  const authHeader = { Authorization: encodeBasicAuth("user1", users.user1) }
  const wrongAuthHeader = { Authorization: encodeBasicAuth("user1", "wrong-password") }
  const blob1 = genRandomBlob(1024)

  /* TODO: Due to the limitation of workers-sdk, setting env here may also affect other tests occasionally
   It means that other tests may fail with 400 error occasionally
   ref: https://github.com/cloudflare/workers-sdk/issues/7339
  */
  beforeEach(() => {
    env.BASIC_AUTH = passwordHashes
  })

  afterEach(() => {
    env.BASIC_AUTH = {}
  })

  it("should forbid accessing index without auth", async () => {
    for (const page of ["", "index", "index.html", "index.md"]) {
      const response = await workerFetch(ctx, `${BASE_URL}/${page}`)
      expect(response.status, `visiting ${page}`).toStrictEqual(401)
      expect(response.headers.get("Cache-Control")).toStrictEqual("private, no-store")
    }
  })

  it("should forbid accessing curl index without auth", async () => {
    const resp = await workerFetch(ctx, new Request(BASE_URL, { headers: { "User-Agent": "curl/8.0.0" } }))
    expect(resp.status).toStrictEqual(401)
  })

  it("should allow accessing index without auth", async () => {
    const response = await workerFetch(ctx, new Request(BASE_URL, { headers: authHeader }))
    expect(response.status).toStrictEqual(200)
    expect(response.headers.get("Cache-Control")).toStrictEqual("private, no-store")
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
    const response = await workerFetch(ctx, new Request(BASE_URL, { headers: wrongAuthHeader }))
    expect(response.status).toStrictEqual(401)
    expect(response.headers.get("Cache-Control")).toStrictEqual("private, no-store")
  })

  it("should reject invalid hashes without returning a server error", async () => {
    for (const encodedHash of [
      "$2b$08$i/yH1TSIGWUNQVsxPrcVUeR0hsGioFNf3.OeHdYzxwjzLH/hzoY.i",
      "scrypt$16384$8$5$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ]) {
      env.BASIC_AUTH = { user1: encodedHash }
      expect((await workerFetch(ctx, new Request(BASE_URL, { headers: authHeader }))).status).toStrictEqual(401)
    }
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

  it("should allow accessing doc pages without auth", async () => {
    for (const page of ["/doc/api", "/doc/tos", "/doc/curl"]) {
      expect((await workerFetch(ctx, `${BASE_URL}${page}`)).status, `visiting ${page}`).toStrictEqual(200)
    }
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
