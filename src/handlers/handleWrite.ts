import { verifyAuth } from "../auth.js"
import { FormDataPart, getBoundary, parseFormdata } from "../parseFormdata.js"
import { decode, genRandStr, isLegalUrl, WorkerError } from "../common.js"
import { createPaste, getPasteMetadata, pasteNameAvailable, updatePaste } from "../storage/storage.js"
import {
  DEFAULT_PASSWD_LEN,
  MAX_LEN,
  NAME_REGEX,
  PASTE_NAME_LEN,
  PasteResponse,
  PRIVATE_PASTE_NAME_LEN,
  PASSWD_SEP,
  parseExpiration,
  parsePath,
} from "../shared.js"

function suggestUrl(content: ArrayBuffer, short: string, baseUrl: string, filename?: string) {
  if (filename) {
    return `${baseUrl}/${short}/${filename}`
  } else if (isLegalUrl(decode(content))) {
    return `${baseUrl}/u/${short}`
  } else {
    return undefined
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
  let form: Map<string, FormDataPart> = new Map()
  if (contentType.includes("multipart/form-data")) {
    // because cloudflare runtime treat all formdata part as strings thus corrupting binary data,
    // we need to manually parse formdata
    const uint8Array = new Uint8Array(await request.arrayBuffer())
    try {
      form = parseFormdata(uint8Array, getBoundary(contentType))
    } catch {
      throw new WorkerError(400, "error occurs when parsing formdata")
    }
  } else {
    throw new WorkerError(400, `bad usage, please use 'multipart/form-data' instead of ${contentType}`)
  }

  const content = form.get("c")?.content
  const filename = form.get("c") && form.get("c")!.disposition.filename
  const nameFromForm = form.get("n") && decode(form.get("n")!.content)
  const isPrivate = form.get("p")
  const passwdFromForm = form.get("s") && decode(form.get("s")!.content)
  const expire: string =
    form.has("e") && form.get("e")!.content.byteLength > 0 ? decode(form.get("e")!.content) : env.DEFAULT_EXPIRATION

  // check if paste content is legal
  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  } else if (content.length > MAX_LEN) {
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
        filename,
      })
      return makeResponse({
        url: accessUrl(pasteName),
        suggestedUrl: suggestUrl(content, pasteName, env.DEPLOY_URL, filename),
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
    })

    return makeResponse({
      url: accessUrl(pasteName),
      suggestedUrl: suggestUrl(content, pasteName, env.DEPLOY_URL, filename),
      manageUrl: manageUrl(pasteName, passwd),
      expirationSeconds,
      expireAt: new Date(now.getTime() + 1000 * expirationSeconds).toISOString(),
    })
  }
}
