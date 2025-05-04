import { decode, isLegalUrl, WorkerError } from "../common.js"
import { getDocPage } from "../pages/docs.js"
import { verifyAuth } from "../pages/auth.js"
import mime from "mime"
import { makeMarkdown } from "../pages/markdown.js"
import { getPaste, getPasteMetadata, PasteMetadata, PasteWithMetadata } from "../storage/storage.js"
import { MetaResponse } from "../../shared/interfaces.js"
import { parsePath } from "../../shared/parsers.js"
import { MAX_URL_REDIRECT_LEN } from "../../shared/constants.js"

type Headers = Record<string, string>

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
  if (path.startsWith("/assets/") || path === "/favicon.ico" || path === "/index.html") {
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

async function getPasteWithoutContent(env: Env, name: string): Promise<PasteWithMetadata | null> {
  const metadata = await getPasteMetadata(env, name)
  return metadata && { paste: new ArrayBuffer(), metadata }
}

export async function handleGet(request: Request, env: Env, ctx: ExecutionContext, isHead: boolean): Promise<Response> {
  // TODO: handle etag
  const staticPageResp = await handleStaticPages(request, env, ctx)
  if (staticPageResp !== null) {
    return staticPageResp
  }

  const url = new URL(request.url)

  const { role, name, ext, filename } = parsePath(url.pathname)

  const disp = url.searchParams.has("a") ? "attachment" : "inline"

  // when not isHead, always need to get paste unless "m"
  // when isHead, no need to get paste unless "u"
  const shouldGetPasteContent = (!isHead && role !== "m" && role !== "d") || (isHead && role === "u")

  const item: PasteWithMetadata | null = shouldGetPasteContent
    ? await getPaste(env, name, ctx)
    : await getPasteWithoutContent(env, name)

  // when paste is not found
  if (item === null) {
    throw new WorkerError(404, `paste of name '${name}' not found`)
  }

  let inferred_mime =
    url.searchParams.get("mime") ||
    (ext && mime.getType(ext)) ||
    (item.metadata.encryptionScheme && "application/octet-stream") ||
    (item.metadata.filename && mime.getType(item.metadata.filename)) ||
    "text/plain;charset=UTF-8"

  if (env.DISALLOWED_MIME_FOR_PASTE.includes(inferred_mime)) {
    inferred_mime = "text/plain;charset=UTF-8"
  }

  // check `if-modified-since`
  const pasteLastModifiedUnix = item.metadata.lastModifiedAtUnix
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
  let returnFilename = filename || item.metadata?.filename
  if (returnFilename && !filename && item.metadata.encryptionScheme) {
    returnFilename = returnFilename + ".encrypted" // to avoid clients choose open method with extension
  }

  // handle URL redirection
  if (role === "u") {
    if (item.metadata.sizeBytes > MAX_URL_REDIRECT_LEN) {
      throw new WorkerError(400, `URL too long to be redirected (max ${MAX_URL_REDIRECT_LEN} bytes)`)
    }
    const redirectURL = await decodeMaybeStream(item.paste)
    if (isLegalUrl(redirectURL)) {
      return Response.redirect(redirectURL)
    } else {
      throw new WorkerError(400, "cannot parse paste content as a legal URL")
    }
  }

  // handle article (render as markdown)
  if (role === "a") {
    return new Response(shouldGetPasteContent ? makeMarkdown(await decodeMaybeStream(item.paste)) : null, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle metadata access
  if (role === "m") {
    const returnedMetadata: MetaResponse = {
      lastModifiedAt: new Date(item.metadata.lastModifiedAtUnix * 1000).toISOString(),
      createdAt: new Date(item.metadata.createdAtUnix * 1000).toISOString(),
      expireAt: new Date(item.metadata.willExpireAtUnix * 1000).toISOString(),
      sizeBytes: item.metadata.sizeBytes,
      location: item.metadata.location,
      filename: item.metadata.filename,
      highlightLanguage: item.metadata.highlightLanguage,
      encryptionScheme: item.metadata.encryptionScheme,
    }
    return new Response(isHead ? null : JSON.stringify(returnedMetadata, null, 2), {
      headers: {
        "Content-Type": `application/json;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle encrypted
  if (role === "d") {
    const pageUrl = url
    pageUrl.search = ""
    pageUrl.pathname = "/display.html"
    const page = decode(await (await env.ASSETS.fetch(pageUrl)).arrayBuffer()).replace(
      "{{PASTE_NAME}}",
      name + (filename ? "/" + filename : ext ? ext : ""),
    )
    return new Response(isHead ? null : page, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle default
  const headers: Headers = {
    "Content-Type": `${inferred_mime}`,
    ...pasteCacheHeader(env),
    ...lastModifiedHeader(item.metadata),
  }
  const exposeHeaders = ["Content-Disposition"]

  if (item.metadata.encryptionScheme) {
    headers["X-PB-Encryption-Scheme"] = item.metadata.encryptionScheme
    exposeHeaders.push("X-PB-Encryption-Scheme")
  }

  if (item.metadata.highlightLanguage) {
    headers["X-PB-Highlight-Language"] = item.metadata.highlightLanguage
    exposeHeaders.push("X-PB-Highlight-Language")
  }

  if (returnFilename) {
    const encodedFilename = encodeURIComponent(returnFilename)
    headers["Content-Disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
  } else {
    headers["Content-Disposition"] = `${disp}`
  }
  headers["Access-Control-Expose-Headers"] = exposeHeaders.join(", ")

  // if content is nonempty, Content-Length will be set automatically
  if (!shouldGetPasteContent) {
    headers["Content-Length"] = item.metadata.sizeBytes.toString()
  }
  return new Response(shouldGetPasteContent ? item.paste : null, { headers })
}
