import { helpHTML } from './indexPage'
import { makeHighlight } from './highlight'
import { makeUploadedPage } from './uploadedPage'
import MimeTypes from 'mime-type/with-db.js'

const CHAR_GEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-=@';
const RAND_LEN = 4
const PRIVATE_RAND_LEN = 24
const SEP = '_'
const MAX_LEN = 5 * 1024 * 1024

class WorkerError extends Error {
  constructor(statusCode, ...params) {
    super(...params);
    this.statusCode = statusCode
  }
}

addEventListener('fetch', event => {
  const { request } = event
  return event.respondWith(handleRequest(request))
})

async function handleRequest(request) {
  try {
    if (request.method === "POST") {
      return await handlePostOrPut(request, false)
    } else if (request.method === "GET") {
      return await handleGet(request)
    } else if (request.method === "DELETE") {
      return await handleDelete(request)
    } else if (request.method === "PUT") {
      return await handlePostOrPut(request, true)
    }
  } catch (e) {
    console.log(e.stack)
    if (e instanceof WorkerError) {
      return new Response(e.message, {status: e.statusCode})
    } else {
      return new Response(e.message, {status: 500})
    }
  }
}

async function handlePostOrPut(request, isPut) {
  const contentType = request.headers.get("content-type") || ""
  const url = new URL(request.url)

  // parse formdata
  let form = {}
  if (contentType.includes("form")) {
    const formData = await request.formData()
    for (const entry of formData.entries()) { form[entry[0]] = entry[1] }
  } else {
    throw new WorkerError(400, "bad usage, please use formdata")
  }
  const content = form["c"]
  const name = form["n"]
  const isPrivate = form["p"] !== undefined
  const isHuman = form["h"] !== undefined  // return a JSON or a human friendly page?
  let expire = form["e"]

  // check if paste content is legal
  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  } else if (content.length > MAX_LEN) {
    throw new WorkerError(413, "payload too large")
  }

  // check if expiration is legal
  if (/^\s*$/.test(expire)) expire = undefined  // if `expire` is empty string, set it to undefined
  if (expire !== undefined) {
    expire = parseInt(expire)
    if (isNaN(expire)) {
      throw new WorkerError(400, "cannot parse expire as an integer")
    }
    if (expire < 60) {
      throw new WorkerError(400, "due to limitation of Cloudflare, expire should be a integer greater than 60")
    }
  }

  // check if name is legal
  if (name && !/[a-zA-Z0-9+-=@]{3,}/.test(name)) {
    throw new WorkerError(400, "Name not satisfying regexp ~[a-zA-Z0-9+-=@]{3,}")
  }

  function makeResponse(created) {
    if (isHuman) {
      return new Response(makeUploadedPage(created), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      })
    } else {
      return new Response(JSON.stringify(created, null, 2), {
        headers: { "content-type": "application/json;charset=UTF-8" }
      })
    }
  }

  if (isPut) {
    const { short, digest } = parsePath(url.pathname)
    const item = await PB.getWithMetadata(short)
    const date = item.metadata.postedAt
    if (item.value === null) {
      throw new WorkerError(404, "not found")
    } else {
      if (digest !== await hashWithSalt(item.metadata.postedAt + short)) {
        throw new WorkerError(403, "bad handler")
      } else {
        return makeResponse(await createPaste(content, isPrivate, expire, short, date))
      }
    }
  } else {
    let short = undefined
    if (name !== undefined) {
      short = '~' + name
      if (await PB.get(short) !== null)
        throw new WorkerError(400, `name '${name}' is already used`)
    }
    return makeResponse(await createPaste(content, isPrivate, expire, short))
  }
}

async function handleGet(request) {
  const url = new URL(request.url)
  if (url.pathname === '/') {
    return new Response(helpHTML, {
      headers: { "content-type": "text/html;charset=UTF-8", }
    })
  }

  const { role, short, ext } = parsePath(url.pathname)
  const mime = url.searchParams.get("mime") || MimeTypes.lookup(ext) || "text/plain"

  const item = await PB.getWithMetadata(short)

  // when paste is not found
  if (item.value === null) {
    throw new WorkerError(404, "not found")
  }

  // handle URL redirection
  if (role === "u") {
    return Response.redirect(item.value, 301)
  }

  // handle language highlight
  const lang = url.searchParams.get("lang")
  if (lang) {
    return new Response(makeHighlight(item.value, lang), {
      headers: { "content-type": `text/html;charset=UTF-8`, }
    })
  } else {
    return new Response(item.value, {
      headers: { "content-type": `${mime};charset=UTF-8`, }
    })
  }

}

async function handleDelete(request) {
  const url = new URL(request.url)
  const { short, digest } = parsePath(url.pathname)
  const item = await PB.getWithMetadata(short)
  if (item.value === null) {
    throw new WorkerError(404, "not found")
  } else {
    if (digest !== await hashWithSalt(item.metadata.postedAt + short)) {
      throw new WorkerError(403, "bad handler")
    } else {
      await PB.delete(short)
      return new Response("the paste will be deleted in seconds")
    }
  }
}

async function createPaste(content, isPrivate, expire, short, date) {
  date = date || new Date().toISOString()

  let short_len = RAND_LEN
  if (isPrivate) short_len = PRIVATE_RAND_LEN

  if (short === undefined) {
    while (true) {
      short = genRandStr(short_len);
      if (await PB.get(short) === null) break
    }
  }

  await PB.put(short, content, {
    expirationTtl: expire,
    metadata: {
      postedAt: date,
    }
  })
  const digest = await hashWithSalt(date + short)
  let accessUrl = BASE_URL + short
  const adminUrl = BASE_URL + short + SEP + digest
  return {
    url: accessUrl,
    admin: adminUrl,
    isPrivate: isPrivate,
    expire: expire
  }
}

function genRandStr(len) {
  let str = '';
  const numOfRand = CHAR_GEN.length
  for (let i = 0; i < len; i++) {
    str += CHAR_GEN.charAt(Math.floor(Math.random() * numOfRand))
  }
  return str
}

async function hashWithSalt(data) {
  const text = new TextEncoder().encode(data + SALT)
  const digest = await crypto.subtle.digest(
    {name: "SHA-1"}, text
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

function parsePath(pathname) {
  // Example of paths (SEP='_'). Note: query string is not processed here
  // example.com/abcd
  // example.com/abcd_3ffd2e7ff214989646e006bd9ad36c58d447065e
  // example.com/u/abcd
  // example.com/u/abcd_3ffd2e7ff214989646e006bd9ad36c58d447065e
  let role = "", ext = ""
  if (pathname[2] === "/") {
    role = pathname[1]
    pathname = pathname.slice(2)
  }
  let startOfExt = pathname.indexOf('.')
  if (startOfExt >= 0) {
    ext = pathname.slice(startOfExt)
    pathname = pathname.slice(0, startOfExt)
  }
  let endOfShort = pathname.indexOf(SEP)
  if (endOfShort < 0) endOfShort = pathname.length  // when there is no SEP, digest is left empty
  const short = pathname.slice(1, endOfShort)
  const digest = pathname.slice(endOfShort + 1)
  return { role, short, digest, ext }
}
