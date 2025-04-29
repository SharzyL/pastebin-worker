export type EncryptionScheme = "AES-GCM"

function concat(buffer1: Uint8Array, buffer2: Uint8Array): Uint8Array {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength)
  tmp.set(new Uint8Array(buffer1), 0)
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength)
  return tmp
}

function base64VariantEncode(src: Uint8Array): string {
  // we use a variant of base64 that replaces "/" with "_" and removes trailing padding
  const uint8Array = new Uint8Array(src)
  let binaryString = ""
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i])
  }
  return btoa(binaryString).replaceAll("/", "_")
}

function base64VariantDecode(src: string): Uint8Array {
  const binaryString = atob(src.replaceAll("_", "/").replaceAll(/[^a-zA-Z0-9+/]/g, ""))
  const uint8Array = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i)
  }
  return uint8Array
}

export async function genKey(scheme: EncryptionScheme): Promise<CryptoKey> {
  if (scheme === "AES-GCM") {
    return await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
  }
  throw new Error(`Unsupported encryption scheme: ${scheme as string}`)
}

export async function encrypt(scheme: EncryptionScheme, key: CryptoKey, msg: Uint8Array): Promise<Uint8Array> {
  if (scheme === "AES-GCM") {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, msg)
    return concat(iv, new Uint8Array(ciphertext))
  }
  throw new Error(`Unsupported encryption scheme: ${scheme as string}`)
}

export async function decrypt(
  scheme: EncryptionScheme,
  key: CryptoKey,
  ciphertext: Uint8Array,
): Promise<Uint8Array | null> {
  if (scheme === "AES-GCM") {
    const iv = ciphertext.slice(0, 12)
    const trueCiphertext = ciphertext.slice(12)
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, trueCiphertext))
    } catch {
      return null
    }
  }
  throw new Error(`Unsupported encryption scheme: ${scheme as string}`)
}

export async function encodeKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key))
  return base64VariantEncode(raw)
}

export async function decodeKey(scheme: EncryptionScheme, key: string): Promise<CryptoKey> {
  if (scheme === "AES-GCM") {
    return await crypto.subtle.importKey("raw", base64VariantDecode(key), "AES-GCM", true, ["encrypt", "decrypt"])
  }
  throw new Error(`Unsupported encryption scheme: ${scheme as string}`)
}
