import { describe, expect, it } from "vitest"
import { createExecutionContext, env } from "cloudflare:test"
import { BASE_URL, upload, uploadExpectStatus, workerFetch } from "./testUtils.js"
import worker from "../index.js"

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

  it("POST exceeding R2_MAX_ALLOWED returns 413", async () => {
    const tightEnv = { ...env, R2_MAX_ALLOWED: "10" }
    const fd = new FormData()
    fd.set("c", new Blob(["this payload is definitely longer than 10 bytes"]))
    const resp = await worker.fetch(new Request(BASE_URL, { method: "POST", body: fd }), tightEnv, ctx)
    expect(resp.status).toStrictEqual(413)
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
