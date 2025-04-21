import { decode, isLegalUrl, parsePath, WorkerError } from "../common.js"
import { getStaticPage } from "../pages/staticPages.js"
import { verifyAuth } from "../auth.js"
import mime from "mime/lite"
import { makeMarkdown } from "../pages/markdown.js"
import { makeHighlight } from "../pages/highlight.js"
import {getPaste, PasteMetadata} from "../storage/storage.js";

type Headers = { [name: string]: string }

function staticPageCacheHeader(env: Env): Headers {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "cache-control": `public, max-age=${age}` } : {}
}

function pasteCacheHeader(env: Env) : Headers {
  const age = env.CACHE_PASTE_AGE
  return age ? { "cache-control": `public, max-age=${age}` } : {}
}

function lastModifiedHeader(metadata: PasteMetadata): Headers {
  const lastModified = metadata.lastModifiedAtUnix
  return lastModified ? { "last-modified": new Date(lastModified * 1000).toUTCString() } : {}
}

export async function handleGet(request: Request, env: Env, _: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const { role, nameFromPath, ext, passwd, filename } = parsePath(url.pathname)

  if (url.pathname === "/favicon.ico" && env.FAVICON) {
    return Response.redirect(env.FAVICON)
  }

  // return the editor for admin URL
  const staticPageContent = getStaticPage((passwd && passwd.length > 0) ? "/" : url.pathname, env)
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

  const inferred_mime = url.searchParams.get("mime") || (ext && mime.getType(ext)) || "text/plain"

  const disp = url.searchParams.has("a") ? "attachment" : "inline"

  const item = await getPaste(env, nameFromPath)

  // when paste is not found
  if (item === null) {
    throw new WorkerError(404, `paste of name '${nameFromPath}' not found`)
  }

  // check `if-modified-since`
  const pasteLastModifiedUnix = item.metadata.lastModifiedAtUnix
  const headerModifiedSince = request.headers.get("if-modified-since")
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
    const redirectURL = decode(item.paste)
    if (isLegalUrl(redirectURL)) {
      return Response.redirect(redirectURL)
    } else {
      throw new WorkerError(400, "cannot parse paste content as a legal URL")
    }
  }

  // handle article (render as markdown)
  if (role === "a") {
    const md = makeMarkdown(decode(item.paste))
    return new Response(md, {
      headers: { "content-type": `text/html;charset=UTF-8`, ...pasteCacheHeader(env), ...lastModifiedHeader(item.metadata) },
    })
  }

  // handle language highlight
  const lang = url.searchParams.get("lang")
  if (lang) {
    return new Response(makeHighlight(decode(item.paste), lang), {
      headers: { "content-type": `text/html;charset=UTF-8`, ...pasteCacheHeader(env), ...lastModifiedHeader(item.metadata) },
    })
  } else {

    // handle default
    const headers: Headers = {
      "content-type": `${inferred_mime};charset=UTF-8`,
      ...pasteCacheHeader(env),
      ...lastModifiedHeader(item.metadata)
    }
    if (returnFilename) {
      const encodedFilename = encodeURIComponent(returnFilename)
      headers["content-disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
    } else {
      headers["content-disposition"] = `${disp}`
    }
    return new Response(item.paste, { headers })
  }
}
