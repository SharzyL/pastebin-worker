// we will move this file to a shared directory later

import type { MPUCreateResponse, OriginalFileInfo, PasteResponse } from "./interfaces.js"
import type { EncryptionScheme } from "./constants.js"
import { BINARY_MIME_TYPE, TEXT_MIME_TYPE } from "./constants.js"
import { hasBinaryMarker } from "./encoding.js"
import { parsePath } from "./parsers.js"
import { mapIndicesWithConcurrency } from "./async.js"

export class UploadError extends Error {
  public statusCode: number

  constructor(statusCode: number, msg: string) {
    super(msg)
    this.statusCode = statusCode
  }
}

export interface UploadOptions {
  content: File
  filenames?: OriginalFileInfo[]
  isUpdate: boolean

  // we allow it to be undefined for convenience
  isPrivate?: boolean

  password?: string
  name?: string

  highlightLanguage?: string
  encryptionScheme?: EncryptionScheme
  inferMimeType?: boolean
  expire?: string
  remainingReads?: number
  manageUrl?: string
}

export interface MPUUploadSource {
  name: string
  size: number
  partCount: number
  getPart: (index: number, signal: AbortSignal) => Promise<Blob>
}

const DEFAULT_MPU_CONCURRENCY = 8
const MPU_PROGRESS_THROTTLE_MS = 75

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

function filenameHasExtension(filename: string): boolean {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"))
  const basename = filename.slice(lastSlash + 1)
  return basename.lastIndexOf(".") > 0
}

async function inferMimeTypeFromContent(
  content: File,
  options?: { ignoreFilename?: boolean },
): Promise<string | undefined> {
  if (!options?.ignoreFilename && filenameHasExtension(content.name)) return undefined
  return (await hasBinaryMarker(content)) ? BINARY_MIME_TYPE : TEXT_MIME_TYPE
}

async function maybeAddMimeType(
  fd: FormData,
  content: File,
  encryptionScheme: EncryptionScheme | undefined,
  inferMimeType: boolean | undefined,
): Promise<void> {
  if (inferMimeType !== true) return
  if (encryptionScheme !== undefined) return

  const mimeType = await inferMimeTypeFromContent(content)
  if (mimeType !== undefined) fd.set("mimeType", mimeType)
}

interface UploadMetadataOptions {
  content: File
  filenames?: OriginalFileInfo[]
  password?: string
  highlightLanguage?: string
  encryptionScheme?: EncryptionScheme
  inferMimeType?: boolean
  expire?: string
  remainingReads?: number
}

async function appendUploadMetadata(fd: FormData, options: UploadMetadataOptions): Promise<void> {
  await maybeAddMimeType(fd, options.content, options.encryptionScheme, options.inferMimeType)
  if (options.filenames !== undefined) fd.set("filenames", JSON.stringify(options.filenames))
  if (options.expire !== undefined) fd.set("e", options.expire)
  if (options.remainingReads !== undefined) fd.set("reads", String(options.remainingReads))
  if (options.password !== undefined) fd.set("s", options.password)
  if (options.encryptionScheme !== undefined) fd.set("encryption-scheme", options.encryptionScheme)
  if (options.highlightLanguage !== undefined) fd.set("lang", options.highlightLanguage)
}

// note that apiUrl should be manageUrl when isUpload
export async function uploadNormal(
  apiUrl: string,
  {
    content,
    filenames,
    isUpdate,
    isPrivate,
    password,
    name,
    highlightLanguage,
    encryptionScheme,
    inferMimeType,
    expire,
    remainingReads,
    manageUrl,
  }: UploadOptions,
  progressCallback?: (doneBytes: number, allBytes: number) => void,
  signal?: AbortSignal,
): Promise<PasteResponse> {
  const fd = new FormData()

  // typescript cannot handle overload on union types
  fd.set("c", content)
  await appendUploadMetadata(fd, {
    content,
    filenames,
    password,
    highlightLanguage,
    encryptionScheme,
    inferMimeType,
    expire,
    remainingReads,
  })

  if (isUpdate && manageUrl === undefined) {
    throw TypeError("uploadMPU: no manageUrl specified in update")
  }

  if (!isUpdate && name !== undefined) fd.set("n", name)
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
  options: UploadOptions,
  progressCallback?: (doneBytes: number, allBytes: number) => void,
  concurrency: number = DEFAULT_MPU_CONCURRENCY,
  signal?: AbortSignal,
): Promise<PasteResponse> {
  const { content } = options
  const partCount = Math.ceil(content.size / chunkSize)
  return await uploadMPUSource(
    apiUrl,
    {
      name: content.name,
      size: content.size,
      partCount,
      getPart: (index) => Promise.resolve(content.slice(index * chunkSize, (index + 1) * chunkSize)),
    },
    options,
    progressCallback,
    concurrency,
    signal,
  )
}

