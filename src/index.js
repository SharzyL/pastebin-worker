import { handleOptions } from './cors.js'
import { makeHighlight } from "./highlight.js"
import { parseFormdata } from "./parseFormdata.js"
import { staticPageMap } from './staticPages.js'

import { getType } from "mime/lite.js"

const CHAR_GEN =
  "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678"
const NAME_REGEX = /^[a-zA-Z0-9+_\-\[\]*$=@,;\/]{3,}$/
const RAND_LEN = 4
const PRIVATE_RAND_LEN = 24
const ADMIN_PATH_LEN = 24
const SEP = ":"
const MAX_LEN = 10 * 1024 * 1024

let BASE_URL = ""

function decode(arrayBuffer) {
  return new TextDecoder().decode(arrayBuffer)
}

class WorkerError extends Error {
  constructor(statusCode, ...params) {
    super(...params)
    this.statusCode = statusCode
  }
}

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
      if (response.status !== 301) {  // because Cloudflare do not allow modifying redirect headers
        response.headers.set("Access-Control-Allow-Origin", "*")
      }
      return response
    }
  } catch (e) {
    console.log(e.stack)
    if (e instanceof WorkerError) {
      return new Response(e.message + "\n", { status: e.statusCode })
    } else {
      return new Response(e.message + "\n", { status: 500 })
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
  const contentType = request.headers.get("content-type") || ""
  const url = new URL(request.url)
  BASE_URL = url.origin

  // parse formdata
  let form = {}
  if (contentType.includes("multipart/form-data")) {
    // because cloudflare runtime treat all formdata part as strings thus corrupting binary data,
    // we need to manually parse formdata
    const uint8Array = await request.arrayBuffer()
    try {
      form = parseFormdata(uint8Array)
    } catch (e) {
      return new WorkerError(400, "error occurs parsing formdata")
    }
  } else {
    throw new WorkerError(400, `bad usage, please use 'multipart/form-data' instead of ${contentType}`)
  }
  const content = form.get("c")
  const name = decode(form.get("n")) || undefined
  const isPrivate = form.get("p") !== undefined
  const passwd = decode(form.get("s")) || undefined
  const expire =
    form.has("e") && form.get("e").byteLength > 0
      ? decode(form.get("e"))
      : undefined

  // check if paste content is legal
  if (content === undefined) {
    throw new WorkerError(400, "cannot find content in formdata")
  } else if (content.length > MAX_LEN) {
    throw new WorkerError(413, "payload too large")
  }

  // check if expiration is legal
  if (expire !== undefined) {
    const expireInt = parseInt(expire)
    if (isNaN(expireInt)) {
      throw new WorkerError(400, `cannot parse expire ${expireInt} as an integer`)
    }
    if (expireInt < 60) {
      throw new WorkerError(
        400,
        `due to limitation of Cloudflare, expire should be a integer greater than 60, '${expireInt} given`,
      )
    }
  }

  // check if name is legal
  if (name !== undefined && !NAME_REGEX.test(name)) {
    throw new WorkerError(
      400,
      `Name ${name} not satisfying regexp ${NAME_REGEX}`,
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
      throw new WorkerError(404, $`paste of name '${short}' is not found`)
    } else {
      const date = item.metadata.postedAt
      if (passwd !== item.metadata.passwd) {
        throw new WorkerError(403, `incorrect password for paste '${short}`)
      } else {
        return makeResponse(
          await createPaste(content, isPrivate, expire, short, date, passwd),
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
    return makeResponse(await createPaste(content, isPrivate, expire, short, undefined, passwd))
  }
}

async function handleGet(request) {
  const url = new URL(request.url)
  if (staticPageMap.has(url.pathname)) {
    const item = await PB.get(staticPageMap.get(url.pathname))
    return new Response(item, {
      headers: { "content-type": "text/html;charset=UTF-8" }
    })
  }

  const { role, short, ext } = parsePath(url.pathname)
  const mime = url.searchParams.get("mime") || getType(ext) || "text/plain"

  const item = await PB.getWithMetadata(short, { type: "arrayBuffer" })

  // when paste is not found
  if (item.value === null) {
    throw new WorkerError(404, `paste of name '${short}' not found`)
  }

  // handle URL redirection
  if (role === "u") {
    return Response.redirect(decode(item.value), 301)
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

async function createPaste(content, isPrivate, expire, short, date, passwd) {
  date = date || new Date().toISOString()
  passwd = passwd || genRandStr(ADMIN_PATH_LEN)
  const short_len = isPrivate ? PRIVATE_RAND_LEN : RAND_LEN

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
  let accessUrl = BASE_URL + '/' + short
  const adminUrl = BASE_URL + '/' + short + SEP + passwd
  return {
    url: accessUrl,
    admin: adminUrl,
    isPrivate: isPrivate,
    expire: expire,
  }
}

function genRandStr(len) {
  // TODO: switch to Web Crypto random generator
  let str = ""
  const numOfRand = CHAR_GEN.length
  for (let i = 0; i < len; i++) {
    str += CHAR_GEN.charAt(Math.floor(Math.random() * numOfRand))
  }
  return str
}

function parsePath(pathname) {
  // Example of paths (SEP=':'). Note: query string is not processed here
  // > example.com/~stocking
  // > example.com/~stocking:uLE4Fhb/d3414adlW653Vx0VSVw=
  // > example.com/abcd
  // > example.com/abcd.jpg
  // > example.com/u/abcd
  // > example.com/abcd:3ffd2e7ff214989646e006bd9ad36c58d447065e
  let role = "", ext = ""
  if (pathname[2] === "/") {
    role = pathname[1]
    pathname = pathname.slice(2)
  }
  let startOfExt = pathname.indexOf(".")
  if (startOfExt >= 0) {
    ext = pathname.slice(startOfExt)
    pathname = pathname.slice(0, startOfExt)
  }
  let endOfShort = pathname.indexOf(SEP)
  if (endOfShort < 0) endOfShort = pathname.length // when there is no SEP, passwd is left empty
  const short = pathname.slice(1, endOfShort)
  const passwd = pathname.slice(endOfShort + 1)
  return { role, short, passwd, ext }
}
