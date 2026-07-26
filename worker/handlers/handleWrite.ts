import { verifyAuth } from "../pages/auth.js"
import { decode, genRandStr, WorkerError, timingSafeEqual } from "../common.js"
import {
  createPaste,
  allocateRandomPasteName,
  getPasteMetadata,
  metaResponseFromMetadata,
  pasteNameAvailable,
  updatePaste,
} from "../storage/storage.js"
import {
  BINARY_MIME_TYPE,
  DEFAULT_PASSWD_LEN,
  DIRECT_UPLOAD_MAX_BYTES,
  PASTE_NAME_LEN,
  PRIVATE_PASTE_NAME_LEN,
  PASSWD_SEP,
  TEXT_MIME_TYPE,
} from "../../shared/constants.js"
import { parsePath, parseSize, parseExpiration } from "../../shared/parsers.js"
import { isOriginalFileInfo, parseReadLimit, verifyName, verifyPassword } from "../../shared/verify.js"
import type { OriginalFileInfo, PasteResponse } from "../../shared/interfaces.js"
import {
  handleMPUAbort,
  handleMPUComplete,
  handleMPUCreate,
  handleMPUCreateUpdate,
  handleMPUResume,
} from "./handleMPU.js"

interface ParsedMultipartPart {
  filename?: string
  content: ArrayBuffer
  contentAsString: () => string
  contentLength: number
}

function parseOriginalFileInfos(raw: string | undefined): OriginalFileInfo[] | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new WorkerError(400, "invalid filenames metadata")
  }
  if (!Array.isArray(parsed)) {
    throw new WorkerError(400, "invalid filenames metadata")
  }
  return parsed.map((item) => {
    if (!isOriginalFileInfo(item)) {
      throw new WorkerError(400, "invalid filenames metadata")
    }
    return { name: item.name, sizeBytes: item.sizeBytes }
  })
}

function parseMimeType(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (raw === TEXT_MIME_TYPE || raw === BINARY_MIME_TYPE) return raw
  throw new WorkerError(400, "invalid mimeType metadata")
}

function parseRemainingReads(raw: string | undefined, defaultReads: number): number | undefined {
  const remainingReads = parseReadLimit(raw === undefined ? defaultReads : raw)
  if (remainingReads === null) {
    throw new WorkerError(400, "invalid reads limit")
  }
  return remainingReads === 0 ? undefined : remainingReads
}

async function multipartToMap(
  req: Request,
  maxPartSize: number,
  sizeLimitLabel: string,
): Promise<Map<string, ParsedMultipartPart>> {
  const partsMap = new Map<string, ParsedMultipartPart>()
  let formData: FormData

  try {
    formData = await req.formData()
  } catch (err) {
    console.warn("Failed to parse multipart request:", err instanceof Error ? err.message : err)
    throw new WorkerError(400, "Failed to parse multipart request")
  }

  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") {
      const bytes = new TextEncoder().encode(value)
      if (bytes.byteLength > maxPartSize) {
        throw new WorkerError(413, `payload too large (max ${sizeLimitLabel} allowed)`)
      }
      partsMap.set(name, {
        content: bytes.buffer,
        contentLength: bytes.byteLength,
        contentAsString: () => value,
      })
    } else {
      if (value.size > maxPartSize) {
        throw new WorkerError(413, `payload too large (max ${sizeLimitLabel} allowed)`)
      }
      const arrayBuffer = await value.arrayBuffer()
      partsMap.set(name, {
        filename: value.name,
        content: arrayBuffer,
        contentLength: arrayBuffer.byteLength,
        contentAsString: () => decode(arrayBuffer),
      })
    }
  }

  return partsMap
}

