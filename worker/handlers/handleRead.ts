import { decode, WorkerError, escapeHtml } from "../common.js"
import { isLegalUrl } from "../../shared/verify.js"
import { getDocMarkdown, getCurlIndexMarkdown, renderDocAsHtml } from "../pages/docs.js"
import { verifyAuth } from "../pages/auth.js"
import mime from "mime"
import { makeEncryptedMarkdown, makeMarkdown } from "../pages/markdown.js"
import { makeHtmlPreview } from "../pages/htmlPreview.js"
import type { PasteMetadata, PasteWithMetadata } from "../storage/storage.js"
import { getPaste, getPasteMetadata, metaResponseFromMetadata } from "../storage/storage.js"
import { parsePath } from "../../shared/parsers.js"
import { MAX_URL_REDIRECT_LEN } from "../../shared/constants.js"
import { LIVE_PAGE_PATH } from "../../shared/live.js"
import {
  isDocumentMime,
  isPlainMedia,
  mimeEssence,
  PLAIN_TEXT_MIME,
  RAW_PASTE_CSP,
  sanitizeMime,
} from "../../shared/mime.js"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"
import { getAssetPaths, renderCssLinks, streamToArrayBuffer, DARK_MODE_SCRIPT, MAX_SSR_FILE_SIZE } from "../ssrUtils.js"

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

function isCurlAgent(request: Request): boolean {
  const ua = request.headers.get("User-Agent") || ""
  return ua.toLowerCase().startsWith("curl/")
}

