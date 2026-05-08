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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("UploadError", () => {
  it("stores status code on instance", () => {
    const err = new UploadError(418, "I'm a teapot")
    expect(err).toBeInstanceOf(Error)
    expect(err.statusCode).toStrictEqual(418)
    expect(err.message).toStrictEqual("I'm a teapot")
  })
})

type FetchCall = [input: string | URL, init: RequestInit]

describe("uploadNormal", () => {
  it("POSTs to apiUrl on create and returns parsed json", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResp({ url: "https://example.com/abcd", manageUrl: "https://example.com/abcd:pw" }))
    vi.stubGlobal("fetch", fetchMock)

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
    expect(fetchMock).toHaveBeenCalledOnce()
    const [target, init] = fetchMock.mock.calls[0] as FetchCall
    expect(target).toStrictEqual(API_URL)
    expect(init.method).toStrictEqual("POST")

    const fd = init.body as FormData
    expect(fd.get("e")).toStrictEqual("10m")
    expect(fd.get("s")).toStrictEqual("pw")
    expect(fd.get("n")).toStrictEqual("abcd")
    expect(fd.get("encryption-scheme")).toStrictEqual("AES-GCM")
    expect(fd.get("lang")).toStrictEqual("ts")
    expect(fd.get("p")).toStrictEqual("1")
    expect(fd.get("c")).toBeInstanceOf(File)
  })

  it("PUTs to manageUrl on update and skips name field", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResp({ url: "u", manageUrl: "m" }))
    vi.stubGlobal("fetch", fetchMock)

    await uploadNormal(API_URL, {
      content: makeFile(8),
      isUpdate: true,
      manageUrl: "https://example.com/abcd:pw",
      name: "abcd", // should be ignored on update
    })

    const [target, init] = fetchMock.mock.calls[0] as FetchCall
    expect(target).toStrictEqual("https://example.com/abcd:pw")
    expect(init.method).toStrictEqual("PUT")
    expect((init.body as FormData).get("n")).toBeNull()
  })

  it("throws TypeError when isUpdate without manageUrl", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(uploadNormal(API_URL, { content: makeFile(8), isUpdate: true })).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws UploadError carrying statusCode on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("bad name", { status: 400 })))

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
    const calls: { url: string; method: string; body?: BodyInit | null }[] = []
    const partResponses: R2UploadedPart[] = Array.from({ length: numParts }, (_, i) => ({
      partNumber: i + 1,
      etag: `etag${i + 1}`,
    }))
    let partIdx = 0
    const fetchMock = vi.fn<typeof fetch>((input, init = {}) => {
      const url = input instanceof URL ? input.toString() : (input as string)
      calls.push({ url, method: init.method || "GET", body: init.body as BodyInit | null })
      if (url.includes("/mpu/create")) {
        return Promise.resolve(jsonResp({ name: "~abcd", key: "k", uploadId: "uid" }))
      }
      if (url.includes("/mpu/resume")) {
        return Promise.resolve(jsonResp(partResponses[partIdx++]))
      }
      if (url.includes("/mpu/complete")) {
        return Promise.resolve(jsonResp(complete))
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    return { calls, fetchMock }
  }

  it("uploads in chunks, calls progress callback, and forwards optional fields on complete", async () => {
    const { calls } = setupHappyPath(3)

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

    expect(progress).toHaveBeenCalledTimes(3)
    expect(progress.mock.calls[0]).toEqual([4, 10])
    expect(progress.mock.calls[1]).toEqual([8, 10])
    expect(progress.mock.calls[2]).toEqual([10, 10])

    const create = calls[0]
    expect(create.method).toStrictEqual("POST")
    expect(create.url).toContain("/mpu/create")
    expect(create.url).toContain("n=abcd")
    expect(create.url).toContain("p=1")
    expect(create.url).toContain("e=1d")

    expect(calls[1].method).toStrictEqual("PUT")
    expect(calls[1].url).toContain("/mpu/resume")
    expect(calls[1].url).toContain("partNumber=1")
    expect(calls[3].url).toContain("partNumber=3")

    const complete = calls[4]
    expect(complete.url).toContain("/mpu/complete")
    expect(complete.method).toStrictEqual("POST")
    const fd = complete.body as FormData
    expect(fd.get("e")).toStrictEqual("1d")
    expect(fd.get("s")).toStrictEqual("pw")
    expect(fd.get("lang")).toStrictEqual("rust")
    expect(fd.get("encryption-scheme")).toStrictEqual("AES-GCM")
  })

  it("uses create-update endpoint and PUT on update with manageUrl password", async () => {
    const { calls } = setupHappyPath(1)

    await uploadMPU(API_URL, 16, {
      content: makeFile(4),
      isUpdate: true,
      manageUrl: "https://example.com/abcd:secretpw",
    })

    expect(calls[0].url).toContain("/mpu/create-update")
    expect(calls[0].url).toContain("name=abcd")
    expect(calls[0].url).toContain("password=secretpw")
    expect(calls[2].method).toStrictEqual("PUT")
    expect(calls[2].url).toContain("/mpu/complete")
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
    let call = 0
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => {
        call++
        if (call === 1) return Promise.resolve(jsonResp({ name: "~a", key: "k", uploadId: "uid" }))
        return Promise.resolve(new Response("part failed", { status: 500 }))
      }),
    )

    const err: unknown = await uploadMPU(API_URL, 4, {
      content: makeFile(8),
      isUpdate: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).statusCode).toStrictEqual(500)
  })

  it("throws UploadError when complete returns non-ok", async () => {
    let call = 0
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => {
        call++
        if (call === 1) return Promise.resolve(jsonResp({ name: "~a", key: "k", uploadId: "uid" }))
        if (call === 2) return Promise.resolve(jsonResp({ partNumber: 1, etag: "e" }))
        return Promise.resolve(new Response("complete failed", { status: 502 }))
      }),
    )

    const err: unknown = await uploadMPU(API_URL, 8, {
      content: makeFile(4),
      isUpdate: false,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).statusCode).toStrictEqual(502)
  })
})
