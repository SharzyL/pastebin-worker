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

function suggestUrl(short: string, baseUrl: string, filename?: string, contentAsString?: string) {
  // TODO: should we suggest for URL redirect?
  if (filename) {
    return `${baseUrl}/${short}/${filename}`
  } else if (contentAsString && isLegalUrl(contentAsString)) {
    return `${baseUrl}/u/${short}`
  } else {
    return undefined
  }
}

async function getStringFromPart(part: string | null | File): Promise<string | undefined> {
  if (part === null || typeof part == "string") {
    return part || undefined
  } else {
    return decode(await part.arrayBuffer())
  }
}

async function getFileFromPart(part: string | null | File): Promise<{
  filename?: string
  content?: ReadableStream | ArrayBuffer
  contentAsString?: string
  contentLength: number
}> {
  if (part === null) {
    return { contentLength: 0 }
  } else if (typeof part == "string") {
    const encoded = new TextEncoder().encode(part)
    return { filename: undefined, content: encoded.buffer, contentAsString: part, contentLength: encoded.length }
  } else {
    if (part.size < 1000) {
      const arrayBuffer = await part.arrayBuffer()
      return {
        filename: part.name,
        content: arrayBuffer,
        contentAsString: decode(arrayBuffer),
        contentLength: part.size,
      }
    } else {
      return { filename: part.name, content: part.stream(), contentLength: part.size }
    }
  }
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

  // parse formdata
  if (!contentType.includes("multipart/form-data")) {
    throw new WorkerError(400, `bad usage, please use 'multipart/form-data' instead of ${contentType}`)
  }

  const form = await request.formData()
  const { filename, content, contentAsString, contentLength } = await getFileFromPart(form.get("c"))
  const nameFromForm = await getStringFromPart(form.get("n"))
  const isPrivate = form.get("p") !== null
  const passwdFromForm = await getStringFromPart(form.get("s"))
  const expireFromPart: string | undefined = await getStringFromPart(form.get("e"))
  const expire = expireFromPart !== undefined ? expireFromPart : env.DEFAULT_EXPIRATION

  // check if paste content is legal
  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  } else if (contentLength > parseSize(env.R2_MAX_ALLOWED)!) {
    throw new WorkerError(413, "payload too large")
  }

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
