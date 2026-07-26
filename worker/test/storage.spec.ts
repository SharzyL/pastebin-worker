import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test"
import { addRole, BASE_URL, genRandomBlob, upload, workerFetch } from "./testUtils.js"
import worker from "../index.js"
import { parseSize } from "../../shared/parsers.js"
import {
  allocateRandomPasteName,
  cleanExpiredInR2,
  discardPasteRecord,
  getPasteMetadata,
  getPasteRecord,
  openPasteBody,
  type PasteMetadata,
} from "../storage/storage.js"

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

describe("paste record body opening", () => {
  const metadata = (location: "KV" | "R2"): PasteMetadata => ({
    schemaVersion: 1,
    location,
    passwd: "password",
    lastModifiedAtUnix: 1,
    createdAtUnix: 1,
    willExpireAtUnix: Number.MAX_SAFE_INTEGER,
    accessCounter: 0,
    sizeBytes: 5,
  })

  it("defers R2 GET until the record body is opened", async () => {
    const r2Body = new Response("hello").body!
    const unusedKvBody = new Response("").body!
    const cancel = vi.spyOn(unusedKvBody, "cancel")
    const getWithMetadata = vi.fn().mockResolvedValue({
      value: unusedKvBody,
      metadata: metadata("R2"),
    })
    const get = vi.fn().mockResolvedValue({ body: r2Body, httpEtag: '"etag"' })
    const testEnv = { PB: { getWithMetadata }, R2: { get } } as unknown as Env
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext
    const random = vi.spyOn(Math, "random").mockReturnValue(1)

    const record = await getPasteRecord(testEnv, "paste", ctx)
    expect(record).not.toBeNull()
    expect(getWithMetadata).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()

    const body = await openPasteBody(testEnv, "paste", record!, ctx)
    expect(get).toHaveBeenCalledOnce()
    expect(body?.httpEtag).toStrictEqual('"etag"')
    expect(await new Response(body!.paste).text()).toStrictEqual("hello")
    random.mockRestore()
  })

  it("cancels the body returned by metadata-only KV reads", async () => {
    const unusedBody = new Response("unused").body!
    const cancel = vi.spyOn(unusedBody, "cancel")
    const getWithMetadata = vi.fn().mockResolvedValue({
      value: unusedBody,
      metadata: metadata("R2"),
    })
    const testEnv = { PB: { getWithMetadata } } as unknown as Env

    await expect(getPasteMetadata(testEnv, "paste")).resolves.toMatchObject({ location: "R2" })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("reuses the KV stream returned with metadata", async () => {
    const getWithMetadata = vi.fn().mockResolvedValue({
      value: new Response("hello").body,
      metadata: metadata("KV"),
    })
    const testEnv = { PB: { getWithMetadata } } as unknown as Env
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext
    const random = vi.spyOn(Math, "random").mockReturnValue(1)

    const record = await getPasteRecord(testEnv, "paste", ctx)
    const body = await openPasteBody(testEnv, "paste", record!, ctx)

    expect(getWithMetadata).toHaveBeenCalledOnce()
    expect(await new Response(body!.paste).text()).toStrictEqual("hello")
    random.mockRestore()
  })

  it("cancels an unopened KV body exactly once when its record is discarded", async () => {
    const unusedBody = new Response("unused").body!
    const cancel = vi.spyOn(unusedBody, "cancel")
    const record = { metadata: metadata("KV"), kvBody: unusedBody }

    await discardPasteRecord(record)
    await discardPasteRecord(record)

    expect(cancel).toHaveBeenCalledOnce()
    expect(record.kvBody).toBeNull()
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

  it("retries generated names that are already active", async () => {
    const getWithMetadata = vi
      .fn()
      .mockResolvedValueOnce({
        value: "taken",
        metadata: { willExpireAtUnix: Number.MAX_SAFE_INTEGER },
      })
      .mockResolvedValueOnce({ value: null, metadata: null })
    const generateName = vi.fn().mockReturnValueOnce("aaaaaa").mockReturnValueOnce("bbbbbb")
    const testEnv = { PB: { getWithMetadata } } as unknown as Env

    await expect(allocateRandomPasteName(testEnv, 6, { generateName })).resolves.toStrictEqual("bbbbbb")
    expect(generateName).toHaveBeenCalledTimes(2)
    expect(getWithMetadata).toHaveBeenNthCalledWith(1, "aaaaaa")
    expect(getWithMetadata).toHaveBeenNthCalledWith(2, "bbbbbb")
  })

  it("fails instead of overwriting after exhausting random name attempts", async () => {
    const getWithMetadata = vi.fn().mockResolvedValue({
      value: "taken",
      metadata: { willExpireAtUnix: Number.MAX_SAFE_INTEGER },
    })
    const testEnv = { PB: { getWithMetadata } } as unknown as Env

    await expect(
      allocateRandomPasteName(testEnv, 6, { maxAttempts: 2, generateName: () => "aaaaaa" }),
    ).rejects.toMatchObject({ statusCode: 503 })
    expect(getWithMetadata).toHaveBeenCalledTimes(2)
  })
})

describe("cleanExpiredInR2", () => {
  it("limits legacy KV metadata lookups to 32 concurrent requests", async () => {
    let active = 0
    let maxActive = 0
    let releaseLookups!: () => void
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookups = resolve
    })
    const objects = Array.from({ length: 70 }, (_, index) => ({ key: `legacy-${index}` }))
    const getWithMetadata = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await lookupGate
      active -= 1
      return { value: null, metadata: null }
    })
    const remove = vi.fn(() => Promise.resolve())
    const testEnv = {
      PB: { getWithMetadata },
      R2: {
        list: vi.fn(() => Promise.resolve({ objects, truncated: false })),
        delete: remove,
      },
    } as unknown as Env

    const cleaning = cleanExpiredInR2(testEnv, createScheduledController({ scheduledTime: new Date(2040, 0, 1) }))
    await Promise.resolve()
    await Promise.resolve()
    expect(active).toStrictEqual(32)
    expect(maxActive).toStrictEqual(32)

    releaseLookups()
    await cleaning
    expect(getWithMetadata).toHaveBeenCalledTimes(70)
    expect(remove).toHaveBeenCalledWith(objects.map((object) => object.key))
  })

  it("deletes expired objects page by page instead of retaining every key", async () => {
    const operations: string[] = []
    const list = vi
      .fn()
      .mockImplementationOnce(() => {
        operations.push("list:first")
        return Promise.resolve({
          objects: [{ key: "expired-a", customMetadata: { willExpireAtUnix: "1" } }],
          truncated: true,
          cursor: "next",
        })
      })
      .mockImplementationOnce(() => {
        operations.push("list:second")
        return Promise.resolve({
          objects: [{ key: "expired-b", customMetadata: { willExpireAtUnix: "1" } }],
          truncated: false,
        })
      })
    const remove = vi.fn((keys: string[]) => {
      operations.push(`delete:${keys.join(",")}`)
      return Promise.resolve()
    })
    const testEnv = {
      R2: { list, delete: remove },
    } as unknown as Env

    await cleanExpiredInR2(testEnv, createScheduledController({ scheduledTime: new Date(2040, 0, 1) }))

    expect(operations).toStrictEqual(["list:first", "delete:expired-a", "list:second", "delete:expired-b"])
  })

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
