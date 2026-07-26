import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { DisplayPaste } from "../pages/DisplayPaste.js"
import { PasteBin } from "../pages/PasteBin.js"
import { P2PTransferPanel } from "../components/P2PTransferPanel.js"
import { prepareContent } from "../utils/content.js"
import type { P2PSenderPeerInfo } from "../utils/p2pCommon.js"
import { stubBrowerFunctions, unStubBrowerFunctions } from "./testUtils.js"
import type { P2PFileMeta, P2PProgress, P2PReceiverSession } from "../utils/p2pCommon.js"
import { MAX_P2P_AUTO_PREVIEW_BYTES } from "../../shared/constants.js"

import "@testing-library/jest-dom/vitest"

interface ReceiverCallbacks {
  onStatus: (status: string) => void
  onMeta: (meta: P2PFileMeta) => void
  onUpdateAvailable?: (meta: P2PFileMeta | undefined) => void
  onProgress: (progress: P2PProgress | undefined) => void
  onPausedChange: (isPaused: boolean) => void
  onPausePendingChange: (isPending: boolean) => void
  onReconnectingChange?: (isReconnecting: boolean) => void
  onFile: (file: File) => void | Promise<void>
  onAbandoned?: () => void
  onTransferLimitReached: () => void
  onRoomAvailabilityChange?: (joinable: boolean) => void
  onError: (error: Error) => void
}

interface MockReceiverSession extends P2PReceiverSession {
  requestDownload: () => void
  pause: () => void
  resume: () => void
  terminate: () => void
  close: () => void
}

const receiverSessions = vi.hoisted(() => [] as { callbacks: ReceiverCallbacks; session: MockReceiverSession }[])
const createObjectURLMock = vi.fn<(object: Blob | MediaSource) => string>()

const p2pMocks = vi.hoisted(() => ({
  updateRoomOptions: vi.fn(() =>
    Promise.resolve({
      expireAt: "2099-01-02T00:00:00.000Z",
      expirationSeconds: 7200,
      maxTransfers: 2,
      joinable: true,
      pairedReceivers: 0,
      successfulReceivers: 0,
    }),
  ),
  updateFile: vi.fn((file: File) => ({ revision: "new-revision", name: file.name, order: 1 })),
  close: vi.fn(),
}))

vi.mock("../utils/p2pReceiver.js", () => ({
  startP2PReceiver: vi.fn((_name: string, _config: Env, callbacks: ReceiverCallbacks) => {
    const session: MockReceiverSession = {
      requestDownload: vi.fn<() => void>(),
      acceptUpdate: vi.fn<() => void>(),
      pause: vi.fn<() => void>(),
      resume: vi.fn<() => void>(),
      terminate: vi.fn<() => void>(() => {
        callbacks.onProgress(undefined)
        callbacks.onStatus("Transfer terminated. Receive the file again to start over.")
      }),
      close: vi.fn<() => void>(),
    }
    receiverSessions.push({ callbacks, session })
    return session
  }),
}))

vi.mock("../utils/content.js", () => ({
  prepareContent: vi.fn((editorState: { editContent: string; editFilename?: string }) =>
    Promise.resolve({
      content: new File([editorState.editContent], editorState.editFilename || "paste.txt", {
        type: "text/plain",
      }),
    }),
  ),
}))

vi.mock("../utils/p2pSender.js", () => ({
  startP2PSender: vi.fn(() =>
    Promise.resolve({
      response: {
        name: "room",
        url: "https://example.com/p/room",
        displayUrl: "https://example.com/p/room",
        senderToken: "token",
        expireAt: "2099-01-01T00:00:00.000Z",
        expirationSeconds: 3600,
      },
      currentFile: { revision: "initial-revision", name: "paste.txt", order: 0 },
      updateRoomOptions: p2pMocks.updateRoomOptions,
      updateFile: p2pMocks.updateFile,
      close: p2pMocks.close,
    }),
  ),
}))

const fileMeta: P2PFileMeta = {
  name: "archive.zip",
  size: 1024,
  type: "application/zip",
  lastModified: 0,
  verifyTransfer: false,
}

async function renderP2PDisplay(): Promise<void> {
  render(<DisplayPaste config={__WRANGLER_CONFIG__} />)
  await vi.waitFor(() => expect(receiverSessions).toHaveLength(1))
}

