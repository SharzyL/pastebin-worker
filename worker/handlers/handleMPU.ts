import type { MPUCreateResponse } from "../../shared/interfaces.js"
import { NAME_REGEX, PASTE_NAME_LEN, PRIVATE_PASTE_NAME_LEN } from "../../shared/constants.js"
import { dateToUnix, genRandStr, WorkerError, timingSafeEqual } from "../common.js"
import { getPasteMetadata, pasteNameAvailable } from "../storage/storage.js"
import { parseExpiration, parseSize } from "../../shared/parsers.js"

function mpuExpireMetadata(url: URL, env: Env): Record<string, string> {
  const expireParam = url.searchParams.get("e")
  const expirationSeconds = expireParam ? parseExpiration(expireParam) : null
  const maxExpiration = parseExpiration(env.MAX_EXPIRATION)!
  const effectiveExpiration = expirationSeconds ? Math.min(expirationSeconds, maxExpiration) : maxExpiration
  const willExpireAtUnix = dateToUnix(new Date()) + effectiveExpiration
  return { willExpireAtUnix: String(willExpireAtUnix) }
}

// POST /mpu/create?n=<optional n>&p=<optional isPrivate>&e=<optional expire>
// returns JSON { name: string, key: string, uploadId: string }
export async function handleMPUCreate(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const n = url.searchParams.get("n")
  const isPrivate = url.searchParams.get("p") !== null

  let name: string | undefined
  if (n) {
    if (!NAME_REGEX.test(n)) {
      throw new WorkerError(400, `illegal paste name ‘${n}’ for MPU create`)
    }
    name = "~" + n
    if (!(await pasteNameAvailable(env, name))) {
      throw new WorkerError(409, `name ‘${name}’ is already used`)
    }
  } else {
    name = genRandStr(isPrivate ? PRIVATE_PASTE_NAME_LEN : PASTE_NAME_LEN)
  }

  const multipartUpload = await env.R2.createMultipartUpload(name, {
    customMetadata: mpuExpireMetadata(url, env),
  })
  const resp: MPUCreateResponse = {
    name,
    key: multipartUpload.key,
    uploadId: multipartUpload.uploadId,
  }
  return new Response(JSON.stringify(resp))
}

// POST /mpu/create-update?name=<name>&password=<password>
// returns JSON { name: string, key: string, uploadId: string }
export async function handleMPUCreateUpdate(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const name = url.searchParams.get("name")
  const password = url.searchParams.get("password")
  if (name === null || password === null) {
    throw new WorkerError(400, `missing name or password (password) in searchParams`)
  }

  const metadata = await getPasteMetadata(env, name)
  if (metadata === null) {
    throw new WorkerError(404, `paste of name ‘${name}’ is not found`)
  }
  if (!timingSafeEqual(password, metadata.passwd)) {
    throw new WorkerError(403, `incorrect password for paste ‘${name}’`)
  }

  const multipartUpload = await env.R2.createMultipartUpload(name, {
    customMetadata: mpuExpireMetadata(url, env),
  })
  const resp: MPUCreateResponse = {
    name,
    key: multipartUpload.key,
    uploadId: multipartUpload.uploadId,
  }
  return new Response(JSON.stringify(resp))
}

// PUT /mpu/resume?key=<key>&uploadId=<uploadId>&partNumber=<partNumber>
// return JSON { partNumber: number, etag: string }
export async function handleMPUResume(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  const uploadId = url.searchParams.get("uploadId")
  const partNumberString = url.searchParams.get("partNumber")
  const key = url.searchParams.get("key")
  if (partNumberString === null || uploadId === null || key === null) {
    throw new WorkerError(400, "missing partNumber or uploadId or key in searchParams")
  }
  if (request.body === null) {
    throw new WorkerError(400, "missing request body")
  }

  const partNumber = parseInt(partNumberString)
  const multipartUpload = env.R2.resumeMultipartUpload(key, uploadId)
  let uploadedPart: R2UploadedPart
  try {
    uploadedPart = await multipartUpload.uploadPart(partNumber, request.body)
  } catch (e) {
    // Most commonly: uploadId has been aborted, completed, or expired. R2 may also
    // throw transient service errors here, but those are rare enough that lumping
    // them as 410 is acceptable — the client retries from /mpu/create either way.
    console.warn(`MPU resume failed for key=${key}, uploadId=${uploadId}, part=${partNumber}: ${String(e)}`)
    throw new WorkerError(410, "multipart upload no longer exists; please retry from /mpu/create")
  }
  return new Response(JSON.stringify(uploadedPart))
}

// POST /mpu/abort?key=<key>&uploadId=<uploadId>
// Releases R2-side multipart state for an upload that won't be completed.
// Knowing key + uploadId is the auth: both are returned from /mpu/create
// to whoever initiated the upload and aren't stored elsewhere.
// Idempotent: an unknown / already-aborted / completed uploadId still returns 204.
export async function handleMPUAbort(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const uploadId = url.searchParams.get("uploadId")
  const key = url.searchParams.get("key")
  if (uploadId === null || key === null) {
    throw new WorkerError(400, "missing uploadId or key in searchParams")
  }
  try {
    await env.R2.resumeMultipartUpload(key, uploadId).abort()
  } catch (e) {
    console.warn(`MPU abort failed for key=${key}, uploadId=${uploadId}: ${String(e)}`)
  }
  return new Response(null, { status: 204 })
}

// POST /mpu/complete?name=<name>&key=<key>&uploadId=<uploadId>
// formdata same as POST/PUT a normal paste, but
//   - field `c` is interpreted as JSON { partNumber: number, etag: string }[]
//   - field `n` is ignored
export async function handleMPUComplete(request: Request, env: Env, completeBody: R2UploadedPart[]): Promise<R2Object> {
  const url = new URL(request.url)
  const uploadId = url.searchParams.get("uploadId")
  const key = url.searchParams.get("key")
  const name = url.searchParams.get("name")
  if (uploadId === null || key === null || name === null) {
    throw new WorkerError(400, `no uploadId or key for MPU complete`)
  }

  const multipartUpload = env.R2.resumeMultipartUpload(key, uploadId)
  if (name !== multipartUpload.key) {
    throw new WorkerError(400, `name ‘${name}’ is not consistent with the originally specified name`)
  }

  let object: R2Object
  try {
    object = await multipartUpload.complete(completeBody)
  } catch (e) {
    console.warn(`MPU complete failed for key=${key}, uploadId=${uploadId}: ${String(e)}`)
    throw new WorkerError(410, "multipart upload no longer exists; please retry from /mpu/create")
  }
  if (object.size > parseSize(env.R2_MAX_ALLOWED)!) {
    // Best-effort cleanup; if delete fails we still want the 413 to reach the user.
    try {
      await env.R2.delete(object.key)
    } catch (e) {
      console.warn(`failed to delete oversized MPU object '${object.key}': ${String(e)}`)
    }
    throw new WorkerError(413, `payload too large (max ${env.R2_MAX_ALLOWED} allowed)`)
  }
  return object
}
