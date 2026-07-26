import { CHAR_GEN } from "../shared/constants.js"
export { escapeHtml } from "../shared/encoding.js"

export function decode(buffer: ArrayBuffer | ArrayBufferView<ArrayBufferLike>): string {
  return new TextDecoder().decode(buffer)
}

export function btoa_utf8(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
}

export function atob_utf8(value: string): string {
  const value_latin1 = atob(value)
  return new TextDecoder("utf-8").decode(
    Uint8Array.from({ length: value_latin1.length }, (element, index) => value_latin1.charCodeAt(index)),
  )
}

export class WorkerError extends Error {
  public statusCode: number
  constructor(statusCode: number, msg: string) {
    super(msg)
    this.statusCode = statusCode
  }
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      ...init?.headers,
    },
  })
}

export function workerAssert(condition: boolean, msg: string): asserts condition {
  if (!condition) {
    throw new WorkerError(500, `Assertion failed: ${msg}`)
  }
}

export function dateToUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function genRandStr(length: number): string {
  const randomValues = new Uint32Array(length)
  crypto.getRandomValues(randomValues)

  let value = ""
  for (const randomValue of randomValues) {
    value += CHAR_GEN.charAt(randomValue % CHAR_GEN.length)
  }
  return value
}

// Workers extension to SubtleCrypto, mirrored from worker-configuration.d.ts.
// DOM lib's SubtleCrypto interface (from tsconfig "lib": ["dom"]) lacks this
// method, and the class declaration in worker-configuration.d.ts doesn't merge
// with it; a local interface augmentation makes the method visible.
declare global {
  interface SubtleCrypto {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean
  }
}

export function timingSafeEqual(a: string | undefined | null, b: string): boolean {
  if (a === undefined || a === null) return false
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  return crypto.subtle.timingSafeEqual(bufA, bufB)
}
