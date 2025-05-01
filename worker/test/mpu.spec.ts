import { uploadMPU } from "../../shared/uploadMPU"
import { vi, test, describe, it, expect, afterAll, beforeEach } from "vitest"
import { createExecutionContext } from "cloudflare:test"
import { areBlobsEqual, BASE_URL, genRandomBlob, workerFetch } from "./testUtils"
import { PRIVATE_PASTE_NAME_LEN } from "../../shared/constants"
import { parsePath } from "../../shared/parsers"

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
  const uploadResp = await uploadMPU(
    BASE_URL,
    1024 * 1024 * 5,
    {
      isUpdate: false,
      content: new File([await content.arrayBuffer()], ""),
    },
    callBack,
  )
  expect(callBack).toBeCalledTimes(4)

  const getResp = await workerFetch(ctx, uploadResp.url)
  expect(await areBlobsEqual(await getResp.blob(), content)).toStrictEqual(true)

  const newContent = genRandomBlob(1024 * 1024 * 20)
  await uploadMPU(
    BASE_URL,
    1024 * 1024 * 5,
    {
      content: new File([await newContent.arrayBuffer()], ""),
      isUpdate: true,
      manageUrl: uploadResp.manageUrl,
    },
    callBack,
  )

  const reGetResp = await workerFetch(ctx, uploadResp.url)
  expect(await areBlobsEqual(await reGetResp.blob(), newContent)).toStrictEqual(true)
})

describe("uploadMPU with variant parameters", () => {
  const content = genRandomBlob(1024 * 1024 * 10)
  it("handles specified name", async () => {
    const uploadResp = await uploadMPU(BASE_URL, 1024 * 1024 * 5, {
      isUpdate: false,
      content: new File([await content.arrayBuffer()], ""),
      name: "foobarfoobar",
      expire: "100",
    })
    expect(uploadResp.expirationSeconds).toStrictEqual(100)
    expect(uploadResp.url.includes("/~foobarfoobar")).toStrictEqual(true)
  })

  it("handles long paste name", async () => {
    const uploadResp = await uploadMPU(BASE_URL, 1024 * 1024 * 5, {
      isUpdate: false,
      content: new File([await content.arrayBuffer()], ""),
      isPrivate: true,
    })
    const { name } = parsePath(new URL(uploadResp.url).pathname)
    expect(name.length).toStrictEqual(PRIVATE_PASTE_NAME_LEN)
  })
})
