// we will move this file to a shared directory later

import type { MPUCreateResponse, PasteResponse } from "./interfaces.js"
import type { EncryptionScheme } from "../frontend/utils/encryption.js"
import { parsePath } from "./parsers.js"

export class UploadError extends Error {
  public statusCode: number

  constructor(statusCode: number, msg: string) {
    super(msg)
    this.statusCode = statusCode
  }
}

export interface UploadOptions {
  content: File
  isUpdate: boolean

  // we allow it to be undefined for convenience
  isPrivate?: boolean

  password?: string
  name?: string

  highlightLanguage?: string
  encryptionScheme?: EncryptionScheme
  expire?: string
  manageUrl?: string
}

export const DEFAULT_MPU_CONCURRENCY = 8

interface XhrSendOptions {
  method: "POST" | "PUT"
  body: XMLHttpRequestBodyInit
  onUploadProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

interface XhrResponse {
  ok: boolean
  status: number
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
}

function xhrSend(url: string | URL, opts: XhrSendOptions): Promise<XhrResponse> {
  // Fallback for non-browser environments (Workers/Node tests): use fetch, no upload progress events.
  if (typeof XMLHttpRequest === "undefined") {
    return fetch(url.toString(), { method: opts.method, body: opts.body, signal: opts.signal }).then((r) => ({
      ok: r.ok,
      status: r.status,
      text: () => r.text(),
      json: <T = unknown>() => r.json() as T,
    }))
  }
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open(opts.method, url.toString())
    if (opts.onUploadProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) opts.onUploadProgress!(e.loaded, e.total)
      })
    }
    const onAbort = () => xhr.abort()
    opts.signal?.addEventListener("abort", onAbort, { once: true })
    xhr.addEventListener("load", () => {
      opts.signal?.removeEventListener("abort", onAbort)
      const body = xhr.responseText
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: () => Promise.resolve(body),
        json: <T>() => Promise.resolve(JSON.parse(body) as T),
      })
    })
    xhr.addEventListener("abort", () => {
      opts.signal?.removeEventListener("abort", onAbort)
      reject(new DOMException("aborted", "AbortError"))
    })
    xhr.addEventListener("error", () => {
      opts.signal?.removeEventListener("abort", onAbort)
      reject(new UploadError(0, "network error"))
    })
    xhr.addEventListener("timeout", () => {
      opts.signal?.removeEventListener("abort", onAbort)
      reject(new UploadError(0, "timeout"))
    })
    xhr.send(opts.body)
  })
}

async function runWithConcurrency<T>(
  count: number,
  limit: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count)
  let next = 0
  let aborted = false
  async function run() {
    while (!aborted) {
      const i = next++
      if (i >= count) return
      try {
        results[i] = await worker(i)
      } catch (e) {
        aborted = true
        throw e
      }
    }
  }
  const runners = Array.from({ length: Math.min(limit, count) }, () => run())
  await Promise.all(runners)
  return results
}

// note that apiUrl should be manageUrl when isUpload
export async function uploadNormal(
  apiUrl: string,
  {
    content,
    isUpdate,
    isPrivate,
    password,
    name,
    highlightLanguage,
    encryptionScheme,
    expire,
    manageUrl,
  }: UploadOptions,
  progressCallback?: (doneBytes: number, allBytes: number) => void,
  signal?: AbortSignal,
): Promise<PasteResponse> {
  const fd = new FormData()

  // typescript cannot handle overload on union types
  fd.set("c", content)

  if (isUpdate && manageUrl === undefined) {
    throw TypeError("uploadMPU: no manageUrl specified in update")
  }

  if (expire !== undefined) fd.set("e", expire)
  if (password !== undefined) fd.set("s", password)
  if (!isUpdate && name !== undefined) fd.set("n", name)
  if (encryptionScheme !== undefined) fd.set("encryption-scheme", encryptionScheme)
  if (highlightLanguage !== undefined) fd.set("lang", highlightLanguage)
  if (isPrivate) fd.set("p", "1")

  const resp = await xhrSend(isUpdate ? manageUrl! : apiUrl, {
    method: isUpdate ? "PUT" : "POST",
    body: fd,
    onUploadProgress: progressCallback
      ? (loaded) => progressCallback(Math.min(loaded, content.size), content.size)
      : undefined,
    signal,
  })

  if (!resp.ok) {
    throw new UploadError(resp.status, await resp.text())
  }

  return await resp.json<PasteResponse>()
}