async function handleStaticPages(request: Request, env: Env, _: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url)
  const isCurl = isCurlAgent(request)

  // Serve doc/index.md as plain markdown for curl on "/" or anyone on "/index.md"
  if ((url.pathname === "/" && isCurl) || url.pathname === "/index.md") {
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
    return new Response(getCurlIndexMarkdown(env), {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Vary: "User-Agent",
        ...staticPageCacheHeader(env),
      },
    })
  }

  let path = url.pathname
  if (path.endsWith("/")) {
    path += "index.html"
  } else if (path.endsWith("/index")) {
    path += ".html"
  } else if (path.lastIndexOf("/") === 0 && path.indexOf(":") > 0) {
    path = "/index.html" // handle admin URL
  }

  // Handle index.html with SSR
  if (path === "/index.html") {
    // Auth check
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }

    // Try SSR
    try {
      const { renderIndexPage } = await import("../pages/index.js")
      const page = await renderIndexPage(env, url.pathname)
      if (page) {
        return new Response(page, {
          headers: {
            "Content-Type": "text/html;charset=UTF-8",
            ...staticPageCacheHeader(env),
          },
        })
      }
      // SSR skipped (admin URL), continue to CSR fallback
    } catch (e) {
      console.error("SSR failed for index page, falling back to CSR:", e)
    }

    // CSR fallback: dynamically generate empty HTML shell
    const { jsFile, cssPaths } = getAssetPaths(manifest, "index.html")

    return new Response(
      `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" href="/favicon.ico" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(env.INDEX_PAGE_TITLE)}</title>
${renderCssLinks(cssPaths)}
<script>
${DARK_MODE_SCRIPT}
</script>
<script>window.__WRANGLER_CONFIG__=${JSON.stringify(env)}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/${jsFile}"></script>
</body>
</html>`,
      {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          ...staticPageCacheHeader(env),
        },
      },
    )
  }

  // Handle other static assets
  if (path.startsWith("/assets/") || path === "/favicon.ico") {
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

  if (url.pathname === LIVE_PAGE_PATH) {
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
    const pageUrl = new URL(url)
    pageUrl.search = ""
    pageUrl.pathname = "/live.html"
    const page = await env.ASSETS.fetch(pageUrl)
    return new Response(page.body, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        ...staticPageCacheHeader(env),
      },
    })
  }

  if (url.pathname === "/doc" || url.pathname.startsWith("/doc/")) {
    const isExplicitMd = url.pathname.endsWith(".md")
    const lookupPath = isExplicitMd ? url.pathname.slice(0, -3) : url.pathname
    const docMd = getDocMarkdown(lookupPath, env)
    if (docMd !== null) {
      const wantsMarkdown = isExplicitMd || isCurl
      const docUrl = env.DEPLOY_URL + lookupPath.replace(/\.html$/, "")
      return new Response(wantsMarkdown ? docMd : renderDocAsHtml(docMd, docUrl), {
        headers: {
          "Content-Type": wantsMarkdown ? "text/plain;charset=UTF-8" : "text/html;charset=UTF-8",
          Vary: "User-Agent",
          ...staticPageCacheHeader(env),
        },
      })
    }
    throw new WorkerError(404, `doc page '${url.pathname}' not found`)
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

  // when not isHead, always need to get paste unless "m" or "h" (the browser fetches it)
  // when isHead, no need to get paste unless "u"
  const shouldGetPasteContent = (!isHead && role !== "m" && role !== "h") || (isHead && role === "u")

  const item: PasteWithMetadata | null = shouldGetPasteContent
    ? await getPaste(env, name, ctx)
    : await getPasteWithoutContent(env, name)

  // when paste is not found
  if (item === null) {
    throw new WorkerError(404, `paste of name '${name}' not found`)
  }

  // Disallowed types (HTML by default) are served as plain text; the preview
  // page /h/<name> renders them in a sandboxed frame of its own.
  const disallowedMimes = env.DISALLOWED_MIME_FOR_PASTE as readonly string[]
  const sanitize = (m: string) => sanitizeMime(m, disallowedMimes)

  const realMime =
    url.searchParams.get("mime") ||
    (ext && mime.getType(ext)) ||
    (item.metadata.filename && mime.getType(item.metadata.filename)) ||
    PLAIN_TEXT_MIME

  let inferred_mime = item.metadata.encryptionScheme
    ? url.searchParams.get("mime") || (ext && mime.getType(ext)) || "application/octet-stream"
    : realMime
  inferred_mime = sanitize(inferred_mime)

  const decryptedContentType = item.metadata.encryptionScheme ? sanitize(realMime) : null

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
    const scheme = item.metadata.encryptionScheme
    // the page's own address, without extension, filename or query
    const pageUrl = `${env.DEPLOY_URL}/a/${name}`
    let page: string | null = null
    if (scheme) {
      if (shouldGetPasteContent && item.metadata.sizeBytes <= MAX_SSR_FILE_SIZE) {
        const ciphertext =
          item.paste instanceof ArrayBuffer
            ? item.paste
            : await streamToArrayBuffer(item.paste as ReadableStream<Uint8Array>)
        page = makeEncryptedMarkdown(`/${name}`, scheme, pageUrl, ciphertext)
      } else {
        // too large to embed: the browser fetches the paste itself
        if (item.paste instanceof ReadableStream) await item.paste.cancel()
        if (shouldGetPasteContent) page = makeEncryptedMarkdown(`/${name}`, scheme, pageUrl)
      }
    } else if (shouldGetPasteContent) {
      page = makeMarkdown(await decodeMaybeStream(item.paste), pageUrl)
    }
    return new Response(page, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle metadata access
  if (role === "m") {
    const returnedMetadata = metaResponseFromMetadata(item.metadata)
    return new Response(isHead ? null : JSON.stringify(returnedMetadata, null, 2), {
      headers: {
        "Content-Type": `application/json;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle preview page: the paste framed below a header, see pages/htmlPreview.ts
  if (role === "h") {
    // Asking for the preview is asking for a document. An explicit `?mime=`,
    // extension or filename in the URL is taken as is; without one, the
    // uploaded filename counts only if it names a document type, and
    // anything else is rendered as HTML. The plain-text rule of the raw
    // response does not apply: the browser fetches the paste and renders it
    // in the frame itself.
    let frameMime = mimeEssence(realMime) ?? "text/plain"
    if (!url.searchParams.has("mime") && !ext && !isDocumentMime(frameMime)) frameMime = "text/html"
    const page = makeHtmlPreview(env, {
      name,
      ext,
      filename,
      search: url.search,
      encryptionScheme: item.metadata.encryptionScheme,
      type: frameMime,
    })
    return new Response(isHead ? null : page, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle display page with SSR
  if (role === "d") {
    // The page's own address. The extension stays, it picks the highlight
    // language; the filename form, query and fragment do not.
    const displayUrl = `${env.DEPLOY_URL}/d/${name}${ext ?? ""}`
    try {
      const { renderDisplayPage } = await import("../pages/display.js")
      const page = await renderDisplayPage(env, name, filename, ext, item.paste, item.metadata, displayUrl)
      if (page) {
        return new Response(isHead ? null : page, {
          headers: {
            "Content-Type": `text/html;charset=UTF-8`,
            ...pasteCacheHeader(env),
            ...lastModifiedHeader(item.metadata),
          },
        })
      }
      // SSR skipped (encrypted file), fall through to CSR
    } catch (e) {
      console.error("SSR failed, falling back to CSR:", e)
    }
    // CSR fallback
    const pageUrl = url
    pageUrl.search = ""
    pageUrl.pathname = "/display.html"
    // The name, extension and filename come from the URL or the upload: escape
    // them, and replace with a function so that "$&"-like patterns in them are
    // not interpreted
    const titleName =
      name + (filename ? " / " + filename : ext ? ext : item.metadata.filename ? " / " + item.metadata.filename : "")
    const page = decode(await (await env.ASSETS.fetch(pageUrl)).arrayBuffer())
      .replace("{{PASTE_NAME}}", () => escapeHtml(titleName))
      .replaceAll("{{PAGE_URL}}", () => escapeHtml(displayUrl))
    return new Response(isHead ? null : page, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle default
  const essence = mimeEssence(inferred_mime) ?? "text/plain"
  const headers: Headers = {
    "Content-Type": `${inferred_mime}`,
    // no sniffing a paste into something else
    "X-Content-Type-Options": "nosniff",
    ...pasteCacheHeader(env),
    ...lastModifiedHeader(item.metadata),
  }
  // Whatever the type, a raw paste may carry markup and scripts. Rendered as
  // a document, it runs in an opaque origin with no access to this site.
  if (!isPlainMedia(essence)) headers["Content-Security-Policy"] = RAW_PASTE_CSP
  const exposeHeaders = ["Content-Disposition"]

  if (item.metadata.encryptionScheme) {
    headers["X-PB-Encryption-Scheme"] = item.metadata.encryptionScheme
    exposeHeaders.push("X-PB-Encryption-Scheme")
    if (decryptedContentType !== null) {
      headers["X-PB-Decrypted-Content-Type"] = decryptedContentType
      exposeHeaders.push("X-PB-Decrypted-Content-Type")
    }
  }

  if (item.metadata.highlightLanguage) {
    headers["X-PB-Highlight-Language"] = item.metadata.highlightLanguage
    exposeHeaders.push("X-PB-Highlight-Language")
  }

  if (item.httpEtag) {
    headers.etag = item.httpEtag
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
