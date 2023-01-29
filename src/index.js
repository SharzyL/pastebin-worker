import { WorkerError, parsePath, parseExpiration, genRandStr, decode, params } from "./common.js";
import { handleOptions, corsWrapResponse } from './cors.js'
import { makeHighlight } from "./highlight.js"
import { parseFormdata, getBoundary } from "./parseFormdata.js"
import { staticPageMap } from './staticPages.js'
import { makeMarkdown } from "./markdown.js";
import conf_production from '../config.json'
import conf_preview from '../config.preview.json'

const conf = globalThis.ENVIRONMENT === "preview" ? conf_preview : conf_production

import { getType } from "mime/lite.js"
import {verifyAuth} from "./auth.js";

addEventListener("fetch", (event) => {
  const { request } = event
  return event.respondWith(handleRequest(request))
})

async function handleRequest(request) {
  try {
    if (request.method === "OPTIONS") {
      return handleOptions(request)
    } else {
      const response = await handleNormalRequest(request)
      if (response.status !== 302 && response.headers !== undefined) {  // because Cloudflare do not allow modifying redirect headers
        response.headers.set("Access-Control-Allow-Origin", "*")
      }
      return response
    }
  } catch (e) {
    console.log(e.stack)
    if (e instanceof WorkerError) {
      return corsWrapResponse(new Response(`Error ${e.statusCode}: ${e.message}\n`, { status: e.statusCode }))
    } else {
      return corsWrapResponse(new Response(`Error 500: ${e.message}\n`, { status: 500 }))
    }
  }
}

async function handleNormalRequest(request) {
  if (request.method === "POST") {
    return await handlePostOrPut(request, false)
  } else if (request.method === "GET") {
    return await handleGet(request)
  } else if (request.method === "DELETE") {
    return await handleDelete(request)
  } else if (request.method === "PUT") {
    return await handlePostOrPut(request, true)
  } else {
    throw new WorkerError(405, "method not allowed")
  }
}

async function handlePostOrPut(request, isPut) {
  const authResponse = verifyAuth(request)
  if (authResponse !== null) {
    return authResponse
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
  const filename = form.get("c") && form.get("c").fields.filename
  const name = form.get("n") && decode(form.get("n").content)
  const isPrivate = form.get("p") !== undefined
  const passwd = form.get("s") && decode(form.get("s").content)
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
    const item = await PB.getWithMetadata(short)
    if (item.value === null) {
      throw new WorkerError(404, `paste of name '${short}' is not found`)
    } else {
      const date = item.metadata.postedAt
      if (passwd !== item.metadata.passwd) {
        throw new WorkerError(403, `incorrect password for paste '${short}`)
      } else {
        return makeResponse(
          await createPaste(content, isPrivate, expirationSeconds, short, date, passwd, filename),
        )
      }
    }
  } else {
    let short = undefined
    if (name !== undefined) {
      short = "~" + name
      if ((await PB.get(short)) !== null)
        throw new WorkerError(409, `name '${name}' is already used`)
    }
    return makeResponse(await createPaste(
      content, isPrivate, expirationSeconds, short, undefined, passwd, filename
    ))
  }
}

async function handleGet(request) {
  const url = new URL(request.url)
  const { role, short, ext, passwd } = parsePath(url.pathname)
  if (staticPageMap.has(url.pathname)) {
    // access to all static pages requires auth
    const authResponse = verifyAuth(request)
    if (authResponse !== null) {
      return authResponse
    }
    const item = await PB.get(staticPageMap.get(url.pathname))
    return new Response(item, {
      headers: { "content-type": "text/html;charset=UTF-8" }
    })
  }

  // return the editor for admin URL
  if (passwd.length > 0) {
    const item = await PB.get('index')
    return new Response(item, {
      headers: { "content-type": "text/html;charset=UTF-8" }
    })
  }

  const mime = url.searchParams.get("mime") || getType(ext) || "text/plain"

  const item = await PB.getWithMetadata(short, { type: "arrayBuffer" })

  // when paste is not found
  if (item.value === null) {
    throw new WorkerError(404, `paste of name '${short}' not found`)
  }

  // handle URL redirection
  if (role === "u") {
    return Response.redirect(decode(item.value), 302)
  }
  if (role === "a") {
    const md = await makeMarkdown(decode(item.value))
    return new Response(md, {
      headers: { "content-type": `text/html;charset=UTF-8` },
    })
  }

  // handle language highlight
  const lang = url.searchParams.get("lang")
  if (lang) {
    return new Response(makeHighlight(decode(item.value), lang), {
      headers: { "content-type": `text/html;charset=UTF-8` },
    })
  } else {
    return new Response(item.value, {
      headers: { "content-type": `${mime};charset=UTF-8` },
    })
  }
}

async function handleDelete(request) {
  const url = new URL(request.url)
  console.log(request.url)
  const { short, passwd } = parsePath(url.pathname)
  const item = await PB.getWithMetadata(short)
  console.log(item, passwd)
  if (item.value === null) {
    throw new WorkerError(404, `paste of name '${short}' not found`)
  } else {
    if (passwd !== item.metadata.passwd) {
      throw new WorkerError(403, `incorrect password for paste '${short}`)
    } else {
      await PB.delete(short)
      return new Response("the paste will be deleted in seconds")
    }
  }
}

async function createPaste(content, isPrivate, expire, short, date, passwd, filename) {
  date = date || new Date().toISOString()
  passwd = passwd || genRandStr(params.ADMIN_PATH_LEN)
  const short_len = isPrivate ? params.PRIVATE_RAND_LEN : params.RAND_LEN

  if (short === undefined) {
    while (true) {
      short = genRandStr(short_len)
      if ((await PB.get(short)) === null) break
    }
  }

  await PB.put(short, content, {
    expirationTtl: expire,
    metadata: {
      postedAt: date,
      passwd: passwd
    },
  })
  let accessUrl = conf.BASE_URL + '/' + short
  const adminUrl = conf.BASE_URL + '/' + short + params.SEP + passwd
  return {
    url: accessUrl,
    suggestUrl: suggestUrl(content, filename, short),
    admin: adminUrl,
    isPrivate: isPrivate,
    expire: expire,
  }
}

function suggestUrl(content, filename, short) {
  function isUrl(text) {
    try {
      new URL(text)
      return true
    } catch (e) {
      return false
    }
  }

  if (isUrl(decode(content))) {
    return `${conf.BASE_URL}/u/${short}`
  }
  if (filename) {
    const dotIdx = filename.lastIndexOf('.')
    if (dotIdx > 0) {
      const ext = filename.slice(dotIdx + 1)
      return `${conf.BASE_URL}/${short}.${ext}`
    }
  }
  return null
}
