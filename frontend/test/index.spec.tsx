import { describe, it, vi, expect, beforeAll, afterEach, afterAll } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PasteBin } from "../components/PasteBin.js"

export const mockedPasteUpload: PasteResponse = {
  url: "https://example.com/abcd",
  manageUrl: "https://example.com/abcd:aaaaaaaaaaaaaaaaaa",
  expireAt: "2025-05-01T00:00:00.000Z",
  expirationSeconds: 300,
}

export const mockedPasteContent = "something"

export const server = setupServer(
  http.post("/", () => {
    return HttpResponse.json(mockedPasteUpload)
  }),
  http.get("/abcd", () => {
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
import { PasteResponse } from "../../shared/interfaces.js"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { stubBrowerFunctions, unStubBrowerFunctions } from "./testUtils.js"

describe("Pastebin", () => {
  it("can upload", async () => {
    render(<PasteBin />)

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

    expect(screen.getByText(mockedPasteUpload.url)).toBeInTheDocument()
    expect(screen.getByText(mockedPasteUpload.manageUrl)).toBeInTheDocument()
  })

  it("refuse illegal settings", async () => {
    render(<PasteBin />)
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
    render(<PasteBin />)

    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await userEvent.click(editor) // meaningless click, just ensure useEffect is done
    expect(editor).toBeInTheDocument()
    expect((editor as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent)
  })
})

describe("Pastebin dark mode", () => {
  it("renders light mode", async () => {
    render(<PasteBin />)

    const main = screen.getByRole("main")
    const toggler = screen.getByRole("button", { name: "Toggle dark mode" })
    expect(main).toHaveClass("light")
    await userEvent.click(toggler)
    expect(main).toHaveClass("light")
    await userEvent.click(toggler)
    expect(main).toHaveClass("dark")
    await userEvent.click(toggler)
    expect(main).toHaveClass("light")
  })
})
