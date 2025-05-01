import { expect, test, it, describe } from "vitest"
import { addRole, genRandomBlob, upload, workerFetch } from "./testUtils"
import { createExecutionContext } from "cloudflare:test"

test("HEAD", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // upload
  const responseJson = await upload(ctx, { c: blob1 })

  // test head
  const headResp = await workerFetch(
    ctx,
    new Request(responseJson.url, {
      method: "HEAD",
    }),
  )
  expect(headResp.status).toStrictEqual(200)
  expect(headResp.headers.get("Content-Type")).toStrictEqual("text/plain;charset=UTF-8")
  expect(headResp.headers.get("Content-Length")).toStrictEqual(blob1.size.toString())
  expect(headResp.headers.has("Last-Modified")).toStrictEqual(true)
  expect(headResp.headers.get("Content-Disposition")).toStrictEqual("inline")

  // test head with filename and big blog
  const blob2 = genRandomBlob(1024 * 1024)
  const responseJson1 = await upload(ctx, { c: { filename: "abc", content: blob2 } })
  const headResp1 = await workerFetch(
    ctx,
    new Request(responseJson1.url + "/a.jpg", {
      method: "HEAD",
    }),
  )
  expect(headResp1.status).toStrictEqual(200)
  expect(headResp1.headers.get("Content-Type")).toStrictEqual("image/jpeg")
  expect(headResp1.headers.get("Content-Length")).toStrictEqual(blob2.size.toString())
  expect(headResp1.headers.has("Last-Modified")).toStrictEqual(true)
  expect(headResp1.headers.get("Content-Disposition")).toStrictEqual("inline; filename*=UTF-8''a.jpg")
})

describe("HEAD with URL", () => {
  const ctx = createExecutionContext()
  it("should redirect for HEAD", async () => {
    const contentUrl = "https://example.com:1234/abc-def?g=hi&jk=l"
    const responseJson = await upload(ctx, { c: contentUrl })
    const headResp = await workerFetch(
      ctx,
      new Request(addRole(responseJson.url, "u"), {
        method: "HEAD",
      }),
    )
    expect(headResp.status).toStrictEqual(302)
    expect(headResp.headers.get("location")).toStrictEqual(contentUrl)
  })
})
