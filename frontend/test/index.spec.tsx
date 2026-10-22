import { describe, it, vi, expect, beforeAll, afterEach, afterAll } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PasteBin } from "../pages/PasteBin.js"
import { HljsProvider } from "../utils/highlight-client.js"

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

// raw multipart body; parsing it as FormData fails across the jsdom and node realms
let lastUpload: string | undefined

export const server = setupServer(
  http.post(`${__WRANGLER_CONFIG__.DEPLOY_URL}/`, async ({ request }) => {
    lastUpload = await request.text()
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

describe("Pastebin", () => {
  it("can upload", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)

    const title = screen.getByText("Pastebin Worker")
    expect(title).toBeInTheDocument()

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    expect(editor).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Client-side encryption" })).toBeChecked()

    const submitter = screen.getByRole("button", { name: "Upload" })
    expect(submitter).toBeInTheDocument()
    expect(submitter).not.toBeEnabled()

    await userEvent.type(editor, "something")

    expect(submitter).toBeEnabled()
    await userEvent.click(submitter)

    await new Promise((resolve) => setTimeout(resolve, 1000))
    // encrypted by default
    expect(lastUpload).toMatch(/name="encryption-scheme"\r\n\r\nAES-GCM\r\n/)
    expect(lastUpload).not.toContain("something")

    const urlShow = screen.getByRole("textbox", { name: "Raw URL" })
    expect((urlShow as HTMLInputElement).value).toStrictEqual(mockedPasteUpload.url)

    const manageUrlShow = screen.getByRole("textbox", { name: "Manage URL" })
    expect((manageUrlShow as HTMLInputElement).value).toStrictEqual(mockedPasteUpload.manageUrl)

    const qrButtons = screen.getAllByRole("button", { name: "Show QR code" })
    expect(qrButtons.length).toBeGreaterThanOrEqual(3)
    await userEvent.click(qrButtons[0])
    const dialog = screen.getByRole("dialog", { name: "Display URL QR code" })
    expect(dialog).toHaveTextContent("https://example.com/d/abcd")
    expect(screen.getByRole("img", { name: "QR code" })).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("moves focus from the editor to the language box on Shift+Tab", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)
    await userEvent.click(screen.getByRole("textbox", { name: "Paste editor" }))
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}")
    expect(screen.getByRole("textbox", { name: "Language" })).toHaveFocus()
  })

  it("moves on to the next field on Enter in the indent and language boxes", async () => {
    // jsdom has no layout; the dropdowns scroll their highlighted item into view
    Element.prototype.scrollIntoView = vi.fn()
    // provides the list of languages, as the page entry does
    render(
      <HljsProvider>
        <PasteBin config={__WRANGLER_CONFIG__} />
      </HljsProvider>,
    )
    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    const language = screen.getByRole("textbox", { name: "Language" })
    await userEvent.click(editor)
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Shift>}{Tab}{/Shift}")
    expect(language).not.toHaveFocus()

    // Indent With -> Language
    await userEvent.keyboard("{Enter}")
    expect(language).toHaveFocus()

    // Language -> editor, with the highlighted language chosen
    await userEvent.clear(language)
    await userEvent.type(language, "pyth")
    await userEvent.keyboard("{Enter}")
    expect(editor).toHaveFocus()
    expect(language).toHaveValue("python")
  })

  it("toggles the encryption switch with Enter", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)
    const toggle = screen.getByRole("switch", { name: "Client-side encryption" })
    toggle.focus()
    await userEvent.keyboard("{Enter}")
    expect(toggle).not.toBeChecked()
    await userEvent.keyboard("{Enter}")
    expect(toggle).toBeChecked()
  })

  it("uploads with Ctrl+Enter in the editor", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)
    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    // nothing to upload yet
    await userEvent.click(editor)
    await userEvent.keyboard("{Control>}{Enter}{/Control}")
    expect(screen.queryByRole("textbox", { name: "Raw URL" })).toBeNull()

    await userEvent.type(editor, "something")
    await userEvent.keyboard("{Control>}{Enter}{/Control}")
    const urlShow = await screen.findByRole("textbox", { name: "Raw URL" }, { timeout: 3000 })
    expect((urlShow as HTMLInputElement).value).toStrictEqual(mockedPasteUpload.url)
    expect((editor as HTMLTextAreaElement).value).toStrictEqual("something")
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
    await userEvent.click(editor) // meaningless click, just ensure useEffect is done
    expect(editor).toBeInTheDocument()
    expect((editor as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent)
    // the paste is not encrypted, so neither is the update by default
    expect(screen.getByRole("switch", { name: "Client-side encryption" })).not.toBeChecked()
  })
})
