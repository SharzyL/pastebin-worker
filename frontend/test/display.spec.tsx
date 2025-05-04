import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DisplayPaste } from "../pages/DisplayPaste.js"

import "@testing-library/jest-dom/vitest"
import { userEvent } from "@testing-library/user-event"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { encodeKey, encrypt, genKey } from "../utils/encryption.js"
import { stubBrowerFunctions, unStubBrowerFunctions } from "./testUtils.js"
import { APIUrl } from "../utils/utils.js"

describe("decrypt page", async () => {
  const scheme = "AES-GCM"
  const key = await genKey(scheme)
  const contentString = "abcedf"
  const content = new Uint8Array(new TextEncoder().encode(contentString))
  const encrypted = await encrypt(scheme, key, content)
  const server = setupServer(
    http.get(`${APIUrl}/abcd`, () => {
      return HttpResponse.arrayBuffer(encrypted.buffer, {
        headers: { "X-PB-Encryption-Scheme": "AES-GCM" },
      })
    }),
  )

  beforeAll(() => {
    stubBrowerFunctions()
    server.listen()
  })

  afterEach(() => {
    server.resetHandlers()
    cleanup()
  })

  afterAll(() => {
    unStubBrowerFunctions()
    server.close()
  })

  it("decrypt correctly", async () => {
    vi.stubGlobal("location", new URL(`https://example.com/e/abcd#${await encodeKey(key)}`))
    global.URL.createObjectURL = () => ""
    render(<DisplayPaste />)

    const main = screen.getByRole("main")
    await userEvent.click(main) // meaningless click, just ensure useEffect is done

    const document = screen.getByRole("article")
    expect(document.textContent).toStrictEqual(contentString)
  })
})
