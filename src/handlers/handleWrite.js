import { verifyAuth } from "../auth.js"
import { getBoundary, parseFormdata } from "../parseFormdata.js"
import {
  decode,
  genRandStr,
  getDispFilename,
  isLegalUrl,
  params,
  parseExpiration,
  parsePath,
  WorkerError,
} from "../common.js"

async function createPaste(env, content, isPrivate, expire, short, createDate, passwd, filename) {
  const now = new Date().toISOString()
  createDate = createDate || now
  passwd = passwd || genRandStr(params.ADMIN_PATH_LEN)
  const short_len = isPrivate ? params.PRIVATE_RAND_LEN : params.RAND_LEN

  // repeat until finding an unused name
  if (short === undefined) {
    while (true) {
      short = genRandStr(short_len)
      if ((await env.PB.get(short)) === null) break
    }
  }

  await env.PB.put(short, content, {
    expirationTtl: expire,
    metadata: {
      postedAt: createDate,
      passwd: passwd,
      filename: filename,
      lastModified: now,
    },
  })
  let accessUrl = env.BASE_URL + "/" + short
  const adminUrl = env.BASE_URL + "/" + short + params.SEP + passwd
  return {
    url: accessUrl,
    suggestUrl: suggestUrl(content, filename, short, env.BASE_URL),
    admin: adminUrl,
    isPrivate: isPrivate,
    expire: expire || null,
  }
}

function suggestUrl(content, filename, short, baseUrl) {
  if (filename) {
    return `${baseUrl}/${short}/${filename}`
  } else if (isLegalUrl(decode(content))) {
    return `${baseUrl}/u/${short}`
  } else {
    return null
  }
}

export async function handlePostOrPut(request, env, ctx, isPut) {
  if (!isPut) {  // only POST requires auth, since PUT request already contains auth
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
  }

  const contentType = request.headers.get("content-type") || ""
  const url = new URL(request.url)

  // parse formdata
  let form = {}
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
  const content = form.get("c") && form.get("c").content
  const filename = form.get("c") && getDispFilename(form.get("c").fields)
  const name = form.get("n") && decode(form.get("n").content)
  const isPrivate = form.get("p") !== undefined
  const newPasswd = form.get("s") && decode(form.get("s").content)
  const expire =
    form.has("e") && form.get("e").content.byteLength > 0
      ? decode(form.get("e").content)
      : undefined

  // check if paste content is legal
  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  } else if (content.length > params.MAX_LEN) {
    throw new WorkerError(413, "payload too large")
  }

  // check if expiration is legal
  let expirationSeconds = undefined
  if (expire !== undefined) {
    expirationSeconds = parseExpiration(expire)
    if (isNaN(expirationSeconds)) {
      throw new WorkerError(400, `cannot parse expire ${expirationSeconds} as an number`)
    }
    if (expirationSeconds < 60) {
      throw new WorkerError(
        400,
        `due to limitation of Cloudflare, expire should be a integer greater than 60, '${expirationSeconds}' given`,
      )
    }
  }

  // check if name is legal
  if (name !== undefined && !params.NAME_REGEX.test(name)) {
    throw new WorkerError(
      400,
      `Name ${name} not satisfying regexp ${params.NAME_REGEX}`,
    )
  }

  function makeResponse(created) {
    return new Response(JSON.stringify(created, null, 2), {
      headers: { "content-type": "application/json;charset=UTF-8" },
    })
  }

  if (isPut) {
    const { short, passwd } = parsePath(url.pathname)
    const item = await env.PB.getWithMetadata(short)
    if (item.value === null) {
      throw new WorkerError(404, `paste of name '${short}' is not found`)
    } else {
      const date = item.metadata?.postedAt
      if (passwd !== item.metadata?.passwd) {
        throw new WorkerError(403, `incorrect password for paste '${short}`)
      } else {
        return makeResponse(
          await createPaste(env, content, isPrivate, expirationSeconds, short, date, newPasswd || passwd, filename),
        )
      }
    }
  } else {
    let short = undefined
    if (name !== undefined) {
      short = "~" + name
      if ((await env.PB.get(short)) !== null)
        throw new WorkerError(409, `name '${name}' is already used`)
    }
    return makeResponse(await createPaste(
      env, content, isPrivate, expirationSeconds, short, undefined, newPasswd, filename,
    ))
  }
}
