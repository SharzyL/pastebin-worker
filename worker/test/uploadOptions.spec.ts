import { expect, test } from "vitest"
import {
  addRole,
  areBlobsEqual,
  BASE_URL,
  genRandomBlob,
  RAND_NAME_REGEX,
  upload,
  uploadExpectStatus,
  workerFetch,
} from "./testUtils"
import { createExecutionContext, env } from "cloudflare:test"
import { MetaResponse } from "../../shared/interfaces"
import { MAX_PASSWD_LEN, MIN_PASSWD_LEN, PRIVATE_PASTE_NAME_LEN } from "../../shared/constants"
import { parseExpiration } from "../../shared/parsers"

test("privacy url with option p", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // upload
  const responseJson = await upload(ctx, { c: blob1, p: "1" })

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
  expect(await areBlobsEqual(await revisitSesponse.blob(), blob1)).toStrictEqual(true)
})

test("expire with option e", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  async function testExpireParse(expire: string, expireSecs: number | null) {
    const responseJson = await upload(ctx, { c: blob1, e: expire })
    expect(responseJson["expirationSeconds"]).toStrictEqual(expireSecs)
  }

  const maxExpirationSeconds = parseExpiration(env.MAX_EXPIRATION)!
  const defaultExpirationSeconds = parseExpiration(env.DEFAULT_EXPIRATION)!
  await testExpireParse("1000", 1000)
  await testExpireParse("100m", 6000)
  await testExpireParse("100h", 360000)
  await testExpireParse("1d", 86400)
  await testExpireParse("100d", maxExpirationSeconds) // longer expiration will be clipped to 30d
  await testExpireParse("100  m", 6000)
  await testExpireParse("", defaultExpirationSeconds)

  const testFailParse = async (expire: string) => {
    await uploadExpectStatus(ctx, { c: blob1, e: expire }, 400)
  }

  await testFailParse("abc")
  await testFailParse("1c")
  await testFailParse("-100m")
})

test("custom path with option n", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check bad names
  const badNames = ["a", "ab", "..."]
  for (const name of badNames) {
    await uploadExpectStatus(ctx, { c: blob1, n: name }, 400)
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
  expect(await areBlobsEqual(await revisitResponse.blob(), blob1)).toStrictEqual(true)
})

test("custom passwd with option s", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check good name upload
  const passwd = "1366eaa20c071763dc94"
  const wrongPasswd = "7365ca6eac619ca3f118"
  const uploadResponseJson = await upload(ctx, { c: blob1, s: passwd })
  const url = uploadResponseJson.url
  const manageUrl = uploadResponseJson.manageUrl
  const parsedPasswd = manageUrl.slice(manageUrl.lastIndexOf(":") + 1)
  expect(parsedPasswd).toStrictEqual(passwd)

  // check password format verification
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MIN_PASSWD_LEN - 1) }, 400)
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MIN_PASSWD_LEN) + "\n" }, 400)
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MAX_PASSWD_LEN + 1) }, 400)

  // check modify with wrong manageUrl
  await uploadExpectStatus(ctx, { c: blob1 }, 403, { method: "PUT", url: `${url}:${wrongPasswd}` })

  // check modify
  const putResponseJson = await upload(ctx, { c: blob1, s: wrongPasswd }, { method: "PUT", url: manageUrl })
  expect(putResponseJson.url).toStrictEqual(url) // url will not change
  expect(putResponseJson.manageUrl).toStrictEqual(`${url}:${wrongPasswd}`) // passwd may change
})

test("encryption with option encryption-scheme", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check good name upload
  const uploadResponseJson = await upload(ctx, {
    c: { content: blob1, filename: "a.pdf" },
    "encryption-scheme": "AES-GCM",
  })
  const url = uploadResponseJson.url

  const fetchPaste = await workerFetch(ctx, url)
  await fetchPaste.bytes()
  expect(fetchPaste.headers.get("Content-Type")).toStrictEqual("application/octet-stream")
  expect(fetchPaste.headers.get("Content-Disposition")).toStrictEqual("inline; filename*=UTF-8''a.pdf.encrypted")
  expect(fetchPaste.headers.get("X-PB-Encryption-Scheme")).toStrictEqual("AES-GCM")
  expect(fetchPaste.headers.get("Access-Control-Expose-Headers")?.includes("X-PB-Encryption-Scheme")).toStrictEqual(
    true,
  )

  // fetch with filename, now the content-disposition and content-type should be changed
  const fetchPasteWithFilename = await workerFetch(ctx, url + "/b.pdf")
  await fetchPasteWithFilename.bytes()
  expect(fetchPasteWithFilename.headers.get("Content-Disposition")).toStrictEqual("inline; filename*=UTF-8''b.pdf")
  expect(fetchPasteWithFilename.headers.get("Content-Type")).toStrictEqual("application/pdf")

  // fetch with ext, now only the content-type is chaanged
  const fetchPasteWithExt = await workerFetch(ctx, url + ".pdf")
  await fetchPasteWithExt.bytes()
  expect(fetchPasteWithExt.headers.get("Content-Disposition")).toStrictEqual("inline; filename*=UTF-8''a.pdf.encrypted")
  expect(fetchPasteWithExt.headers.get("Content-Type")).toStrictEqual("application/pdf")

  const fetchMeta: MetaResponse = await (await workerFetch(ctx, addRole(url, "m"))).json()
  expect(fetchMeta.encryptionScheme).toStrictEqual("AES-GCM")
})

test("highlight with option lang", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()
  const lang = "cpp"

  const uploadResp = await upload(ctx, { c: blob1, lang: lang })
  const metaResp: MetaResponse = await (await workerFetch(ctx, addRole(uploadResp.url, "m"))).json()
  expect(metaResp.highlightLanguage).toStrictEqual(lang)

  const getResp = await workerFetch(ctx, uploadResp.url)
  expect(getResp.headers.get("X-PB-Highlight-Language")).toStrictEqual(lang)
  expect(getResp.headers.get("Access-Control-Expose-Headers")?.includes("X-PB-Highlight-Language")).toStrictEqual(true)
  expect(metaResp.highlightLanguage).toStrictEqual(lang)
})