export async function uploadMPU(
  apiUrl: string,
  chunkSize: number,
  {
    content,
    isUpdate,
    isPrivate,
    password,
    name,
    highlightLanguage,
    encryptionScheme,
    expire,
    manageUrl,
  }: UploadOptions,
  progressCallback?: (doneBytes: number, allBytes: number) => void,
  concurrency: number = DEFAULT_MPU_CONCURRENCY,
  signal?: AbortSignal,
): Promise<PasteResponse> {
  // Internal controller: cancels all in-flight subrequests when one chunk fails or external signal aborts.
  const ctrl = new AbortController()
  const onExternalAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener("abort", onExternalAbort, { once: true })
  }

  try {
    return await doMPU()
  } catch (e) {
    ctrl.abort()
    throw e
  } finally {
    signal?.removeEventListener("abort", onExternalAbort)
  }

  async function doMPU(): Promise<PasteResponse> {
    const createReqUrl = isUpdate ? new URL(`${apiUrl}/mpu/create-update`) : new URL(`${apiUrl}/mpu/create`)
    if (!isUpdate) {
      if (name !== undefined) {
        createReqUrl.searchParams.set("n", name)
      }
      if (isPrivate) {
        createReqUrl.searchParams.set("p", "1")
      }
    } else {
      if (manageUrl === undefined) {
        throw TypeError("uploadMPU: no manageUrl specified in update")
      }
      const { name: nameFromUrl, password: passwordFromUrl } = parsePath(new URL(manageUrl).pathname)
      if (passwordFromUrl === undefined) {
        throw TypeError("uploadMPU: password not specified in manageUrl")
      }
      createReqUrl.searchParams.set("name", nameFromUrl)
      createReqUrl.searchParams.set("password", passwordFromUrl)
    }
    if (expire !== undefined) {
      createReqUrl.searchParams.set("e", expire)
    }

    const createReqResp = await fetch(createReqUrl, { method: "POST", signal: ctrl.signal })
    if (!createReqResp.ok) {
      throw new UploadError(createReqResp.status, await createReqResp.text())
    }
    const createResp: MPUCreateResponse = await createReqResp.json()

    const numParts = Math.ceil(content.size / chunkSize)

    const chunkLoaded = new Array<number>(numParts).fill(0)
    const reportProgress = progressCallback
      ? () =>
          progressCallback(
            chunkLoaded.reduce((a, b) => a + b, 0),
            content.size,
          )
      : undefined
    const uploadedParts = await runWithConcurrency(numParts, concurrency, async (i) => {
      const resumeUrl = new URL(`${apiUrl}/mpu/resume`)
      resumeUrl.searchParams.set("key", createResp.key)
      resumeUrl.searchParams.set("uploadId", createResp.uploadId)
      resumeUrl.searchParams.set("partNumber", (i + 1).toString()) // because partNumber need to nonzero
      const chunk = content.slice(i * chunkSize, (i + 1) * chunkSize)
      const resumeReqResp = await xhrSend(resumeUrl, {
        method: "PUT",
        body: chunk,
        onUploadProgress: reportProgress
          ? (loaded) => {
              chunkLoaded[i] = Math.min(loaded, chunk.size)
              reportProgress()
            }
          : undefined,
        signal: ctrl.signal,
      })
      if (!resumeReqResp.ok) {
        throw new UploadError(resumeReqResp.status, await resumeReqResp.text())
      }
      chunkLoaded[i] = chunk.size
      reportProgress?.()
      return await resumeReqResp.json<R2UploadedPart>()
    })

    const completeFormData = new FormData()
    const completeUrl = new URL(`${apiUrl}/mpu/complete`)
    completeUrl.searchParams.set("name", createResp.name)
    completeUrl.searchParams.set("key", createResp.key)
    completeUrl.searchParams.set("uploadId", createResp.uploadId)
    completeFormData.set("c", new File([JSON.stringify(uploadedParts)], content.name))
    if (expire !== undefined) {
      completeFormData.set("e", expire)
    }
    if (password !== undefined) {
      completeFormData.set("s", password)
    }
    if (highlightLanguage !== undefined) {
      completeFormData.set("lang", highlightLanguage)
    }
    if (encryptionScheme !== undefined) {
      completeFormData.set("encryption-scheme", encryptionScheme)
    }
    const completeReqResp = await fetch(completeUrl, {
      method: isUpdate ? "PUT" : "POST",
      body: completeFormData,
      signal: ctrl.signal,
    })
    if (!completeReqResp.ok) {
      throw new UploadError(completeReqResp.status, await completeReqResp.text())
    }
    const completeResp: PasteResponse = await completeReqResp.json()
    return completeResp
  }
}
