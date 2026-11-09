import { describe, expect, it } from "vitest"
import { verifyEncryptionScheme, verifyHighlightLanguage } from "../verify.js"

describe("verifyEncryptionScheme", () => {
  it("accepts only known schemes", () => {
    expect(verifyEncryptionScheme("AES-GCM")[0]).toBe(true)
    for (const s of ["", "aes-gcm", "ROT13", "AES-GCM\r\nX: 1", "AES-GCM "]) {
      expect(verifyEncryptionScheme(s)[0], JSON.stringify(s)).toBe(false)
    }
  })
})

describe("verifyHighlightLanguage", () => {
  it("accepts language names and an empty value", () => {
    for (const l of ["", "js", "c++", "objective-c", "f#", "asp.net", "x86asm", "plaintext", "a".repeat(64)]) {
      expect(verifyHighlightLanguage(l)[0], l).toBe(true)
    }
  })
  it("rejects anything that is not a name", () => {
    for (const l of ["js\r\nX: 1", "js\n", " js", "<script>", "a/b", "a b", "a".repeat(65), "é"]) {
      expect(verifyHighlightLanguage(l)[0], JSON.stringify(l)).toBe(false)
    }
  })
})
