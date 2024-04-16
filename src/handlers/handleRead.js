import { decode, encodeRFC5987ValueChars, isLegalUrl, parsePath, WorkerError } from "../common.js"
import { getStaticPage } from "../pages/staticPages.js"
import { verifyAuth } from "../auth.js"
import { getType } from "mime/lite.js"
import { makeMarkdown } from "../pages/markdown.js"
import { makeHighlight } from "../pages/highlight.js"

function staticPageCacheHeader(env) {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "cache-control": `public, max-age=${age}` } : {}
}

function pasteCacheHeader(env) {
  const age = env.CACHE_PASTE_AGE
  return age ? { "cache-control": `public, max-age=${age}` } : {}
}

function lastModifiedHeader(paste) {
  const lastModified = paste.metadata?.lastModified
  return lastModified ? { "last-modified": new Date(lastModified).toGMTString() } : {}
}

export async function handleGet(request, env, ctx) {
  const url = new URL(request.url)
  const { role, short, ext, passwd, filename } = parsePath(url.pathname)

  if (url.pathname === "/favicon.ico" && env.FAVICON) {
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
      headers: { "content-type": "text/html;charset=UTF-8", ...staticPageCacheHeader(env) },
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
  const pasteLastModified = item.metadata?.lastModified
  const headerModifiedSince = request.headers.get("if-modified-since")
  if (pasteLastModified && headerModifiedSince) {
    let pasteLastModifiedMs = Date.parse(pasteLastModified)
    pasteLastModifiedMs -= pasteLastModifiedMs % 1000 // deduct the milliseconds parts
    const headerIfModifiedMs = Date.parse(headerModifiedSince)
    if (pasteLastModifiedMs <= headerIfModifiedMs) {
      return new Response(null, {
        status: 304, // Not Modified
        headers: lastModifiedHeader(item),
      })
    }
  }

  // determine filename with priority: url path > meta
  const returnFilename = filename || item.metadata?.filename

  // handle URL redirection
  if (role === "u") {
    const redirectURL = decode(item.value)
    if (isLegalUrl(redirectURL)) {
      return Response.redirect(redirectURL)
    } else {
      throw new WorkerError(400, "cannot parse paste content as a legal URL")
    }
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
      headers: { "content-type": `text/html;charset=UTF-8`, ...pasteCacheHeader(env), ...lastModifiedHeader(item) },
    })
  } else {

    // handle default
    const headers = { "content-type": `${mime};charset=UTF-8`, ...pasteCacheHeader(env), ...lastModifiedHeader(item) }
    if (returnFilename) {
      const encodedFilename = encodeRFC5987ValueChars(returnFilename)
      headers["content-disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
    } else {
      headers["content-disposition"] = `${disp}`
    }
    return new Response(item.value, { headers })
  }
}