describe("DisplayPaste P2P receiver", () => {
  beforeEach(() => {
    stubBrowerFunctions()
    vi.stubGlobal("location", new URL("https://example.com/p/abcd"))
    createObjectURLMock.mockReset()
    createObjectURLMock.mockReturnValue("blob:mock")
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURLMock, configurable: true })
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    receiverSessions.length = 0
    unStubBrowerFunctions()
  })

  it("shows progress only after file details are received", async () => {
    await renderP2PDisplay()

    expect(screen.queryByText("0%")).not.toBeInTheDocument()
    expect(screen.queryByText("Ready")).not.toBeInTheDocument()

    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))

    const percentage = screen.getByText("0%")
    expect(percentage).toHaveClass("left-1/2", "-translate-x-1/2")
    expect(screen.getByText("Ready")).toHaveClass("rounded-full", "bg-default-200")
    expect(screen.getByText(fileMeta.name)).toHaveClass("min-w-0", "truncate", "text-left")
    expect(screen.getByText(fileMeta.name)).not.toHaveClass("flex-1")
    expect(screen.getByText("0 KB/s").parentElement).toHaveClass("invisible")
  })

  it("reuses the receiver session after the current transfer is terminated", async () => {
    await renderP2PDisplay()

    expect(receiverSessions).toHaveLength(1)
    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))

    await userEvent.click(await screen.findByRole("button", { name: "Receive file" }))
    expect(receiverSessions[0].session.requestDownload).toHaveBeenCalledTimes(1)

    act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: 128, totalBytes: fileMeta.size }))
    await userEvent.click(screen.getByRole("button", { name: "Terminate" }))

    expect(receiverSessions).toHaveLength(1)
    expect(receiverSessions[0].session.close).not.toHaveBeenCalled()
    expect(receiverSessions[0].session.terminate).toHaveBeenCalledTimes(1)
    expect(receiverSessions[0].session.requestDownload).toHaveBeenCalledTimes(1)

    await userEvent.click(await screen.findByRole("button", { name: "Receive file" }))
    expect(receiverSessions[0].session.requestDownload).toHaveBeenCalledTimes(2)
  })

  it("closes the receiver on pagehide except when entering the back-forward cache", async () => {
    await renderP2PDisplay()

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
    expect(receiverSessions[0].session.close).not.toHaveBeenCalled()

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }))
    expect(receiverSessions[0].session.close).toHaveBeenCalledOnce()
  })

  it("shows an in-progress update in a second P2P transfer card", async () => {
    await renderP2PDisplay()
    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    await userEvent.click(screen.getByRole("button", { name: "Receive file" }))
    act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: 128, totalBytes: fileMeta.size }))
    act(() =>
      receiverSessions[0].callbacks.onUpdateAvailable?.({
        ...fileMeta,
        revision: "new-version",
        name: "updated.zip",
      }),
    )

    expect(screen.getAllByText("P2P transfer")).toHaveLength(2)
    expect(screen.getByText(fileMeta.name)).toBeInTheDocument()
    expect(screen.getByText("updated.zip")).toBeInTheDocument()
    expect(screen.queryByText(/Updated file available/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Receive latest version" }))
    expect(receiverSessions[0].session.acceptUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText("P2P transfer")).toHaveLength(2)
    expect(screen.getByText(fileMeta.name)).toBeInTheDocument()
    expect(screen.getByText("Stopped")).toBeInTheDocument()

    act(() => {
      receiverSessions[0].callbacks.onUpdateAvailable?.(undefined)
      receiverSessions[0].callbacks.onMeta({
        ...fileMeta,
        revision: "new-version",
        name: "updated.zip",
      })
    })
    expect(screen.getAllByText("P2P transfer")).toHaveLength(2)
    expect(screen.getByText(fileMeta.name)).toBeInTheDocument()
    expect(screen.getByText("updated.zip")).toBeInTheDocument()
  })

  it("shows an update below a completed P2P transfer card", async () => {
    await renderP2PDisplay()
    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: fileMeta.size, totalBytes: fileMeta.size }))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(
        new File([new Uint8Array([0])], fileMeta.name, { type: fileMeta.type }),
      )
    })
    act(() =>
      receiverSessions[0].callbacks.onUpdateAvailable?.({
        ...fileMeta,
        revision: "new-version",
        name: "updated.zip",
      }),
    )

    expect(screen.getAllByText("P2P transfer")).toHaveLength(2)
    expect(screen.getByText(fileMeta.name)).toBeInTheDocument()
    expect(screen.getByText("updated.zip")).toBeInTheDocument()
    expect(screen.queryByText(/Updated file available/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Receive latest version" }))
    act(() => {
      receiverSessions[0].callbacks.onUpdateAvailable?.(undefined)
      receiverSessions[0].callbacks.onMeta({
        ...fileMeta,
        revision: "new-version",
        name: "updated.zip",
      })
    })

    expect(screen.getAllByText("P2P transfer")).toHaveLength(2)
    expect(screen.getByText(fileMeta.name)).toBeInTheDocument()
    expect(screen.getByText("updated.zip")).toBeInTheDocument()
    expect(screen.getByText("Done")).toBeInTheDocument()
  })

  it("retains every completed transfer card across multiple updates", async () => {
    await renderP2PDisplay()
    const versions = [
      { ...fileMeta, revision: "version-1", name: "version-1.zip" },
      { ...fileMeta, revision: "version-2", name: "version-2.zip" },
      { ...fileMeta, revision: "version-3", name: "version-3.zip" },
    ]

    act(() => receiverSessions[0].callbacks.onMeta(versions[0]))
    act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: fileMeta.size, totalBytes: fileMeta.size }))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(
        new File([new Uint8Array([0])], versions[0].name, { type: fileMeta.type }),
      )
    })

    for (let index = 1; index < versions.length; index += 1) {
      act(() => receiverSessions[0].callbacks.onUpdateAvailable?.(versions[index]))
      await userEvent.click(screen.getByRole("button", { name: "Receive latest version" }))
      act(() => {
        receiverSessions[0].callbacks.onUpdateAvailable?.(undefined)
        receiverSessions[0].callbacks.onMeta(versions[index])
      })
      if (index < versions.length - 1) {
        act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: fileMeta.size, totalBytes: fileMeta.size }))
        await act(async () => {
          await receiverSessions[0].callbacks.onFile(
            new File([new Uint8Array([0])], versions[index].name, { type: fileMeta.type }),
          )
        })
      }
    }

    expect(screen.getAllByText("P2P transfer")).toHaveLength(3)
    for (const version of versions) expect(screen.getByText(version.name)).toBeInTheDocument()
    expect(screen.getAllByText("Done")).toHaveLength(2)
    const pageText = document.body.textContent || ""
    expect(pageText.indexOf(versions[0].name)).toBeLessThan(pageText.indexOf(versions[1].name))
    expect(pageText.indexOf(versions[1].name)).toBeLessThan(pageText.indexOf(versions[2].name))
  })

  it("keeps hidden transfer statistics in the layout while paused", async () => {
    await renderP2PDisplay()

    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    act(() =>
      receiverSessions[0].callbacks.onProgress({
        doneBytes: 512,
        totalBytes: fileMeta.size,
        speedBytesPerSecond: 512,
      }),
    )
    expect(screen.getByText("Receiving")).toBeInTheDocument()
    expect(screen.getByText("0.5 KB/s")).toBeInTheDocument()
    expect(screen.getByText("00:01")).toBeInTheDocument()

    act(() => receiverSessions[0].callbacks.onPausedChange(true))
    expect(screen.getByText("Paused")).toBeInTheDocument()
    expect(screen.getByText("0.5 KB/s").parentElement).toHaveClass("invisible")
    expect(screen.getByText("00:01")).toBeInTheDocument()
  })

  it("shows reconnecting instead of receiving while rebuilding WebRTC", async () => {
    await renderP2PDisplay()

    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    act(() =>
      receiverSessions[0].callbacks.onProgress({
        doneBytes: 512,
        totalBytes: fileMeta.size,
        speedBytesPerSecond: 512,
      }),
    )
    act(() => receiverSessions[0].callbacks.onReconnectingChange?.(true))

    expect(screen.getByText("Reconnecting")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled()
    expect(screen.queryByText("Receiving")).not.toBeInTheDocument()
  })

  it("disables resume until the sender confirms the pause", async () => {
    await renderP2PDisplay()

    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: 128, totalBytes: fileMeta.size }))
    act(() => receiverSessions[0].callbacks.onPausePendingChange(true))
    act(() => receiverSessions[0].callbacks.onStatus("Pausing..."))

    expect(screen.getByRole("button", { name: "Pausing..." })).toBeDisabled()

    act(() => receiverSessions[0].callbacks.onPausePendingChange(false))
    act(() => receiverSessions[0].callbacks.onPausedChange(true))
    act(() => receiverSessions[0].callbacks.onStatus("Paused."))
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled()
  })

  it("shows a verified transfer result instead of keeping receiver controls", async () => {
    await renderP2PDisplay()

    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: fileMeta.size, totalBytes: fileMeta.size }))
    act(() => receiverSessions[0].callbacks.onStatus("File received and verified. Saving should start automatically."))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(
        new File([new Uint8Array([0])], fileMeta.name, { type: fileMeta.type }),
      )
    })

    expect(screen.getByText("File received and verified. Saving should start automatically.")).toBeInTheDocument()
    expect(await screen.findByText("Done")).toHaveClass("bg-success-100", "text-success")
    expect(screen.getByRole("link", { name: "Save" })).toHaveAttribute("download", fileMeta.name)
    expect(screen.getByText("Save file")).toBeInTheDocument()
    expect(screen.queryByText("load anyway")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Terminate" })).not.toBeInTheDocument()
  })

  it("shows a P2P link notice after the final allowed transfer", async () => {
    try {
      await renderP2PDisplay()
      vi.useFakeTimers()

      act(() => receiverSessions[0].callbacks.onTransferLimitReached())
      expect(screen.queryByText("The transfer limit has been reached")).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(screen.getByText("The transfer limit has been reached")).toBeInTheDocument()
      expect(screen.getByText("This P2P link is no longer available.")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("hides the transfer limit notice when updated room settings reopen the link", async () => {
    try {
      await renderP2PDisplay()
      vi.useFakeTimers()
      act(() => receiverSessions[0].callbacks.onTransferLimitReached())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(screen.getByText("The transfer limit has been reached")).toBeInTheDocument()

      act(() => receiverSessions[0].callbacks.onRoomAvailabilityChange?.(true))
      expect(screen.queryByText("The transfer limit has been reached")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("renders a small UTF-8 JSON file with its P2P highlight language", async () => {
    await renderP2PDisplay()

    const text = '{"source":"p2p"}'
    const file = new File([text], "data.json", { type: "application/json" })
    act(() =>
      receiverSessions[0].callbacks.onMeta({
        ...fileMeta,
        name: file.name,
        size: file.size,
        type: "",
        highlightLanguage: "json",
      }),
    )
    act(() => receiverSessions[0].callbacks.onStatus("Transfer complete."))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(file)
    })

    const article = await screen.findByRole("article")
    expect(article.textContent).toStrictEqual(text)
    expect(screen.getByText(file.name)).toHaveAttribute("title", file.name)
    expect(screen.getByText("json")).toBeInTheDocument()
    expect(screen.queryByText("Save file")).not.toBeInTheDocument()
  })

  it("does not let an older file preview overwrite a newer P2P file", async () => {
    await renderP2PDisplay()

    let resolveOldContent: ((content: ArrayBuffer) => void) | undefined
    const oldFile = new File(["old"], "old.txt", { type: "text/plain" })
    vi.spyOn(oldFile, "arrayBuffer").mockImplementation(
      () => new Promise<ArrayBuffer>((resolve) => (resolveOldContent = resolve)),
    )
    const newFile = new File(["new"], "new.txt", { type: "text/plain" })

    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: oldFile.name, size: oldFile.size }))
    act(() => void receiverSessions[0].callbacks.onFile(oldFile))
    await vi.waitFor(() => expect(resolveOldContent).toBeTypeOf("function"))

    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: newFile.name, size: newFile.size }))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(newFile)
    })
    expect((await screen.findByRole("article")).textContent).toStrictEqual("new")

    await act(async () => {
      resolveOldContent!(new TextEncoder().encode("old").buffer)
      await Promise.resolve()
    })
    expect(screen.getByRole("article").textContent).toStrictEqual("new")
  })

  it("renders a small UTF-8 file with an unknown extension", async () => {
    await renderP2PDisplay()

    const text = "unknown extension text"
    const file = new File([text], "note.weirdext")
    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: file.name, size: file.size, type: "" }))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(file)
    })

    const article = await screen.findByRole("article")
    expect(article.textContent).toStrictEqual(text)
  })

  it("renders valid UTF-8 independently of the filename MIME", async () => {
    await renderP2PDisplay()

    const text = "#EXTM3U\n#EXTINF:1,Sample"
    const file = new File([text], "playlist.m3u")
    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: file.name, size: file.size, type: "" }))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(file)
    })

    const article = await screen.findByRole("article")
    expect(article.textContent).toStrictEqual(text)
  })

  it("downloads a small non-UTF-8 file after binary sniffing and UTF-8 validation", async () => {
    await renderP2PDisplay()

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click")
    const file = new File([new Uint8Array([0xff, 0xfe])], "broken.txt", { type: "text/plain" })
    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: file.name, size: file.size, type: file.type }))
    act(() => void receiverSessions[0].callbacks.onFile(file))

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(screen.queryByRole("article")).not.toBeInTheDocument()
  })

  it("downloads a large file when its filename resolves to a non-text MIME", async () => {
    await renderP2PDisplay()

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click")
    const file = new File([new Uint8Array([0]), "a".repeat(MAX_P2P_AUTO_PREVIEW_BYTES)], "large.bin")
    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: file.name, size: file.size, type: file.type }))
    act(() => void receiverSessions[0].callbacks.onFile(file))

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(screen.queryByText("load anyway")).not.toBeInTheDocument()
  })

  it("does not preview a large JSON file because its inferred MIME is not text/*", async () => {
    await renderP2PDisplay()

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click")
    const file = new File(["a".repeat(MAX_P2P_AUTO_PREVIEW_BYTES)], "large.json")
    const readWholeFile = vi.spyOn(file, "arrayBuffer")
    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: file.name, size: file.size, type: "" }))
    act(() => void receiverSessions[0].callbacks.onFile(file))

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(readWholeFile).not.toHaveBeenCalled()
    expect(screen.queryByText("load anyway")).not.toBeInTheDocument()
  })

  it("falls back to binary sniffing when a large filename has no known MIME", async () => {
    await renderP2PDisplay()

    const file = new File(["a".repeat(MAX_P2P_AUTO_PREVIEW_BYTES)], "large.unknown-extension")
    const readWholeFile = vi.spyOn(file, "arrayBuffer")
    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: file.name, size: file.size, type: "" }))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(file)
    })

    expect(readWholeFile).not.toHaveBeenCalled()
    expect(screen.getByText("load anyway")).toBeInTheDocument()
  })

  it("renders an oversized P2P text file after load anyway is clicked", async () => {
    await renderP2PDisplay()

    const file = new File(["a".repeat(MAX_P2P_AUTO_PREVIEW_BYTES + 1024)], "large.txt")
    const readWholeFile = vi.spyOn(file, "arrayBuffer")
    act(() => receiverSessions[0].callbacks.onMeta({ ...fileMeta, name: file.name, size: file.size, type: "" }))
    await act(async () => {
      await receiverSessions[0].callbacks.onFile(file)
    })

    expect(readWholeFile).not.toHaveBeenCalled()
    expect(screen.queryByRole("article")).not.toBeInTheDocument()
    expect(screen.getByText("Save file")).toBeInTheDocument()
    await userEvent.click(screen.getByText("load anyway"))

    const article = await screen.findByRole("article")
    expect(readWholeFile).toHaveBeenCalledOnce()
    expect(article.textContent?.length).toStrictEqual(file.size)
    expect(createObjectURLMock).toHaveBeenLastCalledWith(file)
    expect(screen.queryByText("Save file")).not.toBeInTheDocument()
  })

  it("shows a verification failure result and lets the receiver retry", async () => {
    await renderP2PDisplay()

    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    act(() => receiverSessions[0].callbacks.onProgress({ doneBytes: fileMeta.size, totalBytes: fileMeta.size }))
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument()

    act(() => receiverSessions[0].callbacks.onProgress(undefined))
    act(() => receiverSessions[0].callbacks.onPausedChange(false))
    act(() =>
      receiverSessions[0].callbacks.onStatus(
        "Transfer verification failed after 3 repair attempts. Receive the file again to retry.",
      ),
    )

    expect(
      screen.getByText("Transfer verification failed after 3 repair attempts. Receive the file again to retry."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Receive file" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Terminate" })).not.toBeInTheDocument()
  })

  it("shows repairing status and rolled back repaired bytes", async () => {
    await renderP2PDisplay()

    act(() => receiverSessions[0].callbacks.onMeta(fileMeta))
    act(() =>
      receiverSessions[0].callbacks.onProgress({ doneBytes: 512, totalBytes: fileMeta.size, speedBytesPerSecond: 0 }),
    )
    act(() => receiverSessions[0].callbacks.onStatus("Repairing 3 blocks..."))

    expect(screen.getByText("REPAIRING")).toBeInTheDocument()
    expect(screen.getByText("512 Bytes / 1.00 KB")).toBeInTheDocument()
    expect(screen.getByText("0 KB/s")).toBeInTheDocument()
  })
})

