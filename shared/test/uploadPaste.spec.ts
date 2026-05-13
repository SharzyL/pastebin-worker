import { afterEach, describe, expect, it, vi } from "vitest"
import { UploadError, uploadMPU, uploadNormal } from "../uploadPaste.js"

const API_URL = "https://example.com"

function jsonResp(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  })
}

function makeFile(size: number, name = "blob"): File {
  return new File([new Uint8Array(size)], name)
}

interface XhrCall {
  method: string
  url: string
  body: BodyInit | null
}

class FakeXHR {
  static respond: ((req: XhrCall) => { status: number; body: string }) | null = null
  static calls: XhrCall[] = []

  private _method = ""
  private _url = ""
  status = 0
  responseText = ""

  private _uploadListeners = new Map<string, ((e: ProgressEvent) => void)[]>()
  upload = {
    addEventListener: (type: string, cb: (e: ProgressEvent) => void) => {
      const list = this._uploadListeners.get(type) ?? []
      list.push(cb)
      this._uploadListeners.set(type, list)
    },
  }

  private _listeners = new Map<string, (() => void)[]>()

  open(method: string, url: string) {
    this._method = method
    this._url = url
  }

  addEventListener(type: string, cb: () => void) {
    const list = this._listeners.get(type) ?? []
    list.push(cb)
    this._listeners.set(type, list)
  }

  send(body: BodyInit | null) {
    queueMicrotask(() => {
      const call = { method: this._method, url: this._url, body }
      FakeXHR.calls.push(call)
      const resp = FakeXHR.respond!(call)
      this.status = resp.status
      this.responseText = resp.body
      this._listeners.get("load")?.forEach((cb) => cb())
    })
  }
}

function setupXhr(respond: (req: XhrCall) => { status: number; body: string }): XhrCall[] {
  FakeXHR.respond = respond
  FakeXHR.calls = []
  vi.stubGlobal("XMLHttpRequest", FakeXHR)
  return FakeXHR.calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeXHR.respond = null
  FakeXHR.calls = []
})

describe("UploadError", () => {
  it("stores status code on instance", () => {
    const err = new UploadError(418, "I'm a teapot")
    expect(err).toBeInstanceOf(Error)
    expect(err.statusCode).toStrictEqual(418)
    expect(err.message).toStrictEqual("I'm a teapot")
  })
})

describe("uploadNormal", () => {
  it("POSTs to apiUrl on create and returns parsed json", async () => {
    const calls = setupXhr(() => ({
      status: 200,
      body: JSON.stringify({ url: "https://example.com/abcd", manageUrl: "https://example.com/abcd:pw" }),
    }))

    const resp = await uploadNormal(API_URL, {
      content: makeFile(16, "x.txt"),
      isUpdate: false,
      isPrivate: true,
      password: "pw",
      name: "abcd",
      highlightLanguage: "ts",
      encryptionScheme: "AES-GCM",
      expire: "10m",
    })

    expect(resp.url).toStrictEqual("https://example.com/abcd")
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toStrictEqual(API_URL)
    expect(calls[0].method).toStrictEqual("POST")

    const fd = calls[0].body as FormData
    expect(fd.get("e")).toStrictEqual("10m")
    expect(fd.get("s")).toStrictEqual("pw")
    expect(fd.get("n")).toStrictEqual("abcd")
    expect(fd.get("encryption-scheme")).toStrictEqual("AES-GCM")
    expect(fd.get("lang")).toStrictEqual("ts")
    expect(fd.get("p")).toStrictEqual("1")
    expect(fd.get("c")).toBeInstanceOf(File)
  })

  it("PUTs to manageUrl on update and skips name field", async () => {
    const calls = setupXhr(() => ({ status: 200, body: JSON.stringify({ url: "u", manageUrl: "m" }) }))

    await uploadNormal(API_URL, {
      content: makeFile(8),
      isUpdate: true,
      manageUrl: "https://example.com/abcd:pw",
      name: "abcd",
    })

    expect(calls[0].url).toStrictEqual("https://example.com/abcd:pw")
    expect(calls[0].method).toStrictEqual("PUT")
    expect((calls[0].body as FormData).get("n")).toBeNull()
  })

  it("throws TypeError when isUpdate without manageUrl", async () => {
    const calls = setupXhr(() => ({ status: 200, body: "{}" }))

    await expect(uploadNormal(API_URL, { content: makeFile(8), isUpdate: true })).rejects.toBeInstanceOf(TypeError)
    expect(calls).toHaveLength(0)
  })

  it("throws UploadError carrying statusCode on non-ok response", async () => {
    setupXhr(() => ({ status: 400, body: "bad name" }))

    const err: unknown = await uploadNormal(API_URL, {
      content: makeFile(8),
      isUpdate: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).statusCode).toStrictEqual(400)
    expect((err as UploadError).message).toStrictEqual("bad name")
  })
})

