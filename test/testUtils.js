import { env, ctx } from "cloudflare:test"

import { expect } from "vitest"
import crypto from "crypto"
import worker from "../src/index.js"

export const BASE_URL = env["BASE_URL"]
export const RAND_NAME_REGEX = /^[ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678]+$/

export const staticPages = ["", "index.html", "index", "tos", "tos.html", "api", "api.html"]

export async function workerFetch(req, options) {
  // we are not using SELF.fetch since it sometimes do not print worker log to console
  // return await SELF.fetch(req, options)
  return await worker.fetch(new Request(req, options), env, ctx)
}

export async function workerFetchWithAuth(usersKv, req, options) {
  const newEnv = Object.assign({ BASIC_AUTH: usersKv }, env)
  return await worker.fetch(new Request(req, options), newEnv, ctx)
}

export async function upload(kv) {
  const uploadResponse = await workerFetch(new Request(BASE_URL, {
    method: "POST",
    body: createFormData(kv),
  }))
  expect(uploadResponse.status).toStrictEqual(200)
  expect(uploadResponse.headers.get("Content-Type")).toStrictEqual("application/json;charset=UTF-8")
  return JSON.parse(await uploadResponse.text())
}

export function createFormData(kv) {
  const fd = new FormData()
  Object.entries(kv).forEach(([k, v]) => {
    if ((v === Object(v)) && "filename" in v && "value" in v) {
      fd.set(k, new File([v.value], v.filename))
    } else {
      fd.set(k, v)
    }
  })
  return fd
}

export function randomBlob(len) {
  const buf = Buffer.alloc(len)
  return new Blob([crypto.randomFillSync(buf, 0, len)])
}

export async function areBlobsEqual(blob1, blob2) {
  return Buffer.from(await blob1.arrayBuffer()).compare(
    Buffer.from(await blob2.arrayBuffer()),
  ) === 0
}

