import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PasteBin } from "../pb.js"
import { mockedPasteContent, mockedPasteUpload, server } from "./mock.js"

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

import "@testing-library/jest-dom/vitest"
import { userEvent } from "@testing-library/user-event"

describe("Pastebin", () => {
  it("can upload", async () => {
    render(<PasteBin />)

    const title = screen.getByText("Pastebin Worker")
    expect(title).toBeInTheDocument()

    const editor = screen.getByPlaceholderText("Edit your paste here")
    expect(editor).toBeInTheDocument()
    await userEvent.type(editor, "something")

    const submitter = screen.getByText("Upload")
    expect(submitter).toBeInTheDocument()
    expect(submitter).toBeEnabled()
    await userEvent.click(submitter)

    expect(screen.getByText(mockedPasteUpload.url)).toBeInTheDocument()
    expect(screen.getByText(mockedPasteUpload.manageUrl)).toBeInTheDocument()
  })
})

describe("Pastebin admin page", () => {
  it("renders admin page", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      enumerable: true,
      value: new URL("https://example.com/abcd:xxxxxxxxx"),
    })
    render(<PasteBin />)

    const edit = screen.getByTestId("pastebin-edit")
    await userEvent.click(edit) // meaningless click, just ensure useEffect is done
    expect(edit).toBeInTheDocument()
    expect((edit as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent)
  })
})

describe("Pastebin dark mode", () => {
  it("renders light mode", async () => {
    render(<PasteBin />)

    const main = screen.getByTestId("pastebin-main")
    const toggler = screen.getByTestId("pastebin-darkmode-toggle")
    expect(main).toHaveClass("light")
    await userEvent.click(toggler)
    expect(main).toHaveClass("dark")
    await userEvent.click(toggler)
    expect(main).toHaveClass("light")
  })
})
