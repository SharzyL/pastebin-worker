import { describe, it, vi, expect, beforeAll, afterEach, afterAll } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { PasteBin } from "../pages/PasteBin.js"

export const mockedPasteUpload: PasteResponse = {
  url: "https://example.com/abcd",
  manageUrl: "https://example.com/abcd:aaaaaaaaaaaaaaaaaa",
  expireAt: "2025-05-01T00:00:00.000Z",
  expirationSeconds: 300,
  lastModifiedAt: "2025-04-30T23:55:00.000Z",
  createdAt: "2025-04-30T23:55:00.000Z",
  sizeBytes: 9,
  location: "KV",
}

export const mockedPasteContent = "something"
export const mockedPasteMeta = {
  lastModifiedAt: mockedPasteUpload.lastModifiedAt,
  createdAt: mockedPasteUpload.createdAt,
  expireAt: mockedPasteUpload.expireAt,
  sizeBytes: mockedPasteUpload.sizeBytes,
  location: mockedPasteUpload.location,
}

export const server = setupServer(
  http.post(`${__WRANGLER_CONFIG__.DEPLOY_URL}/`, () => {
    return HttpResponse.json(mockedPasteUpload)
  }),
  http.head(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
    return new HttpResponse(null, {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Content-Length": String(new TextEncoder().encode(mockedPasteContent).length),
      },
    })
  }),
  http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
    return HttpResponse.text(mockedPasteContent)
  }),
  http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/m/abcd`, () => {
    return HttpResponse.json(mockedPasteMeta)
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

import "@testing-library/jest-dom/vitest"
import { userEvent } from "@testing-library/user-event"
import type { PasteResponse } from "../../shared/interfaces.js"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { stubBrowerFunctions, unStubBrowerFunctions } from "./testUtils.js"
import { encodeKey, encrypt, genKey } from "../utils/encryption.js"

describe("Pastebin", () => {
  it("can upload", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)

    const title = screen.getByText("Pastebin Worker")
    expect(title).toBeInTheDocument()

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    expect(editor).toBeInTheDocument()

    const submitter = screen.getByRole("button", { name: "Upload" })
    expect(submitter).toBeInTheDocument()
    expect(submitter).not.toBeEnabled()

    await userEvent.type(editor, "something")

    expect(submitter).toBeEnabled()
    await userEvent.click(submitter)

    await new Promise((resolve) => setTimeout(resolve, 1000))
    const urlShow = screen.getByRole("textbox", { name: "Raw URL" })
    expect((urlShow as HTMLInputElement).value).toStrictEqual(mockedPasteUpload.url)

    const manageUrlShow = screen.getByRole("textbox", { name: "Manage URL" })
    expect((manageUrlShow as HTMLInputElement).value).toStrictEqual(mockedPasteUpload.manageUrl)
  })

  it("refuse illegal settings", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)
    // due to bugs https://github.com/adobe/react-spectrum/discussions/8037, we need to use duplicated name here
    const expire = screen.getByRole("textbox", { name: "Expiration" })
    expect(expire).toBeValid()
    await userEvent.type(expire, "xxx")
    expect(expire).toBeInvalid()
  })
})

describe("Pastebin admin page", () => {
  it("renders admin page", async () => {
    vi.stubGlobal("location", new URL("https://example.com/abcd:xxxxxxxxx"))
    render(<PasteBin config={__WRANGLER_CONFIG__} />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    expect(editor).toBeInTheDocument()
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent))
  })

  it("decrypts encrypted admin text when the URL hash has the key", async () => {
    const key = await genKey("AES-GCM")
    const encodedKey = await encodeKey(key)
    const ciphertext = await encrypt("AES-GCM", key, new TextEncoder().encode(mockedPasteContent))
    vi.stubGlobal("location", new URL(`https://example.com/abcd:xxxxxxxxx#${encodedKey}`))
    server.use(
      http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/m/abcd`, () => {
        return HttpResponse.json({
          ...mockedPasteMeta,
          sizeBytes: ciphertext.length,
          highlightLanguage: "plaintext",
          encryptionScheme: "AES-GCM",
        })
      }),
      http.head(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(ciphertext.length),
            "X-PB-Encryption-Scheme": "AES-GCM",
            "X-PB-Decrypted-Content-Type": "text/plain;charset=UTF-8",
            "X-PB-Highlight-Language": "plaintext",
          },
        })
      }),
      http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
        return new HttpResponse(ciphertext, {
          headers: {
            "Content-Type": "application/octet-stream",
            "X-PB-Encryption-Scheme": "AES-GCM",
            "X-PB-Decrypted-Content-Type": "text/plain;charset=UTF-8",
          },
        })
      }),
    )

    render(<PasteBin config={__WRANGLER_CONFIG__} />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent))
    expect(screen.getByRole("checkbox", { name: "Client-side encryption" })).toBeChecked()
  })

  it("does not render encrypted admin text without the URL hash key", async () => {
    const key = await genKey("AES-GCM")
    const ciphertext = await encrypt("AES-GCM", key, new TextEncoder().encode(mockedPasteContent))
    vi.stubGlobal("location", new URL("https://example.com/abcd:xxxxxxxxx"))
    server.use(
      http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/m/abcd`, () => {
        return HttpResponse.json({
          ...mockedPasteMeta,
          sizeBytes: ciphertext.length,
          highlightLanguage: "plaintext",
          encryptionScheme: "AES-GCM",
        })
      }),
      http.head(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(ciphertext.length),
            "X-PB-Encryption-Scheme": "AES-GCM",
            "X-PB-Decrypted-Content-Type": "text/plain;charset=UTF-8",
            "X-PB-Highlight-Language": "plaintext",
          },
        })
      }),
    )

    render(<PasteBin config={__WRANGLER_CONFIG__} />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await screen.findByText("Decryption key required")
    expect((editor as HTMLTextAreaElement).value).toStrictEqual("")
    expect(screen.getByRole("checkbox", { name: "Client-side encryption" })).toBeChecked()
  })
})
