import { CHAR_GEN } from "../shared/constants.js"

export function decode(arrayBuffer: ArrayBuffer): string {
  return new TextDecoder().decode(arrayBuffer)
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

export function workerAssert(condition: boolean, msg: string): asserts condition {
  if (!condition) {
    throw new WorkerError(500, `Assertion failed: ${msg}`)
  }
}

export function dateToUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function genRandStr(len: number) {
  // TODO: switch to Web Crypto random generator
  let str = ""
  const numOfRand = CHAR_GEN.length
  for (let i = 0; i < len; i++) {
    str += CHAR_GEN.charAt(Math.floor(Math.random() * numOfRand))
  }
  return str
}

export function escapeHtml(str: string): string {
  const tagsToReplace: Map<string, string> = new Map([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot"],
    ["'", "&#x27"],
  ])
  return str.replace(/[&<>"']/g, function (tag): string {
    return tagsToReplace.get(tag) || tag
  })
}

export function isLegalUrl(url: string): boolean {
  return URL.canParse(url)
}
