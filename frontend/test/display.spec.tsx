import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { DisplayPaste } from "../pages/DisplayPaste.js"

import "@testing-library/jest-dom/vitest"
import { userEvent } from "@testing-library/user-event"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { encodeKey, encrypt, genKey } from "../utils/encryption.js"
import { stubBrowerFunctions, unStubBrowerFunctions } from "./testUtils.js"
import { DEFAULT_EDIT_FILENAME, MAX_AUTO_FETCH_BYTES } from "../../shared/constants.js"
import type { SerializedPasteData } from "../../shared/interfaces.js"
import { formatSize } from "../utils/utils.js"

interface RespInit {
  body: ArrayBuffer
  headers: Record<string, string>
}

function mockPaste(pasteName: string, init: RespInit) {
  const headers = { ...init.headers, "Content-Length": String(init.body.byteLength) }
  return [
    http.head(`/${pasteName}`, () => new HttpResponse(null, { headers })),
    http.get(`/${pasteName}`, () => HttpResponse.arrayBuffer(init.body, { headers })),
  ]
}

const server = setupServer()

beforeAll(() => {
  stubBrowerFunctions()
  globalThis.URL.createObjectURL = () => "blob:mock"
  server.listen()
})

afterEach(() => {
  server.resetHandlers()
  cleanup()
  delete (window as Window & { __PASTE_DATA__?: SerializedPasteData }).__PASTE_DATA__
})

afterAll(() => {
  unStubBrowerFunctions()
  server.close()
})

