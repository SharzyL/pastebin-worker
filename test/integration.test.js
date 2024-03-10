// it is working-in-progress and not ready to be used

import fs from "fs"
import path from "path"
import assert from "assert"
import { Miniflare } from "miniflare"
import { FormData } from 'miniflare'

const workerScript = fs.readFileSync(path.resolve("dist/worker.js"), "utf8")
const localAddr = "http://localhost:8787"

describe("Test simple alert", async () => {
  let worker
  it("should load the script correctly", () => {
    worker = new Miniflare({
      scriptPath: "dist/worker.js",
      envPath: "test/test.env",
    })
  })

  it("should return a index page", async () => {
    const response = await worker.dispatchFetch(`${localAddr}`)
    assert.strictEqual(response.status, 200)
  })

  it("should return 404 for unknown path", async () => {
    const response = await worker.dispatchFetch(`${localAddr}/hello`)
    assert.strictEqual(response.status, 404)
  })

  // due to bugs in Miniflare Formdata API, developing tests with javascript
  // framework is suspended
})