const senderResponse = {
  name: "room",
  url: "https://example.com/p/room",
  displayUrl: "https://example.com/p/room",
  senderToken: "token",
  expireAt: "2099-01-01T00:00:00.000Z",
  expirationSeconds: 3600,
}

describe("P2PTransferPanel", () => {
  afterEach(cleanup)

  it("shows TURN fallback availability in the title and lists every TURN URL", async () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        iceServers={[
          {
            urls: [
              "stun:stun.example.com:3478",
              "stuns:stun.example.com:5349",
              "turn:turn.example.com:3478?transport=udp",
              "turns:turn.example.com:5349?transport=tcp",
            ],
          },
          { urls: "turn:backup.example.com:3478?transport=tcp" },
        ]}
      />,
    )

    const indicator = screen.getByRole("img", { name: "TURN fallback available" })
    expect(indicator.parentElement?.parentElement).toHaveTextContent("P2P Transfer")

    await userEvent.hover(indicator)
    expect(
      await screen.findByText("TURN fallback available. Used only when a direct P2P connection cannot be established."),
    ).toBeInTheDocument()
    expect(screen.getByText("turn:turn.example.com:3478?transport=udp")).toBeInTheDocument()
    expect(screen.getByText("turns:turn.example.com:5349?transport=tcp")).toBeInTheDocument()
    expect(screen.getByText("turn:backup.example.com:3478?transport=tcp")).toBeInTheDocument()
    expect(screen.getByText("stun:stun.example.com:3478")).toBeInTheDocument()
    expect(screen.getByText("stuns:stun.example.com:5349")).toBeInTheDocument()
  })

  it("shows the selected connection route immediately before the transfer status", () => {
    const peer: P2PSenderPeerInfo = {
      peerId: "relayed-peer",
      file: { revision: "current", name: "file.bin", order: 0 },
      browser: "Firefox 100",
      status: "Sending file...",
      connectionPhase: "connected",
      connectionRoute: "relay",
      transferStatus: "UPLOADING",
      progress: { doneBytes: 5, totalBytes: 10 },
      isConnected: true,
      isWaitingForResume: false,
      isPaused: false,
      isComplete: false,
    }

    render(<P2PTransferPanel isLoading={false} response={senderResponse} currentFile={peer.file} peers={[peer]} />)

    const route = screen.getByRole("img", { name: "Relayed through TURN" })
    const status = screen.getByText("Sending")
    expect(route).toHaveAttribute("title", "Relayed through TURN")
    expect(screen.queryByText("Relay")).not.toBeInTheDocument()
    expect(route.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).not.toStrictEqual(0)
  })

  it("shows signaling status in the blue notice and keeps the page warning in the Pair URL tooltip", async () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        status="P2P signaling reconnected. Waiting for receivers..."
      />,
    )

    expect(screen.getByText("P2P signaling reconnected. Waiting for receivers...")).toHaveClass(
      "bg-primary-50",
      "text-primary",
    )
    const infoButton = screen.getByRole("button", { name: "More information" })
    await userEvent.hover(infoButton)
    expect(
      await screen.findByText(/Keep this page open and your screen unlocked\. The file is not uploaded/),
    ).toBeInTheDocument()
  })

  it("keeps active and completed transfers under their original file and appends the updated file below", () => {
    const peers: P2PSenderPeerInfo[] = [
      {
        peerId: "new-active",
        file: { revision: "new", name: "new.bin", order: 1 },
        browser: "Safari 18",
        status: "Sending file...",
        connectionPhase: "connected",
        transferStatus: "UPLOADING",
        progress: { doneBytes: 1, totalBytes: 20 },
        isConnected: true,
        isWaitingForResume: false,
        isPaused: false,
        isComplete: false,
      },
      {
        peerId: "old-complete",
        file: { revision: "old", name: "old.bin", order: 0 },
        browser: "Chrome 100",
        status: "Transfer complete.",
        connectionPhase: "connected",
        transferStatus: "DONE",
        progress: { doneBytes: 10, totalBytes: 10 },
        isConnected: true,
        isWaitingForResume: false,
        isPaused: false,
        isComplete: true,
      },
      {
        peerId: "old-active",
        file: { revision: "old", name: "old.bin", order: 0 },
        browser: "Firefox 100",
        status: "Sending file...",
        connectionPhase: "connected",
        transferStatus: "UPLOADING",
        progress: { doneBytes: 5, totalBytes: 10 },
        isConnected: true,
        isWaitingForResume: false,
        isPaused: false,
        isComplete: false,
      },
    ]
    const { container } = render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "new", name: "new.bin", order: 1 }}
        peers={peers}
      />,
    )

    const text = container.textContent || ""
    expect(text.indexOf("old.bin")).toBeLessThan(text.indexOf("Chrome 100"))
    expect(text.indexOf("Chrome 100")).toBeLessThan(text.indexOf("Firefox 100"))
    expect(text.indexOf("Firefox 100")).toBeLessThan(text.indexOf("new.bin"))
    expect(text.indexOf("new.bin")).toBeLessThan(text.indexOf("Safari 18"))
    expect(screen.getAllByText("old.bin")).toHaveLength(1)
    expect(screen.getAllByText("new.bin")).toHaveLength(1)
    expect(screen.getByText("old.bin")).toHaveClass("block", "truncate")
    expect(screen.getByText("old.bin").parentElement).toHaveClass("overflow-hidden", "font-semibold")
    expect(screen.getByText("old.bin")).toHaveAttribute("title", "old.bin")
    expect(container.querySelectorAll("hr")).toHaveLength(3)
    for (const filename of ["old.bin", "new.bin"]) {
      expect(screen.getByText(filename).parentElement?.previousElementSibling).toHaveClass(
        "border-t-1",
        "border-default-200",
      )
    }
  })

  it("replaces an unused file heading instead of retaining an empty version group", () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "new", name: "new.bin", order: 1 }}
        peers={[]}
      />,
    )

    expect(screen.getByText("new.bin")).toBeInTheDocument()
    expect(screen.queryByText("old.bin")).not.toBeInTheDocument()
  })

  it("shows a disconnected resumable receiver as waiting", () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "current", name: "large.bin", order: 0 }}
        peers={[
          {
            peerId: "waiting-receiver",
            file: { revision: "current", name: "large.bin", order: 0 },
            browser: "Firefox 130",
            status: "Disconnected. Waiting for receiver to resume.",
            connectionPhase: "disconnected",
            transferStatus: "WAITING",
            progress: { doneBytes: 50, totalBytes: 100, speedBytesPerSecond: 0 },
            isConnected: false,
            isWaitingForResume: true,
            isPaused: true,
            isComplete: false,
          },
        ]}
      />,
    )

    expect(screen.getByText("Firefox 130")).toBeInTheDocument()
    expect(screen.getByText("Waiting to resume")).toBeInTheDocument()
    expect(screen.getByText("50%")).toBeInTheDocument()
  })

  it("shows the receiver browser during initial pairing without a transfer progress bar", () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "current", name: "large.bin", order: 0 }}
        peers={[
          {
            peerId: "pairing-receiver",
            file: { revision: "current", name: "large.bin", order: 0 },
            browser: "Chrome 147",
            status: "Pairing...",
            connectionPhase: "pairing",
            transferStatus: "READY",
            isConnected: false,
            isWaitingForResume: false,
            isPaused: false,
            isComplete: false,
          },
        ]}
      />,
    )

    expect(screen.getByText("Chrome 147")).toBeInTheDocument()
    expect(screen.getByText("Pairing")).toBeInTheDocument()
    expect(screen.getByLabelText("Pairing WebRTC connection")).toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
  })

  it("keeps a previously connected receiver visible while WebRTC is reconnecting before progress starts", () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "current", name: "large.bin", order: 0 }}
        peers={[
          {
            peerId: "reconnecting-receiver",
            file: { revision: "current", name: "large.bin", order: 0 },
            browser: "Chrome 140",
            status: "Reconnecting to receiver...",
            connectionPhase: "reconnecting",
            transferStatus: "RECONNECTING",
            isConnected: false,
            isWaitingForResume: false,
            isPaused: false,
            isComplete: false,
          },
        ]}
      />,
    )

    expect(screen.getByText("Chrome 140")).toBeInTheDocument()
    expect(screen.getByText("Reconnecting")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
  })

  it("shows an initial WebRTC retry without a fake transfer progress bar", () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "current", name: "large.bin", order: 0 }}
        peers={[
          {
            peerId: "pairing-retry-receiver",
            file: { revision: "current", name: "large.bin", order: 0 },
            browser: "Chrome 140",
            status: "WebRTC pairing failed. Retrying...",
            connectionPhase: "pairing-retry",
            transferStatus: "READY",
            isConnected: false,
            isWaitingForResume: false,
            isPaused: false,
            isComplete: false,
          },
        ]}
      />,
    )

    expect(screen.getByText("Chrome 140")).toBeInTheDocument()
    expect(screen.getByText("Retrying pairing")).toBeInTheDocument()
    expect(screen.getByLabelText("Retrying WebRTC pairing")).toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
    expect(screen.queryByText("Reconnecting")).not.toBeInTheDocument()
  })

  it("keeps an exhausted initial pairing failure visible without a progress bar", () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "current", name: "large.bin", order: 0 }}
        peers={[
          {
            peerId: "pairing-failed-receiver",
            file: { revision: "current", name: "large.bin", order: 0 },
            browser: "Firefox 130",
            status: "Unable to establish a WebRTC connection. Waiting for receiver to retry.",
            connectionPhase: "pairing-failed",
            transferStatus: "PAUSED",
            isConnected: false,
            isWaitingForResume: false,
            isPaused: true,
            isComplete: false,
          },
        ]}
      />,
    )

    expect(screen.getByText("Firefox 130")).toBeInTheDocument()
    expect(screen.getByText("Pairing failed")).toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
  })

  it("labels an exhausted reconnect separately when transfer progress has not started", () => {
    render(
      <P2PTransferPanel
        isLoading={false}
        response={senderResponse}
        currentFile={{ revision: "current", name: "large.bin", order: 0 }}
        peers={[
          {
            peerId: "reconnect-failed-receiver",
            file: { revision: "current", name: "large.bin", order: 0 },
            browser: "Safari 18",
            status: "Connection recovery failed. Waiting for receiver to retry.",
            connectionPhase: "reconnect-failed",
            transferStatus: "PAUSED",
            isConnected: false,
            isWaitingForResume: false,
            isPaused: true,
            isComplete: false,
          },
        ]}
      />,
    )

    expect(screen.getByText("Safari 18")).toBeInTheDocument()
    expect(screen.getByText("Reconnect failed")).toBeInTheDocument()
    expect(screen.queryByText("Pairing failed")).not.toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
  })
})