describe("DisplayPaste", () => {
  it("auto-fetches and highlights small plain text", async () => {
    const text = "hello world"
    server.use(
      ...mockPaste("abcd", {
        body: new TextEncoder().encode(text).buffer,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const article = await screen.findByRole("article")
    expect(article.textContent).toStrictEqual(text)
  })

  it("renders plain image via raw URL without downloading bytes", async () => {
    // Body is irrelevant: the frontend should not GET it. We still provide a
    // GET handler that would fail loudly if it were called.
    let getCalled = false
    server.use(
      http.head("/abcd", () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": "12345",
            "Content-Disposition": "inline; filename*=UTF-8''cat.png",
          },
        })
      }),
      http.get("/abcd", () => {
        getCalled = true
        return new HttpResponse(null, { status: 500 })
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const img = await screen.findByRole("img")
    expect(img.getAttribute("src")).toStrictEqual("/abcd")
    expect(getCalled).toStrictEqual(false)
  })

  it("renders plain audio via raw URL without downloading bytes", async () => {
    let getCalled = false
    server.use(
      http.head("/abcd", () => {
        return new HttpResponse(null, {
          headers: { "Content-Type": "audio/mpeg", "Content-Length": "999999" },
        })
      }),
      http.get("/abcd", () => {
        getCalled = true
        return new HttpResponse(null, { status: 500 })
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const audio = await screen.findByLabelText("abcd")
    expect(audio.tagName.toLowerCase()).toStrictEqual("audio")
    expect(audio.getAttribute("src")).toStrictEqual("/abcd")
    expect(audio.hasAttribute("controls")).toStrictEqual(true)
    expect(getCalled).toStrictEqual(false)
  })

  it("renders plain video via raw URL without downloading bytes", async () => {
    let getCalled = false
    server.use(
      http.head("/abcd", () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": "9999999",
            "Content-Disposition": "inline; filename*=UTF-8''clip.mp4",
          },
        })
      }),
      http.get("/abcd", () => {
        getCalled = true
        return new HttpResponse(null, { status: 500 })
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const video = await screen.findByLabelText("clip.mp4")
    expect(video.tagName.toLowerCase()).toStrictEqual("video")
    expect(video.getAttribute("src")).toStrictEqual("/abcd")
    expect(video.hasAttribute("controls")).toStrictEqual(true)
    expect(getCalled).toStrictEqual(false)
  })

  it("auto-decrypts and renders small encrypted audio via blob URL", async () => {
    const scheme = "AES-GCM"
    const key = await genKey(scheme)
    const fakeAudio = new Uint8Array([0xff, 0xfb, 0x90, 0x44])
    const encryptedBytes = await encrypt(scheme, key, fakeAudio)
    server.use(
      ...mockPaste("abcd", {
        body: encryptedBytes.buffer as ArrayBuffer,
        headers: {
          "X-PB-Encryption-Scheme": "AES-GCM",
          "X-PB-Decrypted-Content-Type": "audio/mpeg",
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "inline; filename*=UTF-8''song.mp3.encrypted",
        },
      }),
    )
    vi.stubGlobal("location", new URL(`https://example.com/d/abcd#${await encodeKey(key)}`))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const audio = await screen.findByLabelText("song.mp3")
    expect(audio.tagName.toLowerCase()).toStrictEqual("audio")
    await waitFor(() => expect(audio.getAttribute("src")).toStrictEqual("blob:mock"))
  })

  it("auto-decrypts and renders a small encrypted image via blob URL", async () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const scheme = "AES-GCM"
    const key = await genKey(scheme)
    const encryptedBytes = await encrypt(scheme, key, pngHeader)
    server.use(
      ...mockPaste("abcd", {
        body: encryptedBytes.buffer as ArrayBuffer,
        headers: {
          "X-PB-Encryption-Scheme": "AES-GCM",
          "X-PB-Decrypted-Content-Type": "image/png",
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "inline; filename*=UTF-8''photo.png.encrypted",
        },
      }),
    )
    vi.stubGlobal("location", new URL(`https://example.com/d/abcd#${await encodeKey(key)}`))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const img = await screen.findByRole("img")
    await waitFor(() => expect(img.getAttribute("src")).toStrictEqual("blob:mock"))
    expect(img.getAttribute("alt")).toStrictEqual("photo.png")
  })

  it("auto-decrypts and renders a small encrypted text paste", async () => {
    const text = "encrypted hello"
    const scheme = "AES-GCM"
    const key = await genKey(scheme)
    const encryptedBytes = await encrypt(scheme, key, new TextEncoder().encode(text))
    server.use(
      ...mockPaste("abcd", {
        body: encryptedBytes.buffer as ArrayBuffer,
        headers: {
          "X-PB-Encryption-Scheme": "AES-GCM",
          "X-PB-Decrypted-Content-Type": "text/plain;charset=UTF-8",
          "Content-Type": "application/octet-stream",
        },
      }),
    )
    vi.stubGlobal("location", new URL(`https://example.com/d/abcd#${await encodeKey(key)}`))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const article = await screen.findByRole("article")
    expect(article.textContent).toStrictEqual(text)
  })

  it("shows placeholder with load-anyway for oversized text", async () => {
    const oversized = new Uint8Array(MAX_AUTO_FETCH_BYTES + 1)
    let getCalled = false
    server.use(
      http.head("/abcd", () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
            "Content-Length": String(oversized.byteLength),
          },
        })
      }),
      http.get("/abcd", () => {
        getCalled = true
        return HttpResponse.arrayBuffer(oversized.buffer)
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    expect(await screen.findByText("load anyway")).toBeInTheDocument()
    expect(screen.getByText("Download raw")).toBeInTheDocument()
    expect(getCalled).toStrictEqual(false)
  })

  it("shows filename from Content-Disposition in the title even with a bare URL", async () => {
    const filename = "track.flac"
    server.use(
      http.head("/abcd", () => {
        return new HttpResponse(null, {
          headers: {
            "Content-Type": "audio/flac",
            "Content-Length": "27207192",
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
          },
        })
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const heading = await screen.findByRole("heading")
    expect(heading.textContent).toContain(filename)
  })

  it("hydrates from SSR-injected __PASTE_DATA__ and shows metadata filename in title", async () => {
    const text = "ssr-injected hello"
    const base64 = btoa(text)
    const injected: SerializedPasteData = {
      content: base64,
      name: "abcd",
      isBinary: false,
      guessedEncoding: "UTF-8",
      metadata: {
        lastModifiedAt: "",
        createdAt: "",
        expireAt: "",
        sizeBytes: text.length,
        location: "KV",
        filename: "ssr.txt",
      },
    }
    window.__PASTE_DATA__ = injected
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const article = await screen.findByRole("article")
    expect(article.textContent).toStrictEqual(text)
    const heading = await screen.findByRole("heading")
    expect(heading.textContent).toContain("ssr.txt")
  })

  it("hides the default Untitled filename from the heading but keeps it for content and download", async () => {
    const text = "untitled hello"
    const injected: SerializedPasteData = {
      content: btoa(text),
      name: "abcd",
      isBinary: false,
      guessedEncoding: "UTF-8",
      metadata: {
        lastModifiedAt: "",
        createdAt: "",
        expireAt: "",
        sizeBytes: text.length,
        location: "KV",
        filename: DEFAULT_EDIT_FILENAME,
      },
    }
    window.__PASTE_DATA__ = injected
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const article = await screen.findByRole("article")
    expect(article.textContent).toStrictEqual(text)

    const heading = await screen.findByRole("heading")
    expect(heading.textContent).not.toContain(DEFAULT_EDIT_FILENAME)
    expect(screen.getByText(DEFAULT_EDIT_FILENAME)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("download")).toStrictEqual(
      DEFAULT_EDIT_FILENAME,
    )
  })

  it("shows SSR-injected zip content as a non-renderable archive", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
    const injected: SerializedPasteData = {
      content: btoa(String.fromCharCode(...zipBytes)),
      name: "abcd",
      isBinary: true,
      guessedEncoding: null,
      metadata: {
        lastModifiedAt: "",
        createdAt: "",
        expireAt: "",
        sizeBytes: zipBytes.byteLength,
        location: "KV",
        filename: "files.zip",
      },
    }
    window.__PASTE_DATA__ = injected
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    expect(await screen.findByText(/Not a renderable file \(application\/zip\)/)).toBeInTheDocument()
    expect(screen.getByText("Download raw")).toBeInTheDocument()
    expect(screen.queryByText(/not in UTF-8/)).not.toBeInTheDocument()
  })

  it("fetches and renders content when user clicks load anyway on oversized text", async () => {
    const oversized = new TextEncoder().encode("a".repeat(MAX_AUTO_FETCH_BYTES + 4))
    server.use(
      ...mockPaste("abcd", {
        body: oversized.buffer,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const loadAnyway = await screen.findByText("load anyway")
    await userEvent.click(loadAnyway)

    const article = await screen.findByRole("article")
    expect(article.textContent?.length).toBeGreaterThan(MAX_AUTO_FETCH_BYTES)
  })

  it("auto-decrypts and renders small encrypted video via blob URL", async () => {
    const scheme = "AES-GCM"
    const key = await genKey(scheme)
    const fakeVideo = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
    const encryptedBytes = await encrypt(scheme, key, fakeVideo)
    server.use(
      ...mockPaste("abcd", {
        body: encryptedBytes.buffer as ArrayBuffer,
        headers: {
          "X-PB-Encryption-Scheme": "AES-GCM",
          "X-PB-Decrypted-Content-Type": "video/mp4",
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "inline; filename*=UTF-8''clip.mp4.encrypted",
        },
      }),
    )
    vi.stubGlobal("location", new URL(`https://example.com/d/abcd#${await encodeKey(key)}`))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    const video = await screen.findByLabelText("clip.mp4")
    expect(video.tagName.toLowerCase()).toStrictEqual("video")
    await waitFor(() => expect(video.getAttribute("src")).toStrictEqual("blob:mock"))
  })

  it("falls back to placeholder when Content-Length is missing on text", async () => {
    let getCalled = false
    const sizeBytes = MAX_AUTO_FETCH_BYTES + 1
    server.use(
      http.head("/abcd", () => {
        // No Content-Length header at all (e.g. chunked response).
        return new HttpResponse(null, {
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
        })
      }),
      http.get("/m/abcd", () => {
        return HttpResponse.json({
          lastModifiedAt: "",
          createdAt: "",
          expireAt: "",
          sizeBytes,
          location: "R2",
        })
      }),
      http.get("/abcd", () => {
        getCalled = true
        return new HttpResponse(null, { status: 500 })
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    expect(await screen.findByText("load anyway")).toBeInTheDocument()
    expect(screen.getByText(`abcd (${formatSize(sizeBytes)})`)).toBeInTheDocument()
    expect(getCalled).toStrictEqual(false)
  })

  it("shows placeholder for non-text non-image content", async () => {
    server.use(
      ...mockPaste("abcd", {
        body: new ArrayBuffer(8),
        headers: { "Content-Type": "application/pdf" },
      }),
    )
    vi.stubGlobal("location", new URL("https://example.com/d/abcd"))

    render(<DisplayPaste config={__WRANGLER_CONFIG__} />)

    expect(await screen.findByText(/Not a renderable file/)).toBeInTheDocument()
    expect(screen.getByText("Download raw")).toBeInTheDocument()
  })
})
