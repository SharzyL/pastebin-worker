const CHAR_GEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-_=@!';
const RAND_LEN = 4
const MAX_LEN = 5 * 1024 * 1024
const README = `A Pastebin based on cloudflare workers

Usage: 

$ cat foo.txt | curl -F "c=@-" ${BASE_URL}
{
  "url": "${BASE_URL}ZlvK",
  "short": "ZlvK",
  "deleteUrl": "${BASE_URL}ZlvK-Mp2BkyvI5WyL3SZ09Dp8ennoPUQ="
}

$ curl ${BASE_URL}ZlvK
foo bar foo bar meow meow

$ curl -X DELETE "${BASE_URL}ZlvK-Mp2BkyvI5WyL3SZ09Dp8ennoPUQ="
it will be deleted soon
`

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
    return new request("unknown error", {status: 500})
  }
}

/**
 * Respond to the post request
 * @param {Request} request
 */
async function handlePost(request) {
  const contentType = request.headers.get("content-type") || ""

  let content = ""

  if (contentType.includes("form")) {
    const formData = await request.formData()
    for (const entry of formData.entries()) {
      if (entry[0] === "c") content = entry[1]
    }
  }

  if (content.length > MAX_LEN) {
    return new Response("file too large", {status: 400})
  } else if (content.length === 0) {
    return new Response("please upload via Formdata", {status: 400})
  } else {
    const created = await createPaste(content)
    return new Response(JSON.stringify(created, null, 2))
  }
}

/**
 * Respond to the post request
 * @param {Request} request
 */
async function handleGet(request) {
  const url = new URL(request.url)
  const short = url.pathname.slice(1)
  if (short.length === 0) {
    return new Response(README)
  }
  const val = await PB.get(short)
  if (val === null) {
    return new Response("not found", {status: 404})
  } else {
    return new Response(val)
  }
}

/**
 * Respond to the DELETE request
 * @param {Request} request
 */
async function handleDelete(request) {
  const path = new URL(request.url).pathname
  if (path.length < RAND_LEN + 3) {
    console.log(RAND_LEN + 1)
    return new Response("bad format", {status: 400})
  }
  const short = path.slice(1, 1 + RAND_LEN)
  const digest = path.slice(2 + RAND_LEN)
  const item = await PB.getWithMetadata(short)
  console.log(short)
  console.log(item)
  if (item.value === null) {
    return new Response("not found", {status: 400})
  } else {
    if (digest !== await hashWithSalt(item.metadata.postedAt + short)) {
      return new Response("bad handler", {status:400})
    } else {
      await PB.delete(short)
      return new Response("it will be deleted soon")
    }
  }
}

async function createPaste(content) {
  let date = new Date()
  let short = null
  while (true) {
    short = genRandStr(RAND_LEN);
    if (await PB.get(short) === null) break
  }
  await PB.put(short, content, {
    metadata: {
      postedAt: String(date),
    }
  })
  const digest = await hashWithSalt(date + short)
  return {
    url: BASE_URL + short,
    short: short,
    deleteUrl: BASE_URL + short + '-' + digest
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
