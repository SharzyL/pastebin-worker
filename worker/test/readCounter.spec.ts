import {
  createExecutionContext,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test"
import { describe, expect, it } from "vitest"
import type { MetaResponse } from "../../shared/interfaces.js"
import type { PasteMetadata } from "../storage/storage.js"
import { addRole, BASE_URL, upload, workerFetch } from "./testUtils.js"

describe("paste read counter", () => {
  it("removes its persisted state when the cleanup alarm runs", async () => {
    const stub = env.PASTE_READ_COUNTER.get(env.PASTE_READ_COUNTER.idFromName(`alarm-${crypto.randomUUID()}`))
    const response = await stub.fetch("https://paste-read-counter/init", {
      method: "POST",
      body: JSON.stringify({
        version: crypto.randomUUID(),
        remainingReads: 2,
        expiresAt: Date.now() + 60_000,
      }),
    })
    expect(response.ok).toStrictEqual(true)
    expect(await runInDurableObject(stub, (_, state) => state.storage.get("readState"))).toBeDefined()

    expect(await runDurableObjectAlarm(stub)).toStrictEqual(true)
    expect(await runInDurableObject(stub, (_, state) => state.storage.get("readState"))).toBeUndefined()
  })

  it("serializes concurrent final reads", async () => {
    const uploadContext = createExecutionContext()
    const paste = await upload(uploadContext, { c: "only once", reads: "1" })

    const firstContext = createExecutionContext()
    const secondContext = createExecutionContext()
    const responses = await Promise.all([workerFetch(firstContext, paste.url), workerFetch(secondContext, paste.url)])

    expect(responses.map((response) => response.status).sort()).toStrictEqual([200, 404])
    const successful = responses.find((response) => response.status === 200)!
    expect(successful.headers.get("X-PB-Remaining-Reads")).toStrictEqual("1")
    expect(await successful.text()).toStrictEqual("only once")

    await Promise.all([waitOnExecutionContext(firstContext), waitOnExecutionContext(secondContext)])
  })

  it("keeps the initial limit in KV and reports the live value from the Durable Object", async () => {
    const ctx = createExecutionContext()
    const paste = await upload(ctx, { c: "twice", reads: "2" })
    const pasteName = paste.url.slice(BASE_URL.length + 1)

    const first = await workerFetch(ctx, paste.url)
    expect(first.status).toStrictEqual(200)
    expect(first.headers.get("X-PB-Remaining-Reads")).toStrictEqual("2")

    const metadataResponse = await workerFetch(ctx, addRole(paste.url, "m"))
    const metadata = await metadataResponse.json<MetaResponse>()
    expect(metadata.remainingReads).toStrictEqual(1)

    const stored = await env.PB.getWithMetadata<PasteMetadata>(pasteName)
    expect(stored.metadata?.remainingReads).toStrictEqual(2)

    const second = await workerFetch(ctx, paste.url)
    expect(second.status).toStrictEqual(200)
    expect(second.headers.get("X-PB-Remaining-Reads")).toStrictEqual("1")
    expect((await workerFetch(ctx, paste.url)).status).toStrictEqual(404)
    await waitOnExecutionContext(ctx)
  })

  it("lazily initializes legacy read-limited metadata", async () => {
    const pasteName = "~legacy_read_counter"
    const nowUnix = Math.floor(Date.now() / 1000)
    const legacyMetadata: PasteMetadata = {
      schemaVersion: 1,
      location: "KV",
      passwd: "legacy-password",
      lastModifiedAtUnix: nowUnix,
      createdAtUnix: nowUnix,
      willExpireAtUnix: nowUnix + 3600,
      accessCounter: 0,
      remainingReads: 1,
      sizeBytes: 6,
    }
    await env.PB.put(pasteName, "legacy", {
      metadata: legacyMetadata,
      expiration: legacyMetadata.willExpireAtUnix,
    })

    const url = `${BASE_URL}/${pasteName}`
    const firstContext = createExecutionContext()
    const secondContext = createExecutionContext()
    const responses = await Promise.all([workerFetch(firstContext, url), workerFetch(secondContext, url)])

    expect(responses.map((response) => response.status).sort()).toStrictEqual([200, 404])
    expect(await responses.find((response) => response.status === 200)!.text()).toStrictEqual("legacy")
    await Promise.all([waitOnExecutionContext(firstContext), waitOnExecutionContext(secondContext)])
  })

  it("creates a fresh counter version when a paste is updated", async () => {
    const ctx = createExecutionContext()
    const paste = await upload(ctx, { c: "before", reads: "2" })

    expect((await workerFetch(ctx, paste.url)).status).toStrictEqual(200)
    const updated = await upload(ctx, { c: "after", reads: "3" }, { method: "PUT", url: paste.manageUrl })
    expect(updated.remainingReads).toStrictEqual(3)

    for (const expectedRemaining of ["3", "2", "1"]) {
      const response = await workerFetch(ctx, paste.url)
      expect(response.status).toStrictEqual(200)
      expect(response.headers.get("X-PB-Remaining-Reads")).toStrictEqual(expectedRemaining)
      expect(await response.text()).toStrictEqual("after")
    }
    expect((await workerFetch(ctx, paste.url)).status).toStrictEqual(404)
    await waitOnExecutionContext(ctx)
  })
})
