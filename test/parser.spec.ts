import { expect, test } from "vitest"
import {
  parsePath,
  ParsedPath,
  parseFilenameFromContentDisposition,
  parseExpiration,
  parseExpirationReadable,
} from "../src/shared"

test("parsePath", () => {
  const testPairs: [string, ParsedPath][] = [
    ["/abcd", { nameFromPath: "abcd" }],
    ["/abcd:1245", { nameFromPath: "abcd", passwd: "1245" }],
    ["/~abc", { nameFromPath: "~abc" }],
    ["/a/~abc", { nameFromPath: "~abc", role: "a" }],
    ["/abcd.jpg", { nameFromPath: "abcd", ext: ".jpg" }],
    ["/abcd.txt.jpg", { nameFromPath: "abcd", ext: ".txt.jpg" }],
    ["/u/abcd.jpg", { nameFromPath: "abcd", ext: ".jpg", role: "u" }],
    ["/a/abcd/efg.jpg", { nameFromPath: "abcd", filename: "efg.jpg", ext: ".jpg", role: "a" }],
    ["/a/abcd/efg.txt.jpg", { nameFromPath: "abcd", filename: "efg.txt.jpg", ext: ".txt.jpg", role: "a" }],
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
  const testPairs: [string, number | null, string | null][] = [
    ["1", 1, "1 second"],
    ["1m", 60, "1 minute"],
    ["0.5d", 12 * 60 * 60, "0.5 day"],
    ["100", 100, "100 seconds"],
    ["10.1", 10.1, "10.1 seconds"],
    ["10m", 600, "10 minutes"],
    ["10.0m", 600, "10 minutes"],
    ["10h", 10 * 60 * 60, "10 hours"],
    ["10.0h", 10 * 60 * 60, "10 hours"],
    ["10d", 10 * 24 * 60 * 60, "10 days"],
    ["10 d", 10 * 24 * 60 * 60, "10 days"],
    ["10  d", 10 * 24 * 60 * 60, "10 days"],
    ["10  ", 10, "10 seconds"],
    [" 10  ", 10, "10 seconds"],

    [" 10  g", null, null],
    ["10g", null, null],
    ["-10", null, null],
    ["-10d", null, null],
    ["10M", null, null],
    ["10Y", null, null],
    ["d", null, null],
  ]
  for (const [input, parsed, readableParsed] of testPairs) {
    const expiration = parseExpiration(input)
    expect(expiration, `checking expiration of ${input}`).toStrictEqual(parsed)

    const readable = parseExpirationReadable(input)
    expect(readable, `checking readable expiration of ${input}`).toStrictEqual(readableParsed)
  }
})
