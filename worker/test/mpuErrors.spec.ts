import { afterEach, describe, expect, it, vi } from "vitest"
import { createExecutionContext, env } from "cloudflare:test"
import { BASE_URL, genRandomBlob, upload, workerFetch } from "./testUtils.js"
import { parsePath } from "../../shared/parsers.js"
import { uploadMPU } from "../../shared/uploadPaste.js"
import worker from "../index.js"
import type { MPUCreateResponse } from "../../shared/interfaces.js"

const ctx = createExecutionContext()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("MPU error paths", () => {
  it("handleMPUCreate rejects names not matching NAME_REGEX", async () => {
    // too short (regex requires {3,})
    const r1 = await workerFetch(ctx, new Request(`${BASE_URL}/mpu/create?n=ab`, { method: "POST" }))
    expect(r1.status).toStrictEqual(400)
    expect(await r1.text()).toContain("illegal paste name")

    // contains a character outside the allowed set
    const r2 = await workerFetch(ctx, new Request(`${BASE_URL}/mpu/create?n=ab!cd`, { method: "POST" }))
    expect(r2.status).toStrictEqual(400)
  })

  it("handleMPUCreate returns 409 when name is already taken", async () => {
    const name = "mpuname"
    await upload(ctx, { c: new Blob(["seed"]), n: name })

    const resp = await workerFetch(ctx, new Request(`${BASE_URL}/mpu/create?n=${name}`, { method: "POST" }))
    expect(resp.status).toStrictEqual(409)
    expect(await resp.text()).toContain("already used")
  })

  it("handleMPUCreateUpdate requires both name and password", async () => {
    const r1 = await workerFetch(ctx, new Request(`${BASE_URL}/mpu/create-update?name=foo`, { method: "POST" }))
    expect(r1.status).toStrictEqual(400)

    const r2 = await workerFetch(
      ctx,
      new Request(`${BASE_URL}/mpu/create-update?password=secretpw`, { method: "POST" }),
    )
    expect(r2.status).toStrictEqual(400)
  })

  it("handleMPUCreateUpdate returns 404 for unknown paste", async () => {
    const resp = await workerFetch(
      ctx,
      new Request(`${BASE_URL}/mpu/create-update?name=nonexist&password=whateverpw`, { method: "POST" }),
    )
    expect(resp.status).toStrictEqual(404)
  })

  it("handleMPUCreateUpdate returns 403 on incorrect password", async () => {
    const seeded = await upload(ctx, { c: new Blob(["seed"]) })
    const { name } = parsePath(new URL(seeded.url).pathname)

    const resp = await workerFetch(
      ctx,
      new Request(`${BASE_URL}/mpu/create-update?name=${name}&password=wrongpasswd`, { method: "POST" }),
    )
    expect(resp.status).toStrictEqual(403)
  })

  it("handleMPUResume requires partNumber, uploadId, and key", async () => {
    const resp = await workerFetch(ctx, new Request(`${BASE_URL}/mpu/resume`, { method: "PUT", body: "x" }))
    expect(resp.status).toStrictEqual(400)
    expect(await resp.text()).toContain("missing")
  })

  it("handleMPUResume rejects request without a body", async () => {
    const resp = await workerFetch(
      ctx,
      new Request(`${BASE_URL}/mpu/resume?key=k&uploadId=u&partNumber=1`, { method: "PUT" }),
    )
    expect(resp.status).toStrictEqual(400)
    expect(await resp.text()).toContain("missing request body")
  })

  it("handleMPUComplete returns 400 when name does not match the upload key", async () => {
    const createResp = await workerFetch(ctx, new Request(`${BASE_URL}/mpu/create`, { method: "POST" }))
    const { key, uploadId }: MPUCreateResponse = await createResp.json()

    // call complete with a name different from the key (no parts uploaded — the name check runs first)
    const fd = new FormData()
    fd.set("c", new File([JSON.stringify([])], "parts.json"))
    const resp = await workerFetch(
      ctx,
      new Request(`${BASE_URL}/mpu/complete?name=mismatched&key=${key}&uploadId=${uploadId}`, {
        method: "POST",
        body: fd,
      }),
    )
    expect(resp.status).toStrictEqual(400)
    expect(await resp.text()).toContain("not consistent")
  })

  it("handleMPUComplete returns 413 when uploaded object exceeds R2_MAX_ALLOWED", async () => {
    const tightEnv = { ...env, R2_MAX_ALLOWED: "1K" }

    // Route create/resume through default env so chunks pass; only the complete request uses
    // the tight env, so the small parts-JSON formdata still fits within 1K but the assembled R2
    // object trips the size check.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit<RequestInitCfProperties>) => {
      const req = new Request(input, init)
      const useEnv = req.url.includes("/mpu/complete") ? tightEnv : env
      return await worker.fetch(req, useEnv, ctx)
    })

    const big = genRandomBlob(1024 * 1024 * 5)
    await expect(
      uploadMPU(BASE_URL, 1024 * 1024 * 5, {
        isUpdate: false,
        content: new File([await big.arrayBuffer()], "big.bin"),
      }),
    ).rejects.toMatchObject({ statusCode: 413 })
  })
})