describe("uploadMPU", () => {
  function setupHappyPath(numParts: number, complete = { url: "u", manageUrl: "m" }) {
    const fetchCalls: { url: string; method: string; body?: BodyInit | null }[] = []
    const partResponses: R2UploadedPart[] = Array.from({ length: numParts }, (_, i) => ({
      partNumber: i + 1,
      etag: `etag${i + 1}`,
    }))
    let partIdx = 0

    const fetchMock = vi.fn<typeof fetch>((input, init = {}) => {
      const url = input instanceof URL ? input.toString() : (input as string)
      fetchCalls.push({ url, method: init.method || "GET", body: init.body as BodyInit | null })
      if (url.includes("/mpu/create")) {
        return Promise.resolve(jsonResp({ name: "~abcd", key: "k", uploadId: "uid" }))
      }
      if (url.includes("/mpu/complete")) {
        return Promise.resolve(jsonResp(complete))
      }
      if (url.includes("/mpu/abort")) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    const xhrCalls = setupXhr((call) => {
      if (call.url.includes("/mpu/resume")) {
        return { status: 200, body: JSON.stringify(partResponses[partIdx++]) }
      }
      throw new Error(`unexpected xhr ${call.url}`)
    })

    return { fetchCalls, xhrCalls, fetchMock }
  }

  it("uploads in chunks, calls progress callback, and forwards optional fields on complete", async () => {
    const { fetchCalls, xhrCalls } = setupHappyPath(3)

    const progress = vi.fn()
    await uploadMPU(
      API_URL,
      4,
      {
        content: makeFile(10, "file.bin"),
        isUpdate: false,
        name: "abcd",
        isPrivate: true,
        password: "pw",
        highlightLanguage: "rust",
        encryptionScheme: "AES-GCM",
        expire: "1d",
      },
      progress,
    )

    // final progress reports full size
    expect(progress).toHaveBeenLastCalledWith(10, 10)
    // each cumulative checkpoint appears at some point
    const progressValues = progress.mock.calls.map((c) => c[0] as number)
    expect(progressValues).toContain(4)
    expect(progressValues).toContain(8)
    expect(progressValues).toContain(10)

    const create = fetchCalls[0]
    expect(create.method).toStrictEqual("POST")
    expect(create.url).toContain("/mpu/create")
    expect(create.url).toContain("n=abcd")
    expect(create.url).toContain("p=1")
    expect(create.url).toContain("e=1d")

    const resumeCalls = xhrCalls.filter((c) => c.url.includes("/mpu/resume"))
    expect(resumeCalls).toHaveLength(3)
    expect(resumeCalls.every((c) => c.method === "PUT")).toBe(true)
    const partNumbers = resumeCalls.map((c) => new URL(c.url).searchParams.get("partNumber")).sort()
    expect(partNumbers).toEqual(["1", "2", "3"])

    const completeReq = fetchCalls.find((c) => c.url.includes("/mpu/complete"))!
    expect(completeReq.method).toStrictEqual("POST")
    const fd = completeReq.body as FormData
    expect(fd.get("e")).toStrictEqual("1d")
    expect(fd.get("s")).toStrictEqual("pw")
    expect(fd.get("lang")).toStrictEqual("rust")
    expect(fd.get("encryption-scheme")).toStrictEqual("AES-GCM")
  })

  it("uses create-update endpoint and PUT on update with manageUrl password", async () => {
    const { fetchCalls } = setupHappyPath(1)

    await uploadMPU(API_URL, 16, {
      content: makeFile(4),
      isUpdate: true,
      manageUrl: "https://example.com/abcd:secretpw",
    })

    expect(fetchCalls[0].url).toContain("/mpu/create-update")
    expect(fetchCalls[0].url).toContain("name=abcd")
    expect(fetchCalls[0].url).toContain("password=secretpw")
    const completeCall = fetchCalls.find((c) => c.url.includes("/mpu/complete"))!
    expect(completeCall.method).toStrictEqual("PUT")
  })

  it("throws TypeError when isUpdate without manageUrl", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(uploadMPU(API_URL, 4, { content: makeFile(4), isUpdate: true })).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws TypeError when manageUrl has no password", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      uploadMPU(API_URL, 4, {
        content: makeFile(4),
        isUpdate: true,
        manageUrl: "https://example.com/abcd",
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws UploadError when create returns non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("name in use", { status: 409 })))

    const err: unknown = await uploadMPU(API_URL, 4, {
      content: makeFile(4),
      isUpdate: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).statusCode).toStrictEqual(409)
  })

  it("throws UploadError when a chunk upload returns non-ok", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = input instanceof URL ? input.toString() : (input as string)
      if (url.includes("/mpu/create")) {
        return Promise.resolve(jsonResp({ name: "~a", key: "k", uploadId: "uid" }))
      }
      if (url.includes("/mpu/abort")) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    setupXhr(() => ({ status: 500, body: "part failed" }))

    const err: unknown = await uploadMPU(API_URL, 4, {
      content: makeFile(8),
      isUpdate: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).statusCode).toStrictEqual(500)

    // Wait a microtask so the fire-and-forget abort fetch has a chance to land.
    await new Promise((r) => setTimeout(r, 0))
    const abortCall = fetchMock.mock.calls.find(([input]) => {
      const url = input instanceof URL ? input.toString() : (input as string)
      return url.includes("/mpu/abort")
    })
    expect(abortCall).toBeDefined()
    const abortUrl = new URL(abortCall![0] instanceof URL ? abortCall![0].toString() : (abortCall![0] as string))
    expect(abortUrl.searchParams.get("key")).toStrictEqual("k")
    expect(abortUrl.searchParams.get("uploadId")).toStrictEqual("uid")
    expect(abortCall![1]?.method).toStrictEqual("POST")
  })

  it("throws UploadError when complete returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) => {
        const url = input instanceof URL ? input.toString() : (input as string)
        if (url.includes("/mpu/create")) {
          return Promise.resolve(jsonResp({ name: "~a", key: "k", uploadId: "uid" }))
        }
        if (url.includes("/mpu/complete")) {
          return Promise.resolve(new Response("complete failed", { status: 502 }))
        }
        if (url.includes("/mpu/abort")) {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`))
      }),
    )
    setupXhr(() => ({ status: 200, body: JSON.stringify({ partNumber: 1, etag: "e" }) }))

    const err: unknown = await uploadMPU(API_URL, 8, {
      content: makeFile(4),
      isUpdate: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).statusCode).toStrictEqual(502)
  })
})