export async function handlePostOrPut(
  request: Request,
  env: Env,
  _: ExecutionContext,
  isPut: boolean,
): Promise<Response> {
  if (!isPut) {
    // only POST requires auth, since PUT request already contains auth
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
  }

  const url = new URL(request.url)

  let isMPUComplete = false
  if (url.pathname === "/mpu/create" && !isPut) {
    return await handleMPUCreate(request, env)
  } else if (url.pathname === "/mpu/create-update" && !isPut) {
    return await handleMPUCreateUpdate(request, env)
  } else if (url.pathname === "/mpu/resume" && isPut) {
    return await handleMPUResume(request, env)
  } else if (url.pathname === "/mpu/abort" && !isPut) {
    return await handleMPUAbort(request, env)
  } else if (url.pathname === "/mpu/complete") {
    isMPUComplete = true // we will handle mpu complete later since it is uploaded with formdata
  } else if (url.pathname.startsWith("/mpu/")) {
    throw new WorkerError(400, "illegal mpu operation")
  }

  const contentType = request.headers.get("Content-Type") || ""

  // parse formdata
  if (!contentType.includes("multipart/form-data")) {
    throw new WorkerError(400, `bad usage, please use 'multipart/form-data' instead of ${contentType}`)
  }

  const parts = isMPUComplete
    ? await multipartToMap(request, parseSize(env.R2_MAX_ALLOWED)!, env.R2_MAX_ALLOWED)
    : await multipartToMap(request, DIRECT_UPLOAD_MAX_BYTES, "5 MiB")

  if (!parts.has("c")) {
    throw new WorkerError(400, "cannot find content in formdata")
  }
  const { filename, content, contentAsString, contentLength } = parts.get("c")!
  const nameFromForm = parts.get("n")?.contentAsString()
  const isPrivate = parts.has("p")
  const passwdFromForm = parts.get("s")?.contentAsString()
  const expireFromForm: string | undefined = parts.get("e")?.contentAsString()
  const encryptionScheme: string | undefined = parts.get("encryption-scheme")?.contentAsString()
  const highlightLanguage = parts.get("lang")?.contentAsString()
  const filenames = parseOriginalFileInfos(parts.get("filenames")?.contentAsString())
  const mimeType = parseMimeType(parts.get("mimeType")?.contentAsString())
  const remainingReads = parseRemainingReads(parts.get("reads")?.contentAsString(), env.DEFAULT_READS)
  const expire = expireFromForm ? expireFromForm : env.DEFAULT_EXPIRATION

  const uploadedParts = isMPUComplete ? (JSON.parse(contentAsString()) as R2UploadedPart[]) : undefined

  // parse expiration
  let expirationSeconds = parseExpiration(expire)
  if (expirationSeconds === null) {
    throw new WorkerError(400, `‘${expire}’ is not a valid expiration specification`)
  }
  const maxExpiration = parseExpiration(env.MAX_EXPIRATION)!
  if (expirationSeconds > maxExpiration) {
    expirationSeconds = maxExpiration
  }

  // check if password is legal
  if (passwdFromForm) {
    const [ok, msg] = verifyPassword(passwdFromForm)
    if (!ok) throw new WorkerError(400, msg)
  }

  // check if name is legal
  if (nameFromForm !== undefined && isPut) {
    throw new WorkerError(400, `Cannot set name for a PUT request`)
  }
  if (nameFromForm !== undefined) {
    const [ok, msg] = verifyName(nameFromForm)
    if (!ok) throw new WorkerError(400, msg)
  }

  function makeResponse(created: PasteResponse, additionalHeaders: Record<string, string | undefined> = {}): Response {
    return new Response(JSON.stringify(created, null, 2), {
      headers: { "Content-Type": "application/json;charset=UTF-8", ...additionalHeaders },
    })
  }

  function accessUrl(short: string): string {
    return env.DEPLOY_URL + "/" + short
  }

  function manageUrl(short: string, passwd: string): string {
    return env.DEPLOY_URL + "/" + short + PASSWD_SEP + passwd
  }

  const now = new Date()
  if (isPut) {
    let pasteName: string | undefined
    let password: string | undefined
    // if isMPUComplete, we cannot parse path
    if (!isMPUComplete) {
      const parsed = parsePath(url.pathname)
      if (parsed.password === undefined) {
        throw new WorkerError(403, `no password for PUT request`)
      }
      pasteName = parsed.name
      password = parsed.password
    } else {
      pasteName = url.searchParams.get("name") || undefined
      if (pasteName === undefined) {
        throw new WorkerError(400, `no name for MPU complete`)
      }
    }

    const r2Object = isMPUComplete ? await handleMPUComplete(request, env, uploadedParts!) : undefined

    const originalMetadata = await getPasteMetadata(env, pasteName)
    if (originalMetadata === null) {
      throw new WorkerError(404, `paste of name ‘${pasteName}’ is not found`)
    }

    // no need to check password for MPCComplete, it is already checked on creation
    if (!isMPUComplete && !timingSafeEqual(password, originalMetadata.passwd)) {
      throw new WorkerError(403, `incorrect password for paste ‘${pasteName}’`)
    }

    const newPasswd = passwdFromForm || originalMetadata.passwd
    const newMetadata = await updatePaste(env, pasteName, content, originalMetadata, {
      expirationSeconds,
      now,
      passwd: newPasswd,
      contentLength: r2Object?.size || contentLength,
      filename,
      filenames,
      mimeType,
      highlightLanguage,
      encryptionScheme,
      remainingReads,
      isMPUComplete,
    })
    return makeResponse(
      {
        ...metaResponseFromMetadata(newMetadata),
        url: accessUrl(pasteName),
        manageUrl: manageUrl(pasteName, newPasswd),
        expirationSeconds,
      },
      { etag: r2Object?.httpEtag },
    )
  } else {
    let pasteName: string | undefined
    if (isMPUComplete) {
      if (url.searchParams.has("name")) {
        pasteName = url.searchParams.get("name")!
      } else {
        throw new WorkerError(400, `no name for MPU complete`)
      }
    } else if (nameFromForm !== undefined) {
      pasteName = "~" + nameFromForm
      if (!(await pasteNameAvailable(env, pasteName))) {
        throw new WorkerError(409, `name '${pasteName}' is already used`)
      }
    } else {
      pasteName = await allocateRandomPasteName(env, isPrivate ? PRIVATE_PASTE_NAME_LEN : PASTE_NAME_LEN)
    }

    const r2Object = isMPUComplete ? await handleMPUComplete(request, env, uploadedParts!) : undefined

    const password = passwdFromForm || genRandStr(DEFAULT_PASSWD_LEN)
    const newMetadata = await createPaste(env, pasteName, content, {
      expirationSeconds,
      now,
      passwd: password,
      filename,
      filenames,
      mimeType,
      highlightLanguage,
      contentLength: r2Object?.size || contentLength,
      encryptionScheme,
      remainingReads,
      isMPUComplete,
    })

    return makeResponse(
      {
        ...metaResponseFromMetadata(newMetadata),
        url: accessUrl(pasteName),
        manageUrl: manageUrl(pasteName, password),
        expirationSeconds,
      },
      { etag: r2Object?.httpEtag },
    )
  }
}
