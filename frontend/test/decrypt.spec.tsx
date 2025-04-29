import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DecryptPaste } from "../components/DecryptPaste.js"

import "@testing-library/jest-dom/vitest"
import { userEvent } from "@testing-library/user-event"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { encodeKey, encrypt, genKey } from "../utils/encryption.js"

describe("decrypt page", async () => {
  const scheme = "AES-GCM"
  const key = await genKey(scheme)
  const contentString = "abcedf"
  const content = new Uint8Array(new TextEncoder().encode(contentString))
  const encrypted = await encrypt(scheme, key, content)
  const server = setupServer(
    http.get("/abcd", () => {
      return HttpResponse.arrayBuffer(encrypted.buffer)
    }),
  )

  beforeAll(() => {
    server.listen()
  })

  afterEach(() => {
    server.resetHandlers()
    cleanup()
  })

  afterAll(() => {
    server.close()
  })

  it("decrypt correctly", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      enumerable: true,
      value: new URL(`https://example.com/e/abcd#${await encodeKey(key)}`),
    })
    global.URL.createObjectURL = () => ""
    render(<DecryptPaste />)

    const main = screen.getByRole("main")
    await userEvent.click(main) // meaningless click, just ensure useEffect is done

    const document = screen.getByRole("article")
    expect(document.textContent).toStrictEqual(contentString)
  })
})
