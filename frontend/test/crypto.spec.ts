import { describe, it, expect } from "vitest"
import { encrypt, decrypt, genKey, encodeKey, decodeKey } from "../utils/encryption.js"
import { genRandStr } from "../../worker/common.js"

function randArray(len: number): Uint8Array {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return arr
}

describe("encrypt with AES-GCM", () => {
  it("should decrypt to same message", async () => {
    const text = genRandStr(4096)
    const textBuffer = new TextEncoder().encode(text)

    const key = await genKey("AES-GCM")

    const ciphertext = await encrypt("AES-GCM", key, textBuffer)

    const decryptedBuffer = await decrypt("AES-GCM", key, ciphertext)
    expect(decryptedBuffer).not.toBeNull()

    const decrypted = new TextDecoder().decode(decryptedBuffer!)

    expect(decrypted).toStrictEqual(text)
  })

  it("should report decryption error", async () => {
    const text = genRandStr(4096)
    const textBuffer = new TextEncoder().encode(text)

    const key = await genKey("AES-GCM")
    const ciphertext = await encrypt("AES-GCM", key, textBuffer)

    ciphertext[1024] = (ciphertext[1024] + 1) % 256

    const decryptedBuffer = await decrypt("AES-GCM", key, ciphertext)
    expect(decryptedBuffer).toBeNull()
  })

  it("should encode and decode keys correctly", async () => {
    const key = await genKey("AES-GCM")
    const plaintext = randArray(2048)
    const ciphertext = await encrypt("AES-GCM", key, plaintext)

    for (let i = 0; i < 10; i++) {
      const encoded = await encodeKey(key)
      const decodedKey = await decodeKey("AES-GCM", encoded)

      const decryptedBuffer = await decrypt("AES-GCM", decodedKey, ciphertext)
      expect(decryptedBuffer).not.toBeNull()
      expect(decryptedBuffer!.length).toStrictEqual(plaintext.length)
      for (let i = 0; i < plaintext.length; i++) {
        expect(plaintext[i], `${i}-th bit of decrypted`).toStrictEqual(decryptedBuffer![i])
      }
    }
  })
})
