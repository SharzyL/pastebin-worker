import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test"
import { addRole, BASE_URL, genRandomBlob, upload, workerFetch } from "./testUtils.js"
import worker from "../index.js"
import { parseSize } from "../../shared/parsers.js"
import type { PasteMetadata } from "../storage/storage.js"

beforeEach(vi.useFakeTimers)
afterEach(vi.useRealTimers)

describe("getPaste / getPasteMetadata expiration", () => {
  it("returns 404 once a paste has expired and removes it from KV", async () => {
    const ctx = createExecutionContext()

    vi.setSystemTime(new Date(2030, 0, 1))
    const seeded = await upload(ctx, { c: new Blob(["hello"]), e: "70" })
    const url = seeded.url
    const name = url.slice(BASE_URL.length + 1)

    // sanity: still alive right after upload
    expect((await workerFetch(ctx, url)).status).toStrictEqual(200)

    // jump past the paste's expiration; getPaste should now report 404 and schedule deletion
    vi.setSystemTime(new Date(2030, 0, 2))
    const stale = await workerFetch(ctx, url)
    expect(stale.status).toStrictEqual(404)
    await waitOnExecutionContext(ctx)

    // the underlying KV record should be gone
    const raw = await env.PB.getWithMetadata<PasteMetadata>(name)
    expect(raw.value).toBeNull()

    // the meta endpoint should also return 404 (covers getPasteMetadata's expired branch)
    expect((await workerFetch(ctx, addRole(url, "m"))).status).toStrictEqual(404)
  })
})

describe("pasteNameAvailable", () => {
  it("treats expired pastes as available so the same name can be reused", async () => {
    const ctx = createExecutionContext()

    vi.setSystemTime(new Date(2031, 0, 1))
    const customName = "reusable"
    await upload(ctx, { c: new Blob(["first"]), n: customName, e: "70" })

    // re-uploading immediately should conflict
    const conflictResp = await workerFetch(
      ctx,
      new Request(BASE_URL, {
        method: "POST",
        body: (() => {
          const fd = new FormData()
          fd.set("c", new Blob(["second"]))
          fd.set("n", customName)
          return fd
        })(),
      }),
    )
    expect(conflictResp.status).toStrictEqual(409)

    // after the original has expired, the same name should become available again
    vi.setSystemTime(new Date(2031, 0, 5))
    const reuseResp = await upload(ctx, { c: new Blob(["second"]), n: customName, e: "70" })
    expect(reuseResp.url.endsWith("/~" + customName)).toStrictEqual(true)
  })
})

describe("cleanExpiredInR2", () => {
  it("cleans up R2 objects without custom expiration metadata when their KV record is gone", async () => {
    const ctx = createExecutionContext()

    // write an R2 object directly with no customMetadata. This mimics legacy or in-flight MPU
    // objects whose expiration must be looked up from KV (the needKvLookup branch).
    const orphanKey = "~orphan_r2_object"
    await env.R2.put(orphanKey, "stale data")
    expect(await env.R2.head(orphanKey)).not.toBeNull()

    // also seed an R2-backed paste through the normal pipeline so we exercise the
    // customMetadata.willExpireAtUnix branch with an expired entry.
    vi.setSystemTime(new Date(2032, 0, 1))
    const big = genRandomBlob(parseSize(env.R2_THRESHOLD)! * 2)
    const seeded = await upload(ctx, { c: big, e: "70" })
    const seededName = seeded.url.slice(BASE_URL.length + 1)
    expect(await env.R2.head(seededName)).not.toBeNull()

    // jump far into the future and run the scheduled cleanup
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(2040, 0, 0) }), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(await env.R2.head(orphanKey)).toBeNull()
    expect(await env.R2.head(seededName)).toBeNull()
  })
})
