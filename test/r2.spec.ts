import { expect, test } from "vitest"
import { areBlobsEqual, genRandomBlob, upload, workerFetch } from "./testUtils"
import { parseSize } from "../src/shared"
import { createExecutionContext, env } from "cloudflare:test"

test("basic", async () => {
  const blob1 = genRandomBlob(parseSize(env.R2_THRESHOLD)! * 2)
  const ctx = createExecutionContext()

  // upload
  const uploadResponse = await upload(ctx, { c: blob1 })
  const url = uploadResponse.url

  // test get
  const resp = await workerFetch(ctx, url)
  expect(resp.status).toStrictEqual(200)
  expect(areBlobsEqual(await resp.blob(), blob1)).toBeTruthy()

  // test put
  const blob2 = genRandomBlob(parseSize(env.R2_THRESHOLD)! * 2)
  const putResponseJson = await upload(ctx, { c: blob2 }, "PUT", uploadResponse.manageUrl)
  expect(putResponseJson.url).toStrictEqual(url)

  // test revisit
  const revisitResp = await workerFetch(ctx, url)
  expect(revisitResp.status).toStrictEqual(200)
  expect(areBlobsEqual(await revisitResp.blob(), blob2)).toBeTruthy()
})
