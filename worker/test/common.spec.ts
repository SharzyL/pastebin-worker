import { describe, it, expect } from "vitest"

import { timingSafeEqual } from "../common.js"

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("hunter2", "hunter2")).toBe(true)
  })

  it("returns false for strings of equal length but different content", () => {
    expect(timingSafeEqual("aaaa", "aaab")).toBe(false)
    expect(timingSafeEqual("abcd", "wxyz")).toBe(false)
  })

  it("returns false for strings of different length", () => {
    expect(timingSafeEqual("short", "longer-string")).toBe(false)
    expect(timingSafeEqual("longer-string", "short")).toBe(false)
  })

  it("returns false when first argument is undefined or null", () => {
    expect(timingSafeEqual(undefined, "secret")).toBe(false)
    expect(timingSafeEqual(null, "secret")).toBe(false)
  })

  it("returns true for two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true)
  })

  it("returns false when only one side is empty", () => {
    expect(timingSafeEqual("", "secret")).toBe(false)
    expect(timingSafeEqual("secret", "")).toBe(false)
  })

  it("compares UTF-8 strings by byte content", () => {
    expect(timingSafeEqual("café", "café")).toBe(true)
    expect(timingSafeEqual("café", "cafe")).toBe(false)
    expect(timingSafeEqual("日本語", "日本語")).toBe(true)
    expect(timingSafeEqual("日本語", "日本誤")).toBe(false)
  })
})
