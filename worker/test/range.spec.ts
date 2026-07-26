import { createExecutionContext, env } from "cloudflare:test"
import { beforeAll, describe, expect, it } from "vitest"
import { parseSize } from "../../shared/parsers.js"
import { upload, workerFetch } from "./testUtils.js"

describe("R2 byte range downloads", () => {
  const content = new Uint8Array(parseSize(env.R2_THRESHOLD)! + 257)
  let url: string

  beforeAll(async () => {
    for (let index = 0; index < content.length; index += 1) content[index] = index % 251
    const paste = await upload(createExecutionContext(), { c: new Blob([content]) })
    expect(paste.location).toStrictEqual("R2")
    url = paste.url
  })

  it("returns a bounded range with resumable download headers", async () => {
    const response = await workerFetch(
      createExecutionContext(),
      new Request(url, { headers: { Range: "bytes=100-199" } }),
    )

    expect(response.status).toStrictEqual(206)
    expect(response.headers.get("Accept-Ranges")).toStrictEqual("bytes")
    expect(response.headers.get("Content-Range")).toStrictEqual(`bytes 100-199/${content.length}`)
    expect(response.headers.get("Content-Length")).toStrictEqual("100")
    expect(response.headers.get("ETag")).not.toBeNull()
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Accept-Ranges")
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Content-Range")
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(content.slice(100, 200))
  })

  it("supports open-ended and suffix ranges", async () => {
    const openEnded = await workerFetch(
      createExecutionContext(),
      new Request(url, { headers: { Range: `bytes=${content.length - 17}-` } }),
    )
    expect(openEnded.status).toStrictEqual(206)
    expect(openEnded.headers.get("Content-Range")).toStrictEqual(
      `bytes ${content.length - 17}-${content.length - 1}/${content.length}`,
    )
    expect(new Uint8Array(await openEnded.arrayBuffer())).toStrictEqual(content.slice(-17))

    const suffix = await workerFetch(createExecutionContext(), new Request(url, { headers: { Range: "bytes=-23" } }))
    expect(suffix.status).toStrictEqual(206)
    expect(new Uint8Array(await suffix.arrayBuffer())).toStrictEqual(content.slice(-23))
  })

  it("returns 416 for an unsatisfiable range", async () => {
    const response = await workerFetch(
      createExecutionContext(),
      new Request(url, { headers: { Range: `bytes=${content.length}-` } }),
    )

    expect(response.status).toStrictEqual(416)
    expect(response.headers.get("Accept-Ranges")).toStrictEqual("bytes")
    expect(response.headers.get("Content-Range")).toStrictEqual(`bytes */${content.length}`)
    expect(await response.text()).toStrictEqual("")
  })

  it("honors matching If-Range validators and ignores a range when they do not match", async () => {
    const initial = await workerFetch(createExecutionContext(), new Request(url, { headers: { Range: "bytes=0-9" } }))
    const etag = initial.headers.get("ETag")!
    await initial.arrayBuffer()

    const matched = await workerFetch(
      createExecutionContext(),
      new Request(url, { headers: { Range: "bytes=10-19", "If-Range": etag } }),
    )
    expect(matched.status).toStrictEqual(206)
    expect(new Uint8Array(await matched.arrayBuffer())).toStrictEqual(content.slice(10, 20))

    const mismatched = await workerFetch(
      createExecutionContext(),
      new Request(url, { headers: { Range: "bytes=10-19", "If-Range": '"different"' } }),
    )
    expect(mismatched.status).toStrictEqual(200)
    expect(mismatched.headers.get("Content-Range")).toBeNull()
    expect(new Uint8Array(await mismatched.arrayBuffer())).toStrictEqual(content)
  })

  it("advertises ranges on HEAD without treating HEAD as a partial request", async () => {
    const response = await workerFetch(
      createExecutionContext(),
      new Request(url, { method: "HEAD", headers: { Range: "bytes=10-19" } }),
    )

    expect(response.status).toStrictEqual(200)
    expect(response.headers.get("Accept-Ranges")).toStrictEqual("bytes")
    expect(response.headers.get("Content-Range")).toBeNull()
    expect(response.headers.get("Content-Length")).toStrictEqual(content.length.toString())
  })
})

describe("non-resumable paste downloads", () => {
  it("ignores Range for KV-backed pastes", async () => {
    const paste = await upload(createExecutionContext(), { c: "0123456789" })
    expect(paste.location).toStrictEqual("KV")

    const response = await workerFetch(
      createExecutionContext(),
      new Request(paste.url, { headers: { Range: "bytes=2-4" } }),
    )
    expect(response.status).toStrictEqual(200)
    expect(response.headers.get("Accept-Ranges")).toBeNull()
    expect(await response.text()).toStrictEqual("0123456789")
  })

  it("ignores Range for read-limited R2 pastes", async () => {
    const content = new Uint8Array(parseSize(env.R2_THRESHOLD)! + 1)
    const paste = await upload(createExecutionContext(), { c: new Blob([content]), reads: "2" })
    expect(paste.location).toStrictEqual("R2")

    const response = await workerFetch(
      createExecutionContext(),
      new Request(paste.url, { headers: { Range: "bytes=0-9" } }),
    )
    expect(response.status).toStrictEqual(200)
    expect(response.headers.get("Accept-Ranges")).toBeNull()
    expect(response.headers.get("X-PB-Remaining-Reads")).toStrictEqual("2")
    expect((await response.arrayBuffer()).byteLength).toStrictEqual(content.length)
  })
})
