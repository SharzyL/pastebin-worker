import { verifyAuth } from "../auth.js"
import { decode, genRandStr, isLegalUrl, WorkerError } from "../common.js"
import { createPaste, getPasteMetadata, pasteNameAvailable, updatePaste } from "../storage/storage.js"
import {
  DEFAULT_PASSWD_LEN,
  NAME_REGEX,
  PASTE_NAME_LEN,
  PasteResponse,
  PRIVATE_PASTE_NAME_LEN,
  PASSWD_SEP,
  parseExpiration,
  parsePath,
  MIN_PASSWD_LEN,
  MAX_PASSWD_LEN,
  parseSize,
} from "../shared.js"
import { MaxFileSizeExceededError, MultipartParseError, parseMultipartRequest } from "@mjackson/multipart-parser"

function suggestUrl(short: string, baseUrl: string, filename?: string, contentAsString?: string) {
  if (filename) {
    return `${baseUrl}/${short}/${encodeURIComponent(filename)}`
  } else if (contentAsString && isLegalUrl(contentAsString)) {
    return `${baseUrl}/u/${short}`
  } else {
    return undefined
  }
}

type ParsedMultipartPart = {
  filename?: string
  content: ReadableStream | ArrayBuffer
  contentAsString?: string
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
          })
        } else {
          const arrayBuffer = await part.arrayBuffer()
          partsMap.set(part.name, {
            filename: part.filename,
            content: arrayBuffer,
            contentAsString: decode(arrayBuffer),
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

  const contentType = request.headers.get("Content-Type") || ""
  const url = new URL(request.url)

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
  const nameFromForm = parts.get("n")?.contentAsString
  const isPrivate = parts.has("p")
  const passwdFromForm = parts.get("s")?.contentAsString
  const expireFromPart: string | undefined = parts.get("e")?.contentAsString
  const expire = expireFromPart ? expireFromPart : env.DEFAULT_EXPIRATION

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
  if (nameFromForm !== undefined && !NAME_REGEX.test(nameFromForm)) {
    throw new WorkerError(400, `Name ${nameFromForm} not satisfying regexp ${NAME_REGEX}`)
  }

  function makeResponse(created: PasteResponse): Response {
    return new Response(JSON.stringify(created, null, 2), {
      headers: { "Content-Type": "application/json;charset=UTF-8" },
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
    const { nameFromPath, passwd } = parsePath(url.pathname)
    const originalMetadata = await getPasteMetadata(env, nameFromPath)

    if (originalMetadata === null) {
      throw new WorkerError(404, `paste of name '${nameFromPath}' is not found`)
    } else if (passwd === undefined) {
      throw new WorkerError(403, `no password for paste '${nameFromPath}`)
    } else if (passwd !== originalMetadata.passwd) {
      throw new WorkerError(403, `incorrect password for paste '${nameFromPath}`)
    } else {
      const pasteName = nameFromPath || genRandStr(isPrivate ? PRIVATE_PASTE_NAME_LEN : PASTE_NAME_LEN)
      const newPasswd = passwdFromForm || passwd
      await updatePaste(env, pasteName, content, originalMetadata, {
        expirationSeconds,
        now,
        passwd: newPasswd,
        contentLength,
        filename,
      })
      return makeResponse({
        url: accessUrl(pasteName),
        suggestedUrl: suggestUrl(pasteName, env.DEPLOY_URL, filename, contentAsString),
        manageUrl: manageUrl(pasteName, newPasswd),
        expirationSeconds,
        expireAt: new Date(now.getTime() + 1000 * expirationSeconds).toISOString(),
      })
    }
  } else {
    let pasteName: string | undefined
    if (nameFromForm !== undefined) {
      pasteName = "~" + nameFromForm
      if (!(await pasteNameAvailable(env, pasteName))) {
        throw new WorkerError(409, `name '${pasteName}' is already used`)
      }
    } else {
      pasteName = genRandStr(isPrivate ? PRIVATE_PASTE_NAME_LEN : PASTE_NAME_LEN)
    }

    const passwd = passwdFromForm || genRandStr(DEFAULT_PASSWD_LEN)
    if (passwd.length === 0) {
      throw new WorkerError(400, "Empty passwd is not allowed")
    }
    await createPaste(env, pasteName, content, {
      expirationSeconds,
      now,
      passwd,
      filename,
      contentLength,
    })

    return makeResponse({
      url: accessUrl(pasteName),
      suggestedUrl: suggestUrl(pasteName, env.DEPLOY_URL, filename, contentAsString),
      manageUrl: manageUrl(pasteName, passwd),
      expirationSeconds,
      expireAt: new Date(now.getTime() + 1000 * expirationSeconds).toISOString(),
    })
  }
}
