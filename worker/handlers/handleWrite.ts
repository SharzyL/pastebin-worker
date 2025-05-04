import { verifyAuth } from "../pages/auth.js"
import { decode, genRandStr, WorkerError } from "../common.js"
import { createPaste, getPasteMetadata, pasteNameAvailable, updatePaste } from "../storage/storage.js"
import {
  DEFAULT_PASSWD_LEN,
  NAME_REGEX,
  PASTE_NAME_LEN,
  PRIVATE_PASTE_NAME_LEN,
  PASSWD_SEP,
  MIN_PASSWD_LEN,
  MAX_PASSWD_LEN,
} from "../../shared/constants.js"
import { parsePath, parseSize, parseExpiration } from "../../shared/parsers.js"
import { PasteResponse } from "../../shared/interfaces.js"
import { MaxFileSizeExceededError, MultipartParseError, parseMultipartRequest } from "@mjackson/multipart-parser"
import { handleMPUComplete, handleMPUCreate, handleMPUCreateUpdate, handleMPUResume } from "./handleMPU.js"

type ParsedMultipartPart = {
  filename?: string
  content: ReadableStream | ArrayBuffer
  contentAsString: () => string
  contentLength: number
}

async function multipartToMap(req: Request, sizeLimit: number): Promise<Map<string, ParsedMultipartPart>> {
  const partsMap = new Map<string, ParsedMultipartPart>()
  try {
    await parseMultipartRequest(req, { maxFileSize: sizeLimit }, async (part) => {
      if (part.name) {
        if (part.isFile) {
          const arrayBuffer = await part.arrayBuffer()
          partsMap.set(part.name, {
            filename: part.filename,
            content: arrayBuffer,
            contentLength: arrayBuffer.byteLength,
            contentAsString: () => decode(arrayBuffer),
          })
        } else {
          const arrayBuffer = await part.arrayBuffer()
          partsMap.set(part.name, {
            filename: part.filename,
            content: arrayBuffer,
            contentAsString: () => decode(arrayBuffer),
            contentLength: arrayBuffer.byteLength,
          })
        }
      }
    })
  } catch (err) {
    if (err instanceof MaxFileSizeExceededError) {
      throw new WorkerError(413, `payload too large (max ${sizeLimit} bytes allowed)`)
    } else if (err instanceof MultipartParseError) {
      console.error(err)
      throw new WorkerError(400, "Failed to parse multipart request")
    } else {
      throw err
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
    return handleMPUCreate(request, env)
  } else if (url.pathname === "/mpu/create-update" && !isPut) {
    return handleMPUCreateUpdate(request, env)
  } else if (url.pathname === "/mpu/resume" && isPut) {
    return handleMPUResume(request, env)
  } else if (url.pathname === "/mpu/complete") {
    isMPUComplete = true // we will handle mpu complete later since it is uploaded with formdata
  } else if (url.pathname.startsWith("/mpu/")) {
    throw new WorkerError(400, "illegal mpu operation")
  }

  const contentType = request.headers.get("Content-Type") || ""

  // TODO: support multipart upload (https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)

  // parse formdata
  if (!contentType.includes("multipart/form-data")) {
    throw new WorkerError(400, `bad usage, please use 'multipart/form-data' instead of ${contentType}`)
  }

  const parts = await multipartToMap(request, parseSize(env.R2_MAX_ALLOWED)!)

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
  // TODO: sync checks to frontend
  if (passwdFromForm) {
    if (passwdFromForm.length > MAX_PASSWD_LEN) {
      throw new WorkerError(400, `password too long (${passwdFromForm.length} > ${MAX_PASSWD_LEN})`)
    } else if (passwdFromForm.length < MIN_PASSWD_LEN) {
      throw new WorkerError(400, `password too short (${passwdFromForm.length} < ${MIN_PASSWD_LEN})`)
    } else if (passwdFromForm.includes("\n")) {
      throw new WorkerError(400, `password should not contain newline`)
    }
  }

  // check if name is legal
  if (nameFromForm !== undefined && isPut) {
    throw new WorkerError(400, `Cannot set name for a PUT request`)
  }
  if (nameFromForm !== undefined && !NAME_REGEX.test(nameFromForm)) {
    throw new WorkerError(400, `Name ${nameFromForm} not satisfying regexp ${NAME_REGEX}`)
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
    // if isMPCComplete, we cannot parse path
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

    const etag = isMPUComplete ? await handleMPUComplete(request, env, uploadedParts!) : undefined

    const originalMetadata = await getPasteMetadata(env, pasteName)
    if (originalMetadata === null) {
      throw new WorkerError(404, `paste of name ‘${pasteName}’ is not found`)
    }

    // no need to check password for MPCComplete, it is already checked on creation
    if (!isMPUComplete && password !== originalMetadata.passwd) {
      throw new WorkerError(403, `incorrect password for paste ‘${pasteName}’`)
    }

    const newPasswd = passwdFromForm || originalMetadata.passwd
    await updatePaste(env, pasteName, content, originalMetadata, {
      expirationSeconds,
      now,
      passwd: newPasswd,
      contentLength,
      filename,
      highlightLanguage,
      encryptionScheme,
      isMPUComplete,
    })
    return makeResponse(
      {
        url: accessUrl(pasteName),
        manageUrl: manageUrl(pasteName, newPasswd),
        expirationSeconds,
        expireAt: new Date(now.getTime() + 1000 * expirationSeconds).toISOString(),
      },
      { etag },
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
      pasteName = genRandStr(isPrivate ? PRIVATE_PASTE_NAME_LEN : PASTE_NAME_LEN)
    }

    const etag = isMPUComplete ? await handleMPUComplete(request, env, uploadedParts!) : undefined

    const password = passwdFromForm || genRandStr(DEFAULT_PASSWD_LEN)
    await createPaste(env, pasteName, content, {
      expirationSeconds,
      now,
      passwd: password,
      filename,
      highlightLanguage,
      contentLength,
      encryptionScheme,
      isMPUComplete,
    })

    return makeResponse(
      {
        url: accessUrl(pasteName),
        manageUrl: manageUrl(pasteName, password),
        expirationSeconds,
        expireAt: new Date(now.getTime() + 1000 * expirationSeconds).toISOString(),
      },
      { etag },
    )
  }
}
