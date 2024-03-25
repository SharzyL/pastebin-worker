import { WorkerError, parsePath, parseExpiration, genRandStr, decode, params, encodeRFC5987ValueChars, getDispFilename } from "./common.js";
import { handleOptions, corsWrapResponse } from './cors.js'
import { makeHighlight } from "./highlight.js"
import { parseFormdata, getBoundary } from "./parseFormdata.js"
import { getStaticPage } from './staticPages.js'
import { makeMarkdown } from "./markdown.js";

import { getType } from "mime/lite.js"
import {verifyAuth} from "./auth.js";

export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx)
  }
}

async function handleRequest(request, env, ctx) {
  try {
    if (request.method === "OPTIONS") {
      return handleOptions(request)
    } else {
      const response = await handleNormalRequest(request, env, ctx)
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

async function handleNormalRequest(request, env, ctx) {
  if (request.method === "POST") {
    return await handlePostOrPut(request, env, ctx, false)
  } else if (request.method === "GET") {
    return await handleGet(request, env, ctx)
  } else if (request.method === "DELETE") {
    return await handleDelete(request, env, ctx)
  } else if (request.method === "PUT") {
    return await handlePostOrPut(request, env, ctx, true)
  } else {
    throw new WorkerError(405, "method not allowed")
  }
}

async function handlePostOrPut(request, env, ctx, isPut) {
  const authResponse = verifyAuth(request, env)
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
  const filename = form.get("c") && getDispFilename(form.get("c").fields)
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
    const item = await env.PB.getWithMetadata(short)
    if (item.value === null) {
      throw new WorkerError(404, `paste of name '${short}' is not found`)
    } else {
      const date = item.metadata.postedAt
      if (passwd !== item.metadata.passwd) {
        throw new WorkerError(403, `incorrect password for paste '${short}`)
      } else {
        return makeResponse(
          await createPaste(env, content, isPrivate, expirationSeconds, short, date, passwd, filename),
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
      env, content, isPrivate, expirationSeconds, short, undefined, passwd, filename
    ))
  }
}

function staticPageCacheHeader(env) {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "cache-control": `public, max-age=${age}` } : {}
}

function pasteCacheHeader(env) {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "cache-control": `public, max-age=${age}` } : {}
}

function lastModifiedHeader(paste) {
  const lastModified = paste.metadata.lastModified
  return lastModified ? { 'last-modified': new Date(lastModified).toGMTString() } : {}
}

async function handleGet(request, env, ctx) {
  const url = new URL(request.url)
  const { role, short, ext, passwd, filename } = parsePath(url.pathname)

  if (url.pathname == '/favicon.ico' && env.FAVICON) {
    return Response.redirect(env.FAVICON)
  }

  // return the editor for admin URL
  const staticPageContent = getStaticPage((passwd.length > 0) ? "/" : url.pathname, env)
  if (staticPageContent) {
    // access to all static pages requires auth
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
    return new Response(staticPageContent, {
      headers: { "content-type": "text/html;charset=UTF-8", ...staticPageCacheHeader(env) }
    })
  }

  const mime = url.searchParams.get("mime") || getType(ext) || "text/plain"

  const disp = url.searchParams.has("a") ? "attachment" : "inline"

  const item = await env.PB.getWithMetadata(short, { type: "arrayBuffer" })

  // when paste is not found
  if (item.value === null) {
    throw new WorkerError(404, `paste of name '${short}' not found`)
  }

  // check `if-modified-since`
  const pasteLastModified = item.metadata.lastModified
  const headerModifiedSince = request.headers.get('if-modified-since')
  if (pasteLastModified && headerModifiedSince) {
    let pasteLastModifiedMs = Date.parse(pasteLastModified)
    pasteLastModifiedMs -= pasteLastModifiedMs % 1000 // deduct the milliseconds parts
    const headerIfModifiedMs = Date.parse(headerModifiedSince)
    if (pasteLastModifiedMs <= headerIfModifiedMs) {
      return new Response(null, {
        status: 304, // Not Modified
        headers: lastModifiedHeader(item)
      })
    }
  }

  // determine filename with priority: url path > meta
  const returnFilename = filename || item.metadata.filename

  // handle URL redirection
  if (role === "u") {
    return Response.redirect(decode(item.value), 302)
  }

  // handle article (render as markdown)
  if (role === "a") {
    const md = makeMarkdown(decode(item.value))
    return new Response(md, {
      headers: { "content-type": `text/html;charset=UTF-8`, ...pasteCacheHeader(env), ...lastModifiedHeader(item) },
    })
  }

  // handle language highlight
  const lang = url.searchParams.get("lang")
  if (lang) {
    return new Response(makeHighlight(decode(item.value), lang), {
      headers: { "content-type": `text/html;charset=UTF-8`, ...pasteCacheHeader(env) , ...lastModifiedHeader(item)},
    })
  } else {

    // handle default
    const headers = { "content-type": `${mime};charset=UTF-8`, ...pasteCacheHeader(env) , ...lastModifiedHeader(item)}
    if (returnFilename) {
      const encodedFilename = encodeRFC5987ValueChars(returnFilename)
      headers["content-disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
    } else {
      headers["content-disposition"] = `${disp}`
    }
    return new Response(item.value, { headers })
  }
}

async function handleDelete(request, env, ctx) {
  const url = new URL(request.url)
  const { short, passwd } = parsePath(url.pathname)
  const item = await env.PB.getWithMetadata(short)
  if (item.value === null) {
    throw new WorkerError(404, `paste of name '${short}' not found`)
  } else {
    if (passwd !== item.metadata.passwd) {
      throw new WorkerError(403, `incorrect password for paste '${short}`)
    } else {
      await env.PB.delete(short)
      return new Response("the paste will be deleted in seconds")
    }
  }
}

async function createPaste(env, content, isPrivate, expire, short, createDate, passwd, filename) {
  createDate = createDate || new Date().toISOString()
  passwd = passwd || genRandStr(params.ADMIN_PATH_LEN)
  const short_len = isPrivate ? params.PRIVATE_RAND_LEN : params.RAND_LEN

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
      lastModified: new Date().toISOString(),
    },
  })
  let accessUrl = env.BASE_URL + '/' + short
  const adminUrl = env.BASE_URL + '/' + short + params.SEP + passwd
  return {
    url: accessUrl,
    suggestUrl: suggestUrl(content, filename, short, env.BASE_URL),
    admin: adminUrl,
    isPrivate: isPrivate,
    expire: expire || null,
  }
}

function suggestUrl(content, filename, short, baseUrl) {
  function isUrl(text) {
    try {
      new URL(text)
      return true
    } catch (e) {
      return false
    }
  }

  if (filename) {
    return `${baseUrl}/${short}/${filename}`
  } else if (isUrl(decode(content))) {
    return `${baseUrl}/u/${short}`
  } else {
    return null
  }
}
