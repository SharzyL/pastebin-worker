import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { QrCodeTooltip } from "../components/QrCodeTooltip.js"
import { countTextLines, LineNumbers } from "../components/LineNumbers.js"
import { Modal } from "../components/ui/Modal.js"

import "@testing-library/jest-dom/vitest"

function ModalHarness({ firstOpen, secondOpen }: { firstOpen: boolean; secondOpen: boolean }) {
  return (
    <>
      <Modal isOpen={firstOpen} onClose={vi.fn()}>
        First
      </Modal>
      <Modal isOpen={secondOpen} onClose={vi.fn()}>
        Second
      </Modal>
    </>
  )
}

describe("Modal body scroll locking", () => {
  afterEach(() => {
    cleanup()
    document.body.style.overflow = ""
  })

  it("restores the previous overflow only after the last modal closes", () => {
    document.body.style.overflow = "clip"
    const view = render(<ModalHarness firstOpen secondOpen />)

    expect(document.body.style.overflow).toStrictEqual("hidden")
    view.rerender(<ModalHarness firstOpen={false} secondOpen />)
    expect(document.body.style.overflow).toStrictEqual("hidden")
    view.rerender(<ModalHarness firstOpen={false} secondOpen={false} />)
    expect(document.body.style.overflow).toStrictEqual("clip")
  })
})

describe("QrCodeTooltip", () => {
  afterEach(cleanup)

  it("anchors the preview above its button on narrow screens", async () => {
    render(<QrCodeTooltip value="https://example.com/abcdefghijklmnopqrstuvwx" />)

    await userEvent.click(screen.getByRole("button", { name: "Show QR code" }))

    const dialog = screen.getByRole("dialog", { name: "QR code" })
    expect(dialog).toHaveClass("absolute", "right-0", "bottom-full", "mb-2")
    expect(dialog).not.toHaveClass("fixed")
  })

  it("anchors a bottom-placed preview below its button", async () => {
    render(<QrCodeTooltip value="https://example.com/p/abcdefghijklmnopqrstuvwx" placement="bottom" />)

    await userEvent.click(screen.getByRole("button", { name: "Show QR code" }))

    expect(screen.getByRole("dialog", { name: "QR code" })).toHaveClass("absolute", "right-0", "top-full", "mt-2")
  })
})

describe("LineNumbers", () => {
  afterEach(cleanup)

  it("counts lines without allocating a regex match array", () => {
    expect(countTextLines("")).toStrictEqual(1)
    expect(countTextLines("one\ntwo\nthree")).toStrictEqual(3)
  })

  it("renders every line number in one text node", () => {
    render(<LineNumbers lineCount={3} data-testid="line-numbers" />)

    const lineNumbers = screen.getByTestId("line-numbers")
    expect(lineNumbers.textContent).toStrictEqual("1\n2\n3")
    expect(lineNumbers.children).toHaveLength(0)
  })
})
