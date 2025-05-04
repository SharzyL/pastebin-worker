import { expect, test } from "vitest"
import {
  parsePath,
  ParsedPath,
  parseFilenameFromContentDisposition,
  parseExpiration,
  parseExpirationReadable,
} from "../parsers.js"

test("parsePath", () => {
  const testPairs: [string, ParsedPath][] = [
    ["/abcd", { name: "abcd" }],
    ["/abcd:1245", { name: "abcd", password: "1245" }],
    ["/~abc", { name: "~abc" }],
    ["/a/~abc", { name: "~abc", role: "a" }],
    ["/abcd.jpg", { name: "abcd", ext: ".jpg" }],
    ["/abcd.txt.jpg", { name: "abcd", ext: ".txt.jpg" }],
    ["/u/abcd.jpg", { name: "abcd", ext: ".jpg", role: "u" }],
    ["/a/abcd/efg.jpg", { name: "abcd", filename: "efg.jpg", ext: ".jpg", role: "a" }],
    ["/a/abcd/efg.txt.jpg", { name: "abcd", filename: "efg.txt.jpg", ext: ".txt.jpg", role: "a" }],
    ["/a/abcd/.jpg", { name: "abcd", filename: ".jpg", ext: ".jpg", role: "a" }],
    ["/a/abcd/cef", { name: "abcd", filename: "cef", role: "a" }],
    ["/a/abcd:xxxxxxxx/.jpg", { name: "abcd", filename: ".jpg", ext: ".jpg", role: "a", password: "xxxxxxxx" }],
    ["/abcd:xxxxxxxx.jpg", { name: "abcd", ext: ".jpg", password: "xxxxxxxx" }],
    ["/~abcd:xxxxxxxx.jpg", { name: "~abcd", ext: ".jpg", password: "xxxxxxxx" }],
    ["/a/abcd:xxxxxxxx", { name: "abcd", role: "a", password: "xxxxxxxx" }],
  ]

  for (const [input, output] of testPairs) {
    const parsed = parsePath(input)
    expect(parsed.name, `checking nameFromPath of ${input}`).toStrictEqual(output.name)
    expect(parsed.role, `checking role of ${input}`).toStrictEqual(output.role)
    expect(parsed.password, `checking passwd of ${input}`).toStrictEqual(output.password)
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

    ["1.1.1 d", null, null],
  ]
  for (const [input, parsed, readableParsed] of testPairs) {
    const expiration = parseExpiration(input)
    expect(expiration, `checking expiration of ${input}`).toStrictEqual(parsed)

    const readable = parseExpirationReadable(input)
    expect(readable, `checking readable expiration of ${input}`).toStrictEqual(readableParsed)
  }
})
