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
        "Content-Type": TEXT_MIME_TYPE,
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
  window.localStorage.clear()
  cleanup()
})

afterAll(() => {
  unStubBrowerFunctions()
  server.close()
})

import "@testing-library/jest-dom/vitest"
import { userEvent } from "@testing-library/user-event"
import type { PasteResponse, PublicEnv } from "../../shared/interfaces.js"
import { BINARY_MIME_TYPE, TEXT_MIME_TYPE } from "../../shared/constants.js"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { stubBrowerFunctions, unStubBrowerFunctions } from "./testUtils.js"
import { encodeKey, encrypt, genKey } from "../utils/encryption.js"
import { LOCAL_UPLOADS_KEY } from "../utils/localUploads.js"

const pasteConfig = {
  ...__WRANGLER_CONFIG__,
  DEFAULT_P2P_TRANSFER: false,
} satisfies PublicEnv

describe("Pastebin", () => {
  it("can upload", async () => {
    render(<PasteBin config={pasteConfig} />)

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

  it("enables a normal update only after the uploaded content or settings change", async () => {
    server.use(
      http.post(`${pasteConfig.DEPLOY_URL}/`, () =>
        HttpResponse.json({
          ...mockedPasteUpload,
          url: `${pasteConfig.DEPLOY_URL}/abcd`,
          manageUrl: `${pasteConfig.DEPLOY_URL}/abcd:aaaaaaaaaaaaaaaaaa`,
        }),
      ),
      http.put(`${pasteConfig.DEPLOY_URL}/abcd:aaaaaaaaaaaaaaaaaa`, () =>
        HttpResponse.json({
          ...mockedPasteUpload,
          url: `${pasteConfig.DEPLOY_URL}/abcd`,
          manageUrl: `${pasteConfig.DEPLOY_URL}/abcd:aaaaaaaaaaaaaaaaaa`,
        }),
      ),
    )
    render(<PasteBin config={pasteConfig} />)
    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await userEvent.type(editor, "something")
    await userEvent.click(screen.getByRole("button", { name: "Upload" }))

    const update = await screen.findByRole("button", { name: "Update" })
    expect(update).toBeDisabled()
    await new Promise((resolve) => setTimeout(resolve, 1000))

    await userEvent.type(editor, " changed")
    expect(screen.getByRole("textbox", { name: "Paste editor" })).toHaveValue("something changed")
    await waitFor(() => expect(screen.getByRole("button", { name: "Update" })).toBeEnabled())
    await userEvent.click(update)
    await waitFor(() => expect(screen.getByRole("button", { name: "Update" })).toBeDisabled())
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const expiration = screen
      .getAllByRole("textbox", { name: "Expiration" })
      .find((element) => !element.hasAttribute("readonly"))!
    await userEvent.clear(expiration)
    await userEvent.type(expiration, "2h")
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled()
  })

  it("shows remaining reads in the local uploads sidebar", async () => {
    server.use(
      http.post(`${__WRANGLER_CONFIG__.DEPLOY_URL}/`, () => {
        return HttpResponse.json({
          ...mockedPasteUpload,
          expireAt: "2099-05-01T00:00:00.000Z",
          remainingReads: 1,
        })
      }),
    )
    render(<PasteBin config={pasteConfig} />)

    await userEvent.type(screen.getByRole("textbox", { name: "Paste editor" }), "something")
    await userEvent.click(screen.getByRole("button", { name: "Upload" }))

    expect(await screen.findByText(/or 1 read/)).toBeInTheDocument()
  })

  it("refuse illegal settings", async () => {
    render(<PasteBin config={pasteConfig} />)
    // due to bugs https://github.com/adobe/react-spectrum/discussions/8037, we need to use duplicated name here
    const expire = screen.getByRole("textbox", { name: "Expiration" })
    expect(expire).toBeValid()
    await userEvent.type(expire, "xxx")
    expect(expire).toBeInvalid()
  })

  it("uses DEFAULT_READS as the initial reads setting", () => {
    render(<PasteBin config={{ ...pasteConfig, DEFAULT_READS: 2 }} />)

    const reads = screen.getByRole("spinbutton", { name: "Reads" })
    expect(reads).toBeValid()
    expect(reads).toHaveValue(2)
  })

  it.each([
    ["edit", "Paste editor"],
    ["file", "Select file"],
  ] as const)("uses DEFAULT_TAB=%s as the initial input tab", (defaultTab, panelName) => {
    render(<PasteBin config={{ ...pasteConfig, DEFAULT_TAB: defaultTab }} />)

    expect(screen.getByRole(defaultTab === "edit" ? "textbox" : "button", { name: panelName })).toBeInTheDocument()
  })

  it("uses DEFAULT_P2P_TRANSFER as the initial P2P setting", () => {
    render(<PasteBin config={{ ...__WRANGLER_CONFIG__, DEFAULT_P2P_TRANSFER: true }} />)

    expect(screen.getByRole("checkbox", { name: "P2P transfer" })).toBeChecked()
    expect(screen.getByRole("button", { name: "Start P2P" })).toBeInTheDocument()
  })

  it("describes a single P2P transfer as stop after transfer", () => {
    render(<PasteBin config={{ ...__WRANGLER_CONFIG__, DEFAULT_P2P_TRANSFER: true, DEFAULT_P2P_TRANSFERS: 1 }} />)

    expect(screen.getByRole("spinbutton", { name: "Transfers" })).toHaveValue(1)
    expect(screen.getByText("Stop after transfer")).toBeInTheDocument()
  })

  it("clears current manage state when another tab removes the local upload", async () => {
    render(<PasteBin config={pasteConfig} />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await userEvent.type(editor, "something")
    await userEvent.click(screen.getByRole("button", { name: "Upload" }))

    await screen.findByRole("textbox", { name: "Raw URL" })
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument()

    window.localStorage.setItem(LOCAL_UPLOADS_KEY, "[]")
    window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_UPLOADS_KEY, newValue: "[]" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument()
      expect(screen.queryByRole("textbox", { name: "Manage URL" })).not.toBeInTheDocument()
    })
  })
})

describe("Pastebin admin page", () => {
  it("renders admin page", async () => {
    vi.stubGlobal("location", new URL("https://example.com/abcd:xxxxxxxxx"))
    render(<PasteBin config={{ ...__WRANGLER_CONFIG__, DEFAULT_P2P_TRANSFER: true }} />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    expect(editor).toBeInTheDocument()
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent))
    expect(screen.getByRole("checkbox", { name: "P2P transfer" })).not.toBeChecked()
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled()
    await userEvent.type(editor, " changed")
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled()
  })

  it("decrypts encrypted admin text when the URL hash has the key", async () => {
    const key = await genKey("AES-GCM-CHUNKED")
    const encodedKey = await encodeKey(key)
    const ciphertext = await encrypt("AES-GCM-CHUNKED", key, new TextEncoder().encode(mockedPasteContent))
    vi.stubGlobal("location", new URL(`https://example.com/abcd:xxxxxxxxx#${encodedKey}`))
    server.use(
      http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/m/abcd`, () => {
        return HttpResponse.json({
          ...mockedPasteMeta,
          sizeBytes: ciphertext.length,
          highlightLanguage: "plaintext",
          encryptionScheme: "AES-GCM-CHUNKED",
        })
      }),
      http.head(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": BINARY_MIME_TYPE,
            "Content-Length": String(ciphertext.length),
            "X-PB-Encryption-Scheme": "AES-GCM-CHUNKED",
            "X-PB-Decrypted-Content-Type": TEXT_MIME_TYPE,
            "X-PB-Highlight-Language": "plaintext",
          },
        })
      }),
      http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
        return new HttpResponse(ciphertext, {
          headers: {
            "Content-Type": BINARY_MIME_TYPE,
            "X-PB-Encryption-Scheme": "AES-GCM-CHUNKED",
            "X-PB-Decrypted-Content-Type": TEXT_MIME_TYPE,
          },
        })
      }),
    )

    render(<PasteBin config={pasteConfig} />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent))
    expect(screen.getByRole("checkbox", { name: "Client-side encryption" })).toBeChecked()
  })

  it("does not render encrypted admin text without the URL hash key", async () => {
    const key = await genKey("AES-GCM-CHUNKED")
    const ciphertext = await encrypt("AES-GCM-CHUNKED", key, new TextEncoder().encode(mockedPasteContent))
    vi.stubGlobal("location", new URL("https://example.com/abcd:xxxxxxxxx"))
    server.use(
      http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/m/abcd`, () => {
        return HttpResponse.json({
          ...mockedPasteMeta,
          sizeBytes: ciphertext.length,
          highlightLanguage: "plaintext",
          encryptionScheme: "AES-GCM-CHUNKED",
        })
      }),
      http.head(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": BINARY_MIME_TYPE,
            "Content-Length": String(ciphertext.length),
            "X-PB-Encryption-Scheme": "AES-GCM-CHUNKED",
            "X-PB-Decrypted-Content-Type": TEXT_MIME_TYPE,
            "X-PB-Highlight-Language": "plaintext",
          },
        })
      }),
    )

    render(<PasteBin config={pasteConfig} />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await screen.findByText("Decryption key required")
    expect((editor as HTMLTextAreaElement).value).toStrictEqual("")
    expect(screen.getByRole("checkbox", { name: "Client-side encryption" })).toBeChecked()
  })
})
