import { uploadMPU } from "../../shared/uploadPaste.js"
import { vi, test, describe, it, expect, afterAll, beforeEach } from "vitest"
import { createExecutionContext } from "cloudflare:test"
import { addRole, areBlobsEqual, BASE_URL, genRandomBlob, workerFetch } from "./testUtils.js"
import { PRIVATE_PASTE_NAME_LEN } from "../../shared/constants.js"
import { parsePath } from "../../shared/parsers.js"
import type { MetaResponse } from "../../shared/interfaces.js"

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
    const callBack = vi.fn<(doneBytes: number, totalBytes: number) => void>()
  const uploadResp = await uploadMPU(
    BASE_URL,
    1024 * 1024 * 5,
    {
      isUpdate: false,
      content: new File([await content.arrayBuffer()], ""),
    },
    callBack,
  )
  const progressValues = callBack.mock.calls.map(([doneBytes, totalBytes]) => [doneBytes, totalBytes] as const)
  expect(progressValues.length).toBeGreaterThan(0)
    expect(progressValues[progressValues.length - 1]).toStrictEqual([content.size, content.size])
  expect(progressValues.every(([doneBytes], index) => index === 0 || doneBytes >= progressValues[index - 1][0])).toBe(
    true,
  )

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

  const reGetMetaResp: MetaResponse = await (await workerFetch(ctx, addRole(uploadResp.url, "m"))).json()
  expect(reGetMetaResp.sizeBytes).toStrictEqual(content.size)

  const reGetResp = await workerFetch(ctx, uploadResp.url)
  expect(await areBlobsEqual(await reGetResp.blob(), newContent)).toStrictEqual(true)
  expect(reGetResp.headers.has("etag")).toStrictEqual(true)
}, 15_000)

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

  it("completes MPU uploads with file lists larger than KV metadata", async () => {
    const filenames = Array.from({ length: 30 }, (_, index) => ({
      name: `folder-${index}/a-descriptive-file-name-${index}.bin`,
      sizeBytes: index + 1,
    }))
    expect(new TextEncoder().encode(JSON.stringify(filenames)).byteLength).toBeGreaterThan(1024)

    const uploadResp = await uploadMPU(BASE_URL, 1024 * 1024 * 5, {
      isUpdate: false,
      content: new File([await content.arrayBuffer()], "30-files.zip"),
      filenames,
    })

    expect(uploadResp.location).toStrictEqual("R2")
    expect(uploadResp.filenames).toStrictEqual(filenames)
    const metaResp: MetaResponse = await (await workerFetch(ctx, addRole(uploadResp.url, "m"))).json()
    expect(metaResp.filenames).toStrictEqual(filenames)
  }, 15_000)
})
