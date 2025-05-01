import { expect, test, vi, beforeEach, afterEach } from "vitest"
import { addRole, areBlobsEqual, genRandomBlob, upload, workerFetch } from "./testUtils"
import { MetaResponse } from "../../shared/interfaces"
import { parseSize } from "../../shared/parsers"
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test"
import worker from "../index"

beforeEach(vi.useFakeTimers)
afterEach(vi.useRealTimers)

test("r2 basic", async () => {
  const blob1 = genRandomBlob(parseSize(env.R2_THRESHOLD)! * 2)
  const ctx = createExecutionContext()

  // upload
  const uploadResponse = await upload(ctx, { c: blob1 })
  const url = uploadResponse.url

  // test get
  const resp = await workerFetch(ctx, url)
  expect(resp.status).toStrictEqual(200)
  expect(await areBlobsEqual(await resp.blob(), blob1)).toStrictEqual(true)

  // test put
  const blob2 = genRandomBlob(parseSize(env.R2_THRESHOLD)! * 2)
  const putResponseJson = await upload(ctx, { c: blob2 }, { method: "PUT", url: uploadResponse.manageUrl })
  expect(putResponseJson.url).toStrictEqual(url)

  // test revisit
  const revisitResp = await workerFetch(ctx, url)
  expect(revisitResp.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitResp.blob(), blob2)).toStrictEqual(true)

  // test meta
  const metaResp = await workerFetch(ctx, addRole(url, "m"))
  expect(metaResp.status).toStrictEqual(200)
  const meta: MetaResponse = await metaResp.json()
  expect(meta.location).toStrictEqual("R2")
})

test("r2 schedule", async () => {
  const ctx = createExecutionContext()

  // upload
  vi.setSystemTime(new Date(2035, 0, 0))
  const blob1 = genRandomBlob(parseSize(env.R2_THRESHOLD)! * 2)
  const uploadResponse = await upload(ctx, { c: blob1, e: "7d" })
  const url = uploadResponse.url

  // test get
  const getResp = await workerFetch(ctx, url)
  expect(getResp.status).toStrictEqual(200)
  await getResp.blob() // we must consume body to prevent breaking isolated storage

  // go to past, nothing will be cleaned
  await worker.scheduled(createScheduledController({ scheduledTime: new Date(2000, 0, 0) }), env, ctx)
  await waitOnExecutionContext(ctx)

  // test get after cleanup
  const getResp1 = await workerFetch(ctx, url)
  expect(getResp.status).toStrictEqual(200)
  await getResp1.blob()

  // jump to 1 year later, now all pastes are expired
  await worker.scheduled(createScheduledController({ scheduledTime: new Date(2040, 0, 0) }), env, ctx)
  await waitOnExecutionContext(ctx)

  // test get after cleanup
  expect((await workerFetch(ctx, url)).status).toStrictEqual(404)
})
