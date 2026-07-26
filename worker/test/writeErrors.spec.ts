import { describe, expect, it } from "vitest"
import { createExecutionContext, env } from "cloudflare:test"
import { BASE_URL, upload, uploadExpectStatus, workerFetch } from "./testUtils.js"
import worker from "../index.js"
import { DIRECT_UPLOAD_MAX_BYTES } from "../../shared/constants.js"

const ctx = createExecutionContext()

describe("write error paths — content/format validation", () => {
  it("POST without `c` field returns 400", async () => {
    await uploadExpectStatus(ctx, { e: "1d" }, 400)
  })

  it("POST with non-multipart Content-Type returns 400", async () => {
    const resp = await workerFetch(
      ctx,
      new Request(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"c":"x"}',
      }),
    )
    expect(resp.status).toStrictEqual(400)
    expect(await resp.text()).toContain("multipart/form-data")
  })

  it("POST with malformed multipart body returns 400", async () => {
    const resp = await workerFetch(
      ctx,
      new Request(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=----xyz" },
        body: "this is not valid multipart\r\n",
      }),
    )
    expect(resp.status).toStrictEqual(400)
  })

  it("POST accepts exactly 5 MiB and rejects one byte more", async () => {
    await upload(ctx, { c: new Blob([new Uint8Array(DIRECT_UPLOAD_MAX_BYTES)]) })
    await uploadExpectStatus(ctx, { c: new Blob([new Uint8Array(DIRECT_UPLOAD_MAX_BYTES + 1)]) }, 413)
  })

  it("POST accepts multipart body when final CRLF arrives as a separate chunk", async () => {
    const fd = new FormData()
    fd.set("c", new File(["x"], "split.txt"))
    const sourceReq = new Request(BASE_URL, { method: "POST", body: fd })
    const body = new Uint8Array(await sourceReq.arrayBuffer())
    const splitAt = body.byteLength - 2
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(body.slice(0, splitAt))
        controller.enqueue(body.slice(splitAt))
        controller.close()
      },
    })
    const splitRequestInit = {
      method: "POST",
      headers: { "Content-Type": sourceReq.headers.get("Content-Type")! },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }
    const resp = await worker.fetch(new Request(BASE_URL, splitRequestInit), env, ctx)
    expect(resp.status).toStrictEqual(200)
  })

  it("POST/PUT to an unknown /mpu/* path returns 400", async () => {
    const fd = new FormData()
    fd.set("c", new Blob(["x"]))

    const resp = await workerFetch(ctx, new Request(`${BASE_URL}/mpu/bogus`, { method: "POST", body: fd }))
    expect(resp.status).toStrictEqual(400)
    expect(await resp.text()).toContain("illegal mpu operation")
  })
})

describe("write error paths — name and password validation", () => {
  it("POST with name not matching NAME_REGEX returns 400", async () => {
    await uploadExpectStatus(ctx, { c: new Blob(["x"]), n: "ab!cd" }, 400)
  })

  it("POST with already-used name returns 409", async () => {
    const name = "takenname"
    await upload(ctx, { c: new Blob(["first"]), n: name })
    await uploadExpectStatus(ctx, { c: new Blob(["second"]), n: name }, 409)
  })

  it("POST with too-short password returns 400", async () => {
    await uploadExpectStatus(ctx, { c: new Blob(["x"]), s: "short" }, 400)
  })

  it("POST with too-long password returns 400", async () => {
    await uploadExpectStatus(ctx, { c: new Blob(["x"]), s: "a".repeat(129) }, 400)
  })

  it("POST with newline in password returns 400", async () => {
    await uploadExpectStatus(ctx, { c: new Blob(["x"]), s: "abc12345\nabcdef" }, 400)
  })

  it("POST with invalid expire format returns 400", async () => {
    await uploadExpectStatus(ctx, { c: new Blob(["x"]), e: "weird-format" }, 400)
  })
})

describe("write error paths — PUT specifics", () => {
  it("PUT exceeding 5 MiB returns 413", async () => {
    const seeded = await upload(ctx, { c: new Blob(["x"]) })
    await uploadExpectStatus(ctx, { c: new Blob([new Uint8Array(DIRECT_UPLOAD_MAX_BYTES + 1)]) }, 413, {
      method: "PUT",
      url: seeded.manageUrl,
    })
  })

  it("PUT with `n` field returns 400 (cannot rename)", async () => {
    const seeded = await upload(ctx, { c: new Blob(["x"]) })
    await uploadExpectStatus(ctx, { c: new Blob(["y"]), n: "newname" }, 400, {
      method: "PUT",
      url: seeded.manageUrl,
    })
  })

  it("PUT without password in URL returns 403", async () => {
    const seeded = await upload(ctx, { c: new Blob(["x"]) })
    await uploadExpectStatus(ctx, { c: new Blob(["y"]) }, 403, {
      method: "PUT",
      url: seeded.url, // url has no `:password` suffix
    })
  })

  it("PUT to a non-existent paste returns 404", async () => {
    await uploadExpectStatus(ctx, { c: new Blob(["x"]) }, 404, {
      method: "PUT",
      url: `${BASE_URL}/zzzzz:somepasswd`,
    })
  })
})

describe("write error paths — MPU complete name validation", () => {
  function completeFormData(): FormData {
    const fd = new FormData()
    fd.set("c", new File([JSON.stringify([])], "parts.json"))
    return fd
  }

  it("POST /mpu/complete without name returns 400", async () => {
    const resp = await workerFetch(
      ctx,
      new Request(`${BASE_URL}/mpu/complete?key=k&uploadId=u`, {
        method: "POST",
        body: completeFormData(),
      }),
    )
    expect(resp.status).toStrictEqual(400)
    expect(await resp.text()).toContain("no name for MPU complete")
  })

  it("PUT /mpu/complete without name returns 400", async () => {
    const resp = await workerFetch(
      ctx,
      new Request(`${BASE_URL}/mpu/complete?key=k&uploadId=u`, {
        method: "PUT",
        body: completeFormData(),
      }),
    )
    expect(resp.status).toStrictEqual(400)
    expect(await resp.text()).toContain("no name for MPU complete")
  })
})
