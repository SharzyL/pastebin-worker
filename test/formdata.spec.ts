import { parseFormdata } from "../src/parseFormdata.js"
import { test, expect } from "vitest"

test("basic formdata", async () => {
  const boundary = "-----------------------------27048489924104183609341311243"
  const boundaryLine = `--${boundary}\r\n`
  const endLine = `--${boundary}--`

  const content = "print('Error 2\\n', omg, '\\n', theta, '\\n', expse3mat, '\\n', explogexpse3mat)\r\n" +
    "print('diff = ', np.max(np.abs(expse3mat - explogexpse3mat)))\r\n" +
    "break"

  const secret = "dgfadgfdgfd"
  const filename = "a.py"

  const fullBody =
    boundaryLine +
    `Content-Disposition: form-data; name="c"; filename="${filename}"\r\n\r\n` +
    content + "\r\n" +
    boundaryLine +
    "Content-Disposition: form-data; name=\"s\";\r\n\r\n" +
    secret + "\r\n" +
    endLine

  const bodyBuffer = Buffer.from(fullBody, "utf-8")
  const parts = parseFormdata(bodyBuffer, boundary)

  // compare "c"
  const c = parts.get("c")
  expect(c).toBeDefined()
  const parsedContent = new TextDecoder().decode(c!.content)
  expect(parsedContent).toStrictEqual(content)
  expect(c!.disposition["filename"]).toStrictEqual("a.py")

  // compare "s"
  const s = parts.get("s")
  expect(s).toBeDefined()
  const parsedSecret = new TextDecoder().decode(s!.content)
  expect(parsedSecret).toStrictEqual(secret)
})