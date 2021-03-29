import { helpHTML } from './help'
import { makeHighlight } from './highlight'

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
      return await handlePost(request)
    } else if (request.method === "GET") {
      return await handleGet(request)
    } else if (request.method === "DELETE") {
      return await handleDelete(request)
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

async function handlePost(request) {
  const contentType = request.headers.get("content-type") || ""
  const url = new URL(request.url)
  let form = {}
  if (contentType.includes("form")) {
    const formData = await request.formData()
    for (const entry of formData.entries()) { form[entry[0]] = entry[1] }
  } else {
    throw new WorkerError(400, "bad usage, please use formdata")
  }
  const content = form["c"]
  const isPrivate = form["p"] !== undefined
  const expire = form["e"]

  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  } else if (content.length > MAX_LEN) {
    throw new WorkerError(413, "payload too large")
  }

  if (url.pathname.length === 1) {
    const created = await createPaste(content, isPrivate, expire)
    return new Response(JSON.stringify(created, null, 2))
  } else {
    const { short, digest } = parsePath(url.pathname)
    const item = await PB.getWithMetadata(short)
    const date = item.metadata.postedAt
    if (item.value === null) {
      throw new WorkerError(404, "not found")
    } else {
      if (digest !== await hashWithSalt(item.metadata.postedAt + short)) {
        throw new WorkerError(403, "bad handler")
      } else {
        const created = await createPaste(content, isPrivate, expire, short, date)
        return new Response(JSON.stringify(created, null, 2))
      }
    }
  }
}

async function handleGet(request) {
  const url = new URL(request.url)
  const { role, short } = parsePath(url.pathname)
  if (short.length === 0) {
    return new Response(helpHTML, {
      headers: { "content-type": "text/html;charset=UTF-8", }
    })
  }

  const item = await PB.getWithMetadata(short)
  if (item.value === null) {
    throw new WorkerError(404, "not found")
  }

  if (role === "u") {
    return Response.redirect(item.value, 301)
  }

  const lang = url.searchParams.get("lang")
  if (lang) {
    return new Response(makeHighlight(item.value, lang), {
      headers: { "content-type": "text/html;charset=UTF-8", }
    })
  }

  return new Response(item.value)
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
  let role = ""
  if (pathname[2] === "/") {
    role = pathname[1]
    pathname = pathname.slice(2)
  }
  let idx = pathname.indexOf(SEP)
  if (idx < 0) idx = pathname.length
  const short = pathname.slice(1, idx)
  const digest = pathname.slice(idx + 1)
  return { role, short, digest }
}
