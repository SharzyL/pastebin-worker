import { expect, it, beforeEach, vi, afterEach } from "vitest"
import { genRandomBlob, upload, workerFetch } from "./testUtils"
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test"
import { PasteMetadata } from "../storage/storage"

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

it("increase access counter", async () => {
  const ctx = createExecutionContext()
  const content = genRandomBlob(1024)
  const name = "abc"
  const url = (await upload(ctx, { c: content, n: name })).url

  async function getCounter() {
    const paste = await env.PB.getWithMetadata<PasteMetadata>("~" + name)
    return paste?.metadata?.accessCounter
  }

  expect(await getCounter()).toStrictEqual(0)

  await workerFetch(ctx, url)
  await waitOnExecutionContext(ctx)

  expect(await getCounter()).toStrictEqual(1)

  await workerFetch(ctx, url)
  await waitOnExecutionContext(ctx)

  expect(await getCounter()).toStrictEqual(2)
})