async function abortMultipartUpload(apiUrl: string, createResp: MPUCreateResponse): Promise<void> {
  const abortUrl = new URL(`${apiUrl}/mpu/abort`)
  abortUrl.searchParams.set("key", createResp.key)
  abortUrl.searchParams.set("uploadId", createResp.uploadId)
  try {
    // This request is intentionally detached from the upload signal. keepalive
    // lets the browser finish submitting it when pagehide triggered the abort.
    const cleanupRequest = fetch(abortUrl, { method: "POST", keepalive: true }).then(
      () => undefined,
      () => undefined,
    )
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        cleanupRequest,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 5000)
        }),
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  } catch {
    // Multipart cleanup is best-effort and must not replace the original error.
  }
}

export async function uploadMPUSource(
  apiUrl: string,
  source: MPUUploadSource,
  {
    content,
    filenames,
    isUpdate,
    isPrivate,
    password,
    name,
    highlightLanguage,
    encryptionScheme,
    inferMimeType,
    expire,
    remainingReads,
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

  // Captured once /mpu/create succeeds; used by the catch to release R2-side parts.
  let createResp: MPUCreateResponse | undefined

  try {
    return await doMPU()
  } catch (e) {
    ctrl.abort()
    if (createResp) await abortMultipartUpload(apiUrl, createResp)
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
    const parsedCreateResp: MPUCreateResponse = await createReqResp.json()
    createResp = parsedCreateResp
    const { key: createKey, uploadId: createUploadId, name: createName } = parsedCreateResp

    if (!Number.isInteger(source.partCount) || source.partCount < 1) {
      throw new TypeError("uploadMPUSource: partCount must be a positive integer")
    }

    const chunkLoaded = new Array<number>(source.partCount).fill(0)
    let totalLoaded = 0
    let lastReportedLoaded = -1
    let lastReportedAt = Number.NEGATIVE_INFINITY
    const reportProgress = progressCallback
      ? (force = false) => {
          if (totalLoaded === lastReportedLoaded) return
          const now = performance.now()
          if (!force && now - lastReportedAt < MPU_PROGRESS_THROTTLE_MS) return
          lastReportedAt = now
          lastReportedLoaded = totalLoaded
          progressCallback(totalLoaded, source.size)
        }
      : undefined
    const updatePartProgress = (index: number, loaded: number, partSize: number) => {
      const previous = chunkLoaded[index]
      const next = Math.max(previous, Math.min(Math.max(loaded, 0), partSize))
      chunkLoaded[index] = next
      totalLoaded += next - previous
      reportProgress?.()
    }
    const uploadedParts = await mapIndicesWithConcurrency(source.partCount, concurrency, async (i) => {
      const resumeUrl = new URL(`${apiUrl}/mpu/resume`)
      resumeUrl.searchParams.set("key", createKey)
      resumeUrl.searchParams.set("uploadId", createUploadId)
      resumeUrl.searchParams.set("partNumber", (i + 1).toString()) // because partNumber need to nonzero
      const chunk = await source.getPart(i, ctrl.signal)
      ctrl.signal.throwIfAborted()
      const resumeReqResp = await xhrSend(resumeUrl, {
        method: "PUT",
        body: chunk,
        onUploadProgress: reportProgress
          ? (loaded) => {
              updatePartProgress(i, loaded, chunk.size)
            }
          : undefined,
        signal: ctrl.signal,
      })
      if (!resumeReqResp.ok) {
        throw new UploadError(resumeReqResp.status, await resumeReqResp.text())
      }
      updatePartProgress(i, chunk.size, chunk.size)
      return await resumeReqResp.json<R2UploadedPart>()
    })
    reportProgress?.(true)

    const completeFormData = new FormData()
    const completeUrl = new URL(`${apiUrl}/mpu/complete`)
    completeUrl.searchParams.set("name", createName)
    completeUrl.searchParams.set("key", createKey)
    completeUrl.searchParams.set("uploadId", createUploadId)
    completeFormData.set("c", new File([JSON.stringify(uploadedParts)], source.name))
    await appendUploadMetadata(completeFormData, {
      content,
      filenames,
      password,
      highlightLanguage,
      encryptionScheme,
      inferMimeType,
      expire,
      remainingReads,
    })
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