describe("PasteBin P2P update", () => {
  beforeEach(() => {
    stubBrowerFunctions()
    vi.stubGlobal("location", new URL("https://example.com/"))
  })

  afterEach(() => {
    cleanup()
    p2pMocks.updateFile.mockClear()
    p2pMocks.updateRoomOptions.mockClear()
    p2pMocks.close.mockClear()
    unStubBrowerFunctions()
  })

  it("updates the active P2P session while keeping the pair URL", async () => {
    render(<PasteBin config={{ ...__WRANGLER_CONFIG__, DEFAULT_P2P_TRANSFER: true }} />)
    const editor = screen.getByRole("textbox", { name: "Paste editor" })
    await userEvent.type(editor, "first version")
    await userEvent.click(screen.getByRole("button", { name: "Start P2P" }))

    expect(await screen.findByRole("button", { name: "Update P2P" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Stop P2P" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Pair URL" })).toHaveValue("https://example.com/p/room")

    await userEvent.clear(editor)
    await userEvent.type(editor, "second version")
    expect(screen.getByRole("button", { name: "Update P2P" })).toBeEnabled()
    await userEvent.click(screen.getByRole("button", { name: "Update P2P" }))

    await vi.waitFor(() => expect(p2pMocks.updateFile).toHaveBeenCalledTimes(1))
    expect(p2pMocks.updateRoomOptions).toHaveBeenCalledWith(
      __WRANGLER_CONFIG__.DEFAULT_P2P_EXPIRATION,
      String(__WRANGLER_CONFIG__.DEFAULT_P2P_TRANSFERS),
      expect.any(AbortSignal),
    )
    const updatedFile = p2pMocks.updateFile.mock.calls[0][0]
    expect(await updatedFile.text()).toStrictEqual("second version")
    expect(screen.getByRole("textbox", { name: "Pair URL" })).toHaveValue("https://example.com/p/room")
    expect(p2pMocks.close).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Update P2P" })).toBeDisabled())
  })

  it("closes the sender on pagehide except when entering the back-forward cache", async () => {
    render(<PasteBin config={{ ...__WRANGLER_CONFIG__, DEFAULT_P2P_TRANSFER: true }} />)
    await userEvent.type(screen.getByRole("textbox", { name: "Paste editor" }), "shared content")
    await userEvent.click(screen.getByRole("button", { name: "Start P2P" }))
    await screen.findByRole("button", { name: "Stop P2P" })

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
    expect(p2pMocks.close).not.toHaveBeenCalled()

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }))
    expect(p2pMocks.close).toHaveBeenCalledOnce()
  })

  it("aborts in-progress sender preparation when leaving the page", async () => {
    let preparationSignal: AbortSignal | undefined
    vi.mocked(prepareContent).mockImplementationOnce((_editorState, options) => {
      preparationSignal = options?.signal
      return new Promise((_resolve, reject) => {
        preparationSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted", "AbortError")),
          { once: true },
        )
      })
    })

    render(<PasteBin config={{ ...__WRANGLER_CONFIG__, DEFAULT_P2P_TRANSFER: true }} />)
    await userEvent.type(screen.getByRole("textbox", { name: "Paste editor" }), "shared content")
    await userEvent.click(screen.getByRole("button", { name: "Start P2P" }))
    await vi.waitFor(() => expect(preparationSignal).toBeDefined())

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
    expect(preparationSignal?.aborted).toStrictEqual(false)

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }))
    expect(preparationSignal?.aborted).toStrictEqual(true)
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Start P2P" })).toBeEnabled())
  })

  it("updates room limits without publishing a new file version", async () => {
    render(<PasteBin config={{ ...__WRANGLER_CONFIG__, DEFAULT_P2P_TRANSFER: true }} />)
    await userEvent.type(screen.getByRole("textbox", { name: "Paste editor" }), "shared content")
    await userEvent.click(screen.getByRole("button", { name: "Start P2P" }))
    expect(await screen.findByRole("button", { name: "Update P2P" })).toBeDisabled()

    const transfers = screen.getByRole("spinbutton", { name: "Transfers" })
    await userEvent.clear(transfers)
    await userEvent.type(transfers, "2")
    expect(screen.getByRole("button", { name: "Update P2P" })).toBeEnabled()
    await userEvent.click(screen.getByRole("button", { name: "Update P2P" }))

    await vi.waitFor(() =>
      expect(p2pMocks.updateRoomOptions).toHaveBeenLastCalledWith(
        __WRANGLER_CONFIG__.DEFAULT_P2P_EXPIRATION,
        "2",
        expect.any(AbortSignal),
      ),
    )
    expect(p2pMocks.updateFile).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Update P2P" })).toBeDisabled())
  })
})
