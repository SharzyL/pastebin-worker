import { uploadMPU } from "../src/uploadMPU"
import { vi, test, describe, it, expect, afterAll, beforeEach } from "vitest"
import { createExecutionContext } from "cloudflare:test"
import { areBlobsEqual, BASE_URL, genRandomBlob, workerFetch } from "./testUtils"
import { parsePath, PRIVATE_PASTE_NAME_LEN } from "../src/shared"

const ctx = createExecutionContext()
beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit<RequestInitCfProperties>) => {
    return await workerFetch(ctx, new Request(input, init))
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

test("uploadMPU", async () => {
  const content = genRandomBlob(1024 * 1024 * 20)
  const callBack = vi.fn()
  const uploadResp = await uploadMPU(BASE_URL, await content.arrayBuffer(), false, 1024 * 1024 * 5, {
    progressCallback: callBack,
  })
  expect(callBack).toBeCalledTimes(4)

  const getResp = await workerFetch(ctx, uploadResp.url)
  expect(areBlobsEqual(await getResp.blob(), content)).toBeTruthy()

  const { name, password } = parsePath(new URL(uploadResp.manageUrl).pathname)

  const newContent = genRandomBlob(1024 * 1024 * 20)
  await uploadMPU(BASE_URL, await content.arrayBuffer(), true, 1024 * 1024 * 5, { name, password })

  const reGetResp = await workerFetch(ctx, uploadResp.url)
  expect(areBlobsEqual(await reGetResp.blob(), newContent)).toBeTruthy()
})

describe("uploadMPU with variant parameters", () => {
  const content = genRandomBlob(1024 * 1024 * 10)
  it("handles specified name", async () => {
    const uploadResp = await uploadMPU(BASE_URL, await content.arrayBuffer(), false, 1024 * 1024 * 5, {
      name: "foobarfoobar",
      expire: "100",
    })
    expect(uploadResp.expirationSeconds).toStrictEqual(100)
    expect(uploadResp.url.includes("/~foobarfoobar")).toBeTruthy()
  })

  it("handles long paste name", async () => {
    const uploadResp = await uploadMPU(BASE_URL, await content.arrayBuffer(), false, 1024 * 1024 * 5, {
      isPrivate: true,
    })
    const { name } = parsePath(new URL(uploadResp.url).pathname)
    expect(name.length).toStrictEqual(PRIVATE_PASTE_NAME_LEN)
  })
})
