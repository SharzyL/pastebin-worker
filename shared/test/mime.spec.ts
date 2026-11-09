import { describe, expect, it } from "vitest"
import { isDocumentMime, isPlainMedia, mimeEssence, PLAIN_TEXT_MIME, sanitizeMime } from "../mime.js"

describe("mimeEssence", () => {
  it("lowercases and drops parameters", () => {
    expect(mimeEssence("TEXT/HTML; charset=utf-8")).toBe("text/html")
    expect(mimeEssence("  image/svg+xml ")).toBe("image/svg+xml")
  })
  it("rejects what is not type/subtype", () => {
    for (const m of ["", "random-mime", "text/", "/html", "text/html/x", "text html", "text/ht ml"]) {
      expect(mimeEssence(m), m).toBeNull()
    }
  })
})

describe("sanitizeMime", () => {
  const disallowed = ["audio/x-mpegurl"]
  it("keeps well-formed types with their parameters", () => {
    expect(sanitizeMime("text/html", disallowed)).toBe("text/html")
    expect(sanitizeMime(" text/plain;charset=gbk ", disallowed)).toBe("text/plain;charset=gbk")
  })
  it("replaces malformed, disallowed and header-unsafe values", () => {
    expect(sanitizeMime("random-mime", disallowed)).toBe(PLAIN_TEXT_MIME)
    expect(sanitizeMime("Audio/X-MPEGURL;foo", disallowed)).toBe(PLAIN_TEXT_MIME)
    expect(sanitizeMime("text/plain;x=\r\nX-Injected: 1", disallowed)).toBe(PLAIN_TEXT_MIME)
    expect(sanitizeMime("text/plain;x=é", disallowed)).toBe(PLAIN_TEXT_MIME)
  })
})

describe("mime classes", () => {
  it("tells document types", () => {
    for (const m of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "text/xml",
      "application/xml",
      "application/rss+xml",
    ]) {
      expect(isDocumentMime(m), m).toBe(true)
    }
    for (const m of ["text/plain", "image/png", "application/json", "application/octet-stream"]) {
      expect(isDocumentMime(m), m).toBe(false)
    }
  })
  it("tells plain media, which is never a document", () => {
    for (const m of ["image/png", "audio/mpeg", "video/mp4", "font/woff2", "application/pdf"]) {
      expect(isPlainMedia(m), m).toBe(true)
      expect(isDocumentMime(m), m).toBe(false)
    }
    for (const m of ["image/svg+xml", "text/plain", "text/html", "application/octet-stream"]) {
      expect(isPlainMedia(m), m).toBe(false)
    }
  })
})
