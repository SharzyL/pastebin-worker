import { verifyAuth } from "../auth.js"
import {FormDataPart, getBoundary, parseFormdata} from "../parseFormdata.js"
import {
  decode,
  genRandStr,
  isLegalUrl,
  params,
  parseExpiration,
  parsePath,
  WorkerError,
} from "../common.js"
import {createPaste, getPaste, pasteNameAvailable, updatePaste} from "../storage/storage.js";

type PasteResponse = {
  url: string,
  suggestedUrl?: string,
  manageUrl: string,
  expirationSeconds: number,
}

function suggestUrl(content: ArrayBuffer, short: string, baseUrl: string, filename?: string) {
  if (filename) {
    return `${baseUrl}/${short}/${filename}`
  } else if (isLegalUrl(decode(content))) {
    return `${baseUrl}/u/${short}`
  } else {
    return undefined
  }
}

export async function handlePostOrPut(request: Request, env: Env, ctx: ExecutionContext, isPut: boolean): Promise<Response> {
  if (!isPut) {  // only POST requires auth, since PUT request already contains auth
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
  }

  const contentType = request.headers.get("content-type") || ""
  const url = new URL(request.url)

  // parse formdata
  let form: Map<string, FormDataPart> = new Map()
  if (contentType.includes("multipart/form-data")) {
    // because cloudflare runtime treat all formdata part as strings thus corrupting binary data,
    // we need to manually parse formdata
    const uint8Array = new Uint8Array(await request.arrayBuffer())
    try {
      form = parseFormdata(uint8Array, getBoundary(contentType))
    } catch (e) {
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
    (form.has("e") && form.get("e")!.content.byteLength > 0)
      ? decode(form.get("e")!.content)
      : env.DEFAULT_EXPIRATION

  // check if paste content is legal
  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  } else if (content.length > params.MAX_LEN) {
    throw new WorkerError(413, "payload too large")
  }

  // parse expiration
  let expirationSeconds = parseExpiration(expire)
  let maxExpiration = parseExpiration(env.MAX_EXPIRATION)
  if (expirationSeconds > maxExpiration) {
    expirationSeconds = maxExpiration
  }

  // check if name is legal
  if (nameFromForm !== undefined && !params.NAME_REGEX.test(nameFromForm)) {
    throw new WorkerError(
      400,
      `Name ${nameFromForm} not satisfying regexp ${params.NAME_REGEX}`,
    )
  }

  function makeResponse(created: PasteResponse, now: Date): Response {
    return new Response(JSON.stringify({
      ...created,
      expiredAt: new Date(now.getTime() + 1000. * created.expirationSeconds).toISOString(),
    }, null, 2), {
      headers: { "content-type": "application/json;charset=UTF-8" },
    })
  }

  function accessUrl(short: string): string{
    return env.BASE_URL + "/" + short
  }

  function manageUrl(short: string, passwd: string): string {
    return env.BASE_URL + "/" + short + params.SEP + passwd
  }

  let now = new Date()
  if (isPut) {
    const { nameFromPath, passwd } = parsePath(url.pathname)
    const item = await getPaste(env, nameFromPath)

    if (item === null) {
      throw new WorkerError(404, `paste of name '${nameFromPath}' is not found`)
    } else if (passwd === undefined) {
      throw new WorkerError(403, `no password for paste '${nameFromPath}`)
    } else if (passwd !== item.metadata.passwd) {
        throw new WorkerError(403, `incorrect password for paste '${nameFromPath}`)
    } else {
      let pasteName = nameFromPath || genRandStr(isPrivate ? params.PRIVATE_PASTE_NAME_LEN : params.PASTE_NAME_LEN)
      let newPasswd = passwdFromForm || passwd
      await updatePaste(env, pasteName, content, item.metadata, {
        expirationSeconds,
        now,
        passwd: newPasswd,
        filename,
      })
      return makeResponse({
        url: accessUrl(pasteName),
        suggestedUrl: suggestUrl(content, pasteName, env.BASE_URL, filename),
        manageUrl: manageUrl(pasteName, newPasswd),
        expirationSeconds,
      }, now)
    }
  } else {
    let pasteName: string | undefined
    if (nameFromForm !== undefined) {
      pasteName = "~" + nameFromForm
      if (!await pasteNameAvailable(env, pasteName)) {
        throw new WorkerError(409, `name '${pasteName}' is already used`)
      }
    } else {
      pasteName = genRandStr(isPrivate ? params.PRIVATE_PASTE_NAME_LEN : params.PASTE_NAME_LEN)
    }

    let passwd = passwdFromForm || genRandStr(params.DEFAULT_PASSWD_LEN)
    if (passwd.length === 0) {
      throw new WorkerError(400, "Empty passwd is not allowed")
    }
    await createPaste(env, pasteName!, content, {
      expirationSeconds,
      now,
      passwd,
      filename,
    })

    return makeResponse({
        url: accessUrl(pasteName),
        suggestedUrl: suggestUrl(content, pasteName, env.BASE_URL, filename),
        manageUrl: manageUrl(pasteName, passwd),
        expirationSeconds,
    }, now)
  }
}
