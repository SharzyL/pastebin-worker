import { decode, isLegalUrl, WorkerError } from "../common.js"
import { getDocPage } from "../pages/docs.js"
import { verifyAuth } from "../auth.js"
import mime from "mime/lite"
import { makeMarkdown } from "../pages/markdown.js"
import { makeHighlight } from "../pages/highlight.js"
import { getPaste, PasteMetadata } from "../storage/storage.js"
import { parsePath } from "../shared.js"

type Headers = { [name: string]: string }

async function decodeMaybeStream(content: ArrayBuffer | ReadableStream): Promise<string> {
  if (content instanceof ArrayBuffer) {
    return decode(content)
  } else {
    const reader = content.pipeThrough(new TextDecoderStream()).getReader()
    let result = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      result += value
    }
    return result
  }
}

function staticPageCacheHeader(env: Env): Headers {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "Cache-Control": `public, max-age=${age}` } : {}
}

function pasteCacheHeader(env: Env): Headers {
  const age = env.CACHE_PASTE_AGE
  return age ? { "Cache-Control": `public, max-age=${age}` } : {}
}

function lastModifiedHeader(metadata: PasteMetadata): Headers {
  const lastModified = metadata.lastModifiedAtUnix
  return lastModified ? { "Last-Modified": new Date(lastModified * 1000).toUTCString() } : {}
}

async function handleStaticPages(request: Request, env: Env, _: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url)

  let path = url.pathname
  if (path.endsWith("/")) {
    path += "index.html"
  } else if (path.endsWith("/index")) {
    path += ".html"
  } else if (path.lastIndexOf("/") === 0 && path.indexOf(":") > 0) {
    path = "/index.html" // handle admin URL
  }
  if (path.startsWith("/assets/") || path.startsWith("/static/") || path === "/index.html") {
    if (path === "/index.html") {
      const authResponse = verifyAuth(request, env)
      if (authResponse !== null) {
        return authResponse
      }
    }
    const assetsUrl = url
    assetsUrl.pathname = path
    const resp = await env.ASSETS.fetch(assetsUrl)
    if (resp.status === 404) {
      throw new WorkerError(404, `asset '${path}' not found`)
    } else {
      const pageMime = mime.getType(path) || "text/plain"
      return new Response(await resp.blob(), {
        headers: {
          "Content-Type": `${pageMime};charset=UTF-8`,
          ...staticPageCacheHeader(env),
        },
      })
    }
  }

  const staticPageContent = getDocPage(url.pathname, env)
  if (staticPageContent) {
    // access to all static pages requires auth
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
    return new Response(staticPageContent, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        ...staticPageCacheHeader(env),
      },
    })
  }

  return null
}

export async function handleGet(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const staticPageResp = await handleStaticPages(request, env, ctx)
  if (staticPageResp !== null) {
    return staticPageResp
  }

  const url = new URL(request.url)

  const { role, nameFromPath, ext, filename } = parsePath(url.pathname)

  const disp = url.searchParams.has("a") ? "attachment" : "inline"

  const item = await getPaste(env, nameFromPath, ctx)

  // when paste is not found
  if (item === null) {
    throw new WorkerError(404, `paste of name '${nameFromPath}' not found`)
  }

  // check `if-modified-since`
  const pasteLastModifiedUnix = item.metadata.lastModifiedAtUnix

  const inferred_mime =
    url.searchParams.get("mime") ||
    (ext && mime.getType(ext)) ||
    (item.metadata.filename && mime.getType(item.metadata.filename)) ||
    "text/plain"

  const headerModifiedSince = request.headers.get("If-Modified-Since")
  if (headerModifiedSince) {
    const headerModifiedSinceUnix = Date.parse(headerModifiedSince) / 1000
    if (pasteLastModifiedUnix <= headerModifiedSinceUnix) {
      return new Response(null, {
        status: 304, // Not Modified
        headers: lastModifiedHeader(item.metadata),
      })
    }
  }

  // determine filename with priority: url path > meta
  const returnFilename = filename || item.metadata?.filename

  // handle URL redirection
  if (role === "u") {
    const redirectURL = await decodeMaybeStream(item.paste)
    if (isLegalUrl(redirectURL)) {
      return Response.redirect(redirectURL)
    } else {
      throw new WorkerError(400, "cannot parse paste content as a legal URL")
    }
  }

  // handle article (render as markdown)
  if (role === "a") {
    const md = makeMarkdown(await decodeMaybeStream(item.paste))
    return new Response(md, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle language highlight
  const lang = url.searchParams.get("lang")
  if (lang) {
    return new Response(makeHighlight(await decodeMaybeStream(item.paste), lang), {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle default
  const headers: Headers = {
    "Content-Type": `${inferred_mime};charset=UTF-8`,
    ...pasteCacheHeader(env),
    ...lastModifiedHeader(item.metadata),
  }
  if (returnFilename) {
    const encodedFilename = encodeURIComponent(returnFilename)
    headers["Content-Disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
  } else {
    headers["Content-Disposition"] = `${disp}`
  }
  headers["Access-Control-Expose-Headers"] = "Content-Disposition"
  return new Response(item.paste, { headers })
}
