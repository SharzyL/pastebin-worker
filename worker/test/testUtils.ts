import { env } from "cloudflare:test"

import { expect } from "vitest"
import crypto from "crypto"

import worker from "../index"
import { PasteResponse } from "../../shared/interfaces"

export const BASE_URL: string = env.DEPLOY_URL
export const RAND_NAME_REGEX = /^[ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678]+$/

export const staticPages = ["", "index.html", "index", "tos", "tos.html", "api", "api.html", "favicon.ico"]

type FormDataBuild = {
  [key: string]: string | Blob | { content: Blob; filename: string }
}

export async function workerFetch(ctx: ExecutionContext, req: Request | string) {
  // we are not using SELF.fetch since it sometimes do not print worker log to console
  // return await SELF.fetch(req, options)
  return await worker.fetch(new Request(req), env, ctx)
}

export async function upload(
  ctx: ExecutionContext,
  kv: FormDataBuild,
  options: {
    method?: "POST" | "PUT"
    url?: string
    headers?: Record<string, string>
    context?: string
  } = {},
): Promise<PasteResponse> {
  const method = options.method || "POST"
  const url = options.url || BASE_URL
  const headers = options.headers || {}
  const uploadResponse = await workerFetch(
    ctx,
    new Request(url, {
      method,
      body: createFormData(kv),
      headers,
    }),
  )
  if (uploadResponse.status !== 200) {
    let uploadMsg = await uploadResponse.text()
    if (options.context) uploadMsg += ` ${options.context}`
    throw new Error(uploadMsg)
  }
  expect(uploadResponse.headers.get("Content-Type")).toStrictEqual("application/json;charset=UTF-8")
  return JSON.parse(await uploadResponse.text()) as PasteResponse
}

export async function uploadExpectStatus(
  ctx: ExecutionContext,
  kv: FormDataBuild,
  expectedStatuus: number,
  options: {
    method?: "POST" | "PUT"
    url?: string
    headers?: Record<string, string>
    context?: string
  } = {},
): Promise<void> {
  const method = options.method || "POST"
  const url = options.url || BASE_URL
  const headers = options.headers || {}
  const uploadResponse = await workerFetch(
    ctx,
    new Request(url, {
      method,
      body: createFormData(kv),
      headers,
    }),
  )
  if (uploadResponse.status !== expectedStatuus) {
    let uploadMsg = await uploadResponse.text()
    if (options.context) uploadMsg += ` ${options.context}`
    throw new Error(uploadMsg)
  }
}

export function createFormData(kv: FormDataBuild): FormData {
  const fd = new FormData()
  Object.entries(kv).forEach(([k, v]) => {
    if (typeof v === "string") {
      fd.set(k, v)
    } else if (v instanceof Blob) {
      fd.set(k, v, "") // fd.set automatically set filename to k, not what we desired
    } else {
      // hack for typing
      const { content, filename } = v as { content: Blob; filename: string }
      fd.set(k, content, filename)
    }
  })
  return fd
}

export function genRandomBlob(len: number): Blob {
  const buf = Buffer.alloc(len)
  const chunkSize = 4096
  for (let i = 0; i < len; i += chunkSize) {
    const fillLen = Math.min(len - i, chunkSize)
    crypto.randomFillSync(buf, i, fillLen)
  }
  return new Blob([buf])
}

export async function areBlobsEqual(blob1: Blob, blob2: Blob) {
  if (blob1.size !== blob2.size) {
    return false
  }
  const array1 = await blob1.bytes()
  const array2 = await blob2.bytes()
  for (let i = 0; i < blob1.size; i++) {
    if (array1[i] != array2[i]) {
      return false
    }
  }
  return true
}

// replace https://example.com/xxx to https://example.com/${role}/xxx
export function addRole(url: string, role: string): string {
  const splitPoint = env.DEPLOY_URL.length
  return url.slice(0, splitPoint) + "/" + role + url.slice(splitPoint)
}
