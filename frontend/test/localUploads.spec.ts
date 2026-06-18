import { afterEach, describe, expect, it, vi } from "vitest"
import { LOCAL_UPLOADS_KEY, readLocalUploads } from "../utils/localUploads.js"
import type { LocalUploadRecord } from "../utils/localUploads.js"

function record(overrides: Partial<LocalUploadRecord> = {}): LocalUploadRecord {
  return {
    key: "abcd",
    displayUrl: "https://example.com/d/abcd",
    manageUrl: "https://example.com/abcd:password",
    expireAt: "2026-06-18T12:00:00.000Z",
    sizeBytes: 12,
    ...overrides,
  }
}

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe("local uploads", () => {
  it("filters expired records and writes the active list back", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-18T12:00:00.000Z"))
    const active = record({ key: "active", expireAt: "2026-06-18T12:00:01.000Z" })
    const expired = record({ key: "expired", expireAt: "2026-06-18T11:59:59.000Z" })
    localStorage.setItem(LOCAL_UPLOADS_KEY, JSON.stringify([active, expired]))

    expect(readLocalUploads()).toStrictEqual([active])
    expect(JSON.parse(localStorage.getItem(LOCAL_UPLOADS_KEY)!)).toStrictEqual([active])
  })
})
