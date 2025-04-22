import { expect, test } from "vitest"
import { parsePath, ParsedPath, parseFilenameFromContentDisposition, parseExpiration } from "../src/shared"

test("parsePath", () => {
  const testPairs: [string, ParsedPath][] = [
    ["/abcd", { nameFromPath: "abcd" }],
    ["/abcd:1245", { nameFromPath: "abcd", passwd: "1245" }],
    ["/~abc", { nameFromPath: "~abc" }],
    ["/a/~abc", { nameFromPath: "~abc", role: "a" }],
    ["/abcd.jpg", { nameFromPath: "abcd", ext: ".jpg" }],
    ["/u/abcd.jpg", { nameFromPath: "abcd", ext: ".jpg", role: "u" }],
    ["/a/abcd/efg.jpg", { nameFromPath: "abcd", filename: "efg.jpg", ext: ".jpg", role: "a" }],
    ["/a/abcd/.jpg", { nameFromPath: "abcd", filename: ".jpg", ext: ".jpg", role: "a" }],
    ["/a/abcd/cef", { nameFromPath: "abcd", filename: "cef", role: "a" }],
    ["/a/abcd:xxxxxxxx/.jpg", { nameFromPath: "abcd", filename: ".jpg", ext: ".jpg", role: "a", passwd: "xxxxxxxx" }],
    ["/abcd:xxxxxxxx.jpg", { nameFromPath: "abcd", ext: ".jpg", passwd: "xxxxxxxx" }],
    ["/~abcd:xxxxxxxx.jpg", { nameFromPath: "~abcd", ext: ".jpg", passwd: "xxxxxxxx" }],
    ["/a/abcd:xxxxxxxx", { nameFromPath: "abcd", role: "a", passwd: "xxxxxxxx" }],
  ]

  for (const [input, output] of testPairs) {
    const parsed = parsePath(input)
    expect(parsed.nameFromPath, `checking nameFromPath of ${input}`).toStrictEqual(output.nameFromPath)
    expect(parsed.role, `checking role of ${input}`).toStrictEqual(output.role)
    expect(parsed.passwd, `checking passwd of ${input}`).toStrictEqual(output.passwd)
    expect(parsed.ext, `checking ext of ${input}`).toStrictEqual(output.ext)
    expect(parsed.filename, `checking filename of ${input}`).toStrictEqual(output.filename)
  }
})

test("parseFilenameFromContentDisposition", () => {
  const testPairs: [string, string][] = [
    [`inline; filename="abc.jpg"`, "abc.jpg"],
    [`inline; filename*=UTF-8''${encodeURIComponent("abc.jpg")}`, "abc.jpg"],
    [`inline; filename*=UTF-8''${encodeURIComponent("りんご")}`, "りんご"],
  ]
  for (const [input, output] of testPairs) {
    const parsed = parseFilenameFromContentDisposition(input)
    expect(parsed, `checking filename of ${input}`).toStrictEqual(output)
  }
})

test("parseExpiration", () => {
  const testPairs: [string, number | null][] = [
    ["100", 100],
    ["10.1", 10.1],
    ["10m", 600],
    ["10.0m", 600],
    ["10h", 10 * 60 * 60],
    ["10.0h", 10 * 60 * 60],
    ["10d", 10 * 24 * 60 * 60],
    ["10 d", 10 * 24 * 60 * 60],
    ["10  d", 10 * 24 * 60 * 60],
    ["10  ", 10],
    [" 10  ", 10],

    [" 10  g", null],
    ["10g", null],
    ["-10", null],
    ["-10d", null],
    ["10M", null],
    ["10Y", null],
    ["d", null],
  ]
  for (const [input, output] of testPairs) {
    const parsed = parseExpiration(input)
    expect(parsed, `checking expiration of ${input}`).toStrictEqual(output)
  }
})
