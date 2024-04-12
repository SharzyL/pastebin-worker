import { parseFormdata } from "../src/parseFormdata.js"
import { test, expect } from "vitest"

test("basic formdata", async () => {
  const boundary = "-----------------------------27048489924104183609341311243"
  const boundaryLine = `--${boundary}\r\n`

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
    boundaryLine + "--"

  const bodyBuffer = Buffer.from(fullBody, "utf-8")
  const parts = parseFormdata(bodyBuffer, boundary)

  // compare "c"
  const parsedContent = new TextDecoder().decode(parts.get("c").content)
  expect(parsedContent).toStrictEqual(content)
  expect(parts.get("c").fields["filename"]).toStrictEqual("a.py")

  // compare "s"
  const parsedSecret = new TextDecoder().decode(parts.get("s").content)
  expect(parsedSecret).toStrictEqual(secret)
})