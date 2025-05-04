import { expect, test, describe, it, beforeEach, vi, afterEach } from "vitest"
import { addRole, upload, workerFetch } from "./testUtils"
import { createExecutionContext } from "cloudflare:test"
import { MetaResponse } from "../../shared/interfaces"
import { genRandStr } from "../common"

const testMd: string = `
# Header 1

This is the content of \`test.md\`

<script>
alert("Script should be removed")
</script>

## Header 2

| abc | defghi |
| :-: | -----: |
| bar |    baz |

**Bold**, \`Monospace\`, _Italics_, ~~Strikethrough~~, [URL](https://github.com)

- A
- A1
- A2
- B

![Panty](https://shz.al/~panty.jpg)

1. first
2. second

\`\`\`js
(!+[]+[]+![]).length
\`\`\`

> Quotation

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} = \\sqrt{\\pi}
$$
`

test("markdown with role a", async () => {
  const ctx = createExecutionContext()
  const url = (await upload(ctx, { c: testMd })).url

  const revisitResponse = await workerFetch(ctx, addRole(url, "a"))
  expect(revisitResponse.status).toStrictEqual(200)
  expect(revisitResponse.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
  const responseHtml = await revisitResponse.text()
  expect(responseHtml.indexOf("<title>Header 1</title>")).toBeGreaterThan(-1)
  expect(responseHtml.indexOf('<code class="language-js">')).toBeGreaterThan(-1)

  const bigMd = "1".repeat(1024 * 1024)
  const bigUrl = (await upload(ctx, { c: bigMd })).url
  const bigResp = await (await workerFetch(ctx, addRole(bigUrl, "a"))).text()
  expect(bigResp.indexOf("Untitled")).toBeGreaterThan(-1)
})

test("meta with role m", async () => {
  beforeEach(vi.useFakeTimers)
  afterEach(vi.useRealTimers)
  const t1 = new Date(2035, 0, 0)
  vi.setSystemTime(t1)

  const content = `# Hello`
  const ctx = createExecutionContext()
  const uploadResp = await upload(ctx, { c: content })
  expect(new Date(uploadResp.expireAt).getTime()).toStrictEqual(t1.getTime() + uploadResp.expirationSeconds * 1000)
  const url = uploadResp.url

  const metaResponse = await workerFetch(ctx, addRole(url, "m"))
  expect(metaResponse.status).toStrictEqual(200)
  expect(metaResponse.headers.get("Content-Type")).toStrictEqual("application/json;charset=UTF-8")
  const meta: MetaResponse = await metaResponse.json()

  expect(meta.location).toStrictEqual("KV")
  expect(meta.filename).toBeUndefined()
  expect(new Date(meta.lastModifiedAt).getTime()).toStrictEqual(t1.getTime())
  expect(new Date(meta.createdAt).getTime()).toStrictEqual(t1.getTime())

  const t2 = new Date(2035, 0, 1)
  vi.setSystemTime(t2)
  const updateResp = await upload(ctx, { c: content, e: "1d" }, { method: "PUT", url: uploadResp.manageUrl })
  expect(new Date(updateResp.expireAt).getTime()).toStrictEqual(t2.getTime() + updateResp.expirationSeconds * 1000)
  const updatedMeta: MetaResponse = await (await workerFetch(ctx, addRole(url, "m"))).json()
  expect(new Date(updatedMeta.lastModifiedAt).getTime()).toStrictEqual(t2.getTime())
  expect(new Date(updatedMeta.createdAt).getTime()).toStrictEqual(t1.getTime())
})

describe("url redirect with role u", () => {
  const ctx = createExecutionContext()
  it("should redirect", async () => {
    const contentUrl = "https://example.com:1234/abc-def?g=hi&jk=l"
    const uploadResp = await upload(ctx, { c: contentUrl })
    const url = uploadResp.url

    const resp = await workerFetch(ctx, addRole(url, "u"))
    expect(resp.status).toStrictEqual(302)
    expect(resp.headers.get("location")).toStrictEqual(contentUrl)
  })

  it("should refuse illegal url", async () => {
    const contentUrl = "xxxx"
    const uploadResp = await upload(ctx, { c: contentUrl })
    const url = uploadResp.url

    const resp = await workerFetch(ctx, addRole(url, "u"))
    expect(resp.status).toStrictEqual(400)
  })

  it("should refuse overlong url", async () => {
    const contentUrl = genRandStr(4096)
    const uploadResp = await upload(ctx, { c: contentUrl })
    const url = uploadResp.url

    const resp = await workerFetch(ctx, addRole(url, "u"))
    expect(resp.status).toStrictEqual(400)
  })
})
