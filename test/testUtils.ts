import { env } from "cloudflare:test"

import { expect } from "vitest"
import crypto from "crypto"

import worker from "../src/index.js"
import { PasteResponse } from "../src/shared"

export const BASE_URL: string = env.DEPLOY_URL
export const RAND_NAME_REGEX = /^[ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678]+$/

export const staticPages = ["", "index.html", "index", "tos", "tos.html", "api", "api.html"]

type FormDataBuild = {
  [key: string]: string | Blob | { content: Blob; filename: string }
}

export async function workerFetch(ctx: ExecutionContext, req: Request | string) {
  // we are not using SELF.fetch since it sometimes do not print worker log to console
  // return await SELF.fetch(req, options)
  return await worker.fetch(new Request(req), env, ctx)
}

export async function upload(ctx: ExecutionContext, kv: FormDataBuild): Promise<PasteResponse> {
  const uploadResponse = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "POST",
      body: createFormData(kv),
    }),
  )
  if (uploadResponse.status !== 200) {
    const uploadMsg = await uploadResponse.text()
    console.log(`failed upload response ${uploadMsg}`)
  }
  expect(uploadResponse.status).toStrictEqual(200)
  expect(uploadResponse.headers.get("Content-Type")).toStrictEqual("application/json;charset=UTF-8")
  return JSON.parse(await uploadResponse.text()) as PasteResponse
}

export async function uploadExpectStatus(ctx: ExecutionContext, kv: FormDataBuild, expectedStatsu: number) {
  const uploadResponse = await workerFetch(
    ctx,
    new Request(BASE_URL, {
      method: "POST",
      body: createFormData(kv),
    }),
  )
  const uploadMsg = await uploadResponse.text()
  expect(
    uploadResponse.status,
    `Upload status not expected: (expecting ${expectedStatsu}): ${uploadMsg}`,
  ).toStrictEqual(expectedStatsu)
}

export function createFormData(kv: FormDataBuild): FormData {
  const fd = new FormData()
  Object.entries(kv).forEach(([k, v]) => {
    if (typeof v === "string") {
      fd.set(k, v)
    } else if (v instanceof Blob) {
      fd.set(k, v)
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
  return new Blob([crypto.randomFillSync(buf, 0, len)])
}

export async function areBlobsEqual(blob1: Blob, blob2: Blob) {
  return Buffer.from(await blob1.arrayBuffer()).compare(Buffer.from(await blob2.arrayBuffer())) === 0
}
