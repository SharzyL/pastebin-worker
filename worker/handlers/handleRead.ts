import { WorkerError, escapeHtml } from "../common.js"
import { isLegalUrl } from "../../shared/verify.js"
import { getDocMarkdown, getCurlIndexMarkdown, renderDocAsHtml } from "../pages/docs.js"
import { verifyAuth } from "../pages/auth.js"
import mime from "mime"
import { makeMarkdown } from "../pages/markdown.js"
import type { PasteBody, PasteBodyRange, PasteMetadata, PasteRecord } from "../storage/storage.js"
import {
  consumeRead,
  deletePaste,
  discardPasteRecord,
  getPasteRecord,
  getRemainingReads,
  hasReadLimit,
  metaResponseFromMetadata,
  openPasteBody,
} from "../storage/storage.js"
import { parsePath } from "../../shared/parsers.js"
import { BINARY_MIME_TYPE, MAX_URL_REDIRECT_LEN, TEXT_MIME_TYPE } from "../../shared/constants.js"
import { filenameForTitle } from "../../shared/filename.js"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"
import { getAssetPaths, renderCssLinks, DARK_MODE_SCRIPT, publicEnv } from "../ssrUtils.js"
import { itemCountLabel } from "../../shared/format.js"
import { getP2PRoomStatus } from "../p2p.js"

type Headers = Record<string, string>

const ACTIVE_CONTENT_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
])

function mimeEssence(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase()
}

function sanitizePasteMimeType(value: string, configuredDisallowed: readonly string[]): string {
  const essence = mimeEssence(value)
  const isConfiguredDisallowed = configuredDisallowed.some((item) => mimeEssence(item) === essence)
  const isActiveContent =
    ACTIVE_CONTENT_MIME_TYPES.has(essence) || essence.endsWith("+xml") || essence.startsWith("multipart/")
  return essence.length === 0 || isConfiguredDisallowed || isActiveContent ? TEXT_MIME_TYPE : value
}

function bodyToText(content: ArrayBuffer | ReadableStream): Promise<string> {
  return new Response(content).text()
}

function staticPageCacheHeader(env: Env): Headers {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "Cache-Control": `public, max-age=${age}` } : {}
}

function protectedPageCacheHeader(env: Env): Headers {
  const basicAuth = env.BASIC_AUTH as Record<string, string>
  return Object.keys(basicAuth).length > 0 ? { "Cache-Control": "private, no-store" } : staticPageCacheHeader(env)
}

function pasteCacheHeader(env: Env, metadata?: PasteMetadata): Headers {
  if (metadata && hasReadLimit(metadata)) {
    return { "Cache-Control": "no-store" }
  }
  const age = env.CACHE_PASTE_AGE
  return age ? { "Cache-Control": `public, max-age=${age}` } : {}
}

function lastModifiedHeader(metadata: PasteMetadata): Headers {
  const lastModified = metadata.lastModifiedAtUnix
  return lastModified ? { "Last-Modified": new Date(lastModified * 1000).toUTCString() } : {}
}

type ParsedByteRange = { kind: "none" } | { kind: "unsatisfiable" } | { kind: "range"; range: PasteBodyRange }

function parseByteRange(value: string | null, size: number): ParsedByteRange {
  if (value === null) return { kind: "none" }
  const match = /^\s*bytes\s*=\s*([^,]+)\s*$/i.exec(value)
  if (!match) return { kind: "none" }

  const rangeMatch = /^(\d*)-(\d*)$/.exec(match[1].trim())
  if (!rangeMatch || (!rangeMatch[1] && !rangeMatch[2])) return { kind: "none" }
  if (size === 0) return { kind: "unsatisfiable" }

  const sizeBigInt = BigInt(size)
  if (!rangeMatch[1]) {
    const suffixLength = BigInt(rangeMatch[2])
    if (suffixLength === 0n) return { kind: "unsatisfiable" }
    const length = suffixLength >= sizeBigInt ? size : Number(suffixLength)
    return { kind: "range", range: { offset: size - length, length } }
  }

  const start = BigInt(rangeMatch[1])
  const requestedEnd = rangeMatch[2] ? BigInt(rangeMatch[2]) : sizeBigInt - 1n
  if (start >= sizeBigInt) return { kind: "unsatisfiable" }
  if (requestedEnd < start) return { kind: "none" }

  const end = requestedEnd >= sizeBigInt ? sizeBigInt - 1n : requestedEnd
  return {
    kind: "range",
    range: {
      offset: Number(start),
      length: Number(end - start + 1n),
    },
  }
}

async function ifRangeMatches(request: Request, env: Env, name: string, metadata: PasteMetadata): Promise<boolean> {
  const value = request.headers.get("If-Range")?.trim()
  if (!value) return true
  if (value.startsWith("W/")) return false

  if (value.startsWith('"')) {
    if (!value.endsWith('"')) return false
    const object = await env.R2.head(name)
    return object?.httpEtag === value
  }

  const date = Date.parse(value)
  return !Number.isNaN(date) && metadata.lastModifiedAtUnix <= Math.floor(date / 1000)
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
        "Content-Type": TEXT_MIME_TYPE,
        Vary: "User-Agent",
        ...protectedPageCacheHeader(env),
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
            ...protectedPageCacheHeader(env),
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
<script>window.__WRANGLER_CONFIG__=${JSON.stringify(publicEnv(env))}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/${jsFile}"></script>
</body>
</html>`,
      {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          ...protectedPageCacheHeader(env),
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
      const headers = new Headers(resp.headers)
      if (!headers.has("Content-Type")) headers.set("Content-Type", `${pageMime};charset=UTF-8`)
      for (const [name, value] of Object.entries(staticPageCacheHeader(env))) headers.set(name, value)
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      })
    }
  }

  if (url.pathname === "/doc" || url.pathname.startsWith("/doc/")) {
    const isExplicitMd = url.pathname.endsWith(".md")
    const lookupPath = isExplicitMd ? url.pathname.slice(0, -3) : url.pathname
    const docMd = getDocMarkdown(lookupPath, env)
    if (docMd !== null) {
      const wantsMarkdown = isExplicitMd || isCurl
      return new Response(wantsMarkdown ? docMd : renderDocAsHtml(docMd), {
        headers: {
          "Content-Type": wantsMarkdown ? TEXT_MIME_TYPE : "text/html;charset=UTF-8",
          Vary: "User-Agent",
          ...staticPageCacheHeader(env),
        },
      })
    }
    throw new WorkerError(404, `doc page '${url.pathname}' not found`)
  }

  return null
}

async function refreshRemainingReads(env: Env, name: string, record: PasteRecord): Promise<void> {
  if (!hasReadLimit(record.metadata)) return
  const remainingReads = await getRemainingReads(env, name, record.metadata)
  if (remainingReads === null) {
    throw new WorkerError(404, `paste of name '${name}' not found`)
  }
  record.metadata = { ...record.metadata, remainingReads }
}

async function consumeReadBeforeResponse(
  env: Env,
  name: string,
  record: PasteRecord,
  isHead: boolean,
): Promise<boolean> {
  if (isHead || !hasReadLimit(record.metadata)) return false

  const consumption = await consumeRead(env, name, record.metadata)
  if (!consumption.allowed) {
    throw new WorkerError(404, `paste of name '${name}' not found`)
  }

  record.metadata = { ...record.metadata, remainingReads: consumption.remainingBefore }
  return consumption.remainingAfter === 0
}

async function renderP2PDisplayShell(env: Env, name: string, isHead: boolean): Promise<Response> {
  const pageUrl = new URL("/display.html", env.DEPLOY_URL)
  const page = (await (await env.ASSETS.fetch(pageUrl)).text()).replace("{{PASTE_NAME}}", `${name} (P2P)`)
  return new Response(isHead ? null : page, {
    headers: {
      "Content-Type": `text/html;charset=UTF-8`,
      "Cache-Control": "no-store",
    },
  })
}

export async function handleGet(request: Request, env: Env, ctx: ExecutionContext, isHead: boolean): Promise<Response> {
  // TODO: handle etag
  const staticPageResp = await handleStaticPages(request, env, ctx)
  if (staticPageResp !== null) {
    return staticPageResp
  }

  const url = new URL(request.url)

  const { role, name, ext, filename } = parsePath(url.pathname)

  if (role === "p") {
    const status = await getP2PRoomStatus(env, name)
    if (!status.active) {
      throw new WorkerError(410, `P2P link '${name}' has expired`)
    }
    return await renderP2PDisplayShell(env, name, isHead)
  }

  const disp = url.searchParams.has("a") ? "attachment" : "inline"

  const record = await getPasteRecord(env, name, ctx)
  if (record === null) {
    throw new WorkerError(404, `paste of name '${name}' not found`)
  }

  try {
    let body: PasteBody | undefined
    let responseRange: PasteBodyRange | undefined
    let deleteAfterBodyOpen = false
    const consumeBeforeOpen = async () => {
      deleteAfterBodyOpen ||= await consumeReadBeforeResponse(env, name, record, isHead)
    }
    const requireBody = async (): Promise<PasteBody> => {
      if (body) return body
      const opened = await openPasteBody(env, name, record, ctx, responseRange)
      if (deleteAfterBodyOpen) {
        deleteAfterBodyOpen = false
        ctx.waitUntil(deletePaste(env, name, record.metadata, { readStateAlreadyFinal: true }))
      }
      if (opened === null) {
        throw new WorkerError(404, `paste of name '${name}' not found`)
      }
      body = opened
      return opened
    }

    const disallowedMimes = env.DISALLOWED_MIME_FOR_PASTE as readonly string[]
    const sanitize = (m: string) => sanitizePasteMimeType(m, disallowedMimes)

    const realMime =
      url.searchParams.get("mime") ||
      (ext && mime.getType(ext)) ||
      (record.metadata.filename && mime.getType(record.metadata.filename)) ||
      record.metadata.mimeType ||
      TEXT_MIME_TYPE

    let inferred_mime = record.metadata.encryptionScheme
      ? url.searchParams.get("mime") || (ext && mime.getType(ext)) || BINARY_MIME_TYPE
      : realMime
    inferred_mime = sanitize(inferred_mime)

    const decryptedContentType = record.metadata.encryptionScheme ? sanitize(realMime) : null

    // check `if-modified-since`
    const pasteLastModifiedUnix = record.metadata.lastModifiedAtUnix
    const headerModifiedSince = request.headers.get("If-Modified-Since")
    if (headerModifiedSince) {
      const headerModifiedSinceUnix = Date.parse(headerModifiedSince) / 1000
      if (pasteLastModifiedUnix <= headerModifiedSinceUnix) {
        return new Response(null, {
          status: 304, // Not Modified
          headers: lastModifiedHeader(record.metadata),
        })
      }
    }

    // determine filename with priority: url path > meta
    let returnFilename = filename || record.metadata.filename
    if (returnFilename && !filename && record.metadata.encryptionScheme) {
      returnFilename = returnFilename + ".encrypted" // to avoid clients choose open method with extension
    }

    // handle URL redirection
    if (role === "u") {
      if (record.metadata.sizeBytes > MAX_URL_REDIRECT_LEN) {
        throw new WorkerError(400, `URL too long to be redirected (max ${MAX_URL_REDIRECT_LEN} bytes)`)
      }
      await consumeBeforeOpen()
      const redirectURL = await bodyToText((await requireBody()).paste)
      if (isLegalUrl(redirectURL)) {
        return Response.redirect(redirectURL)
      } else {
        throw new WorkerError(400, "cannot parse paste content as a legal URL")
      }
    }

    // handle article (render as markdown)
    if (role === "a") {
      await consumeBeforeOpen()
      const article = isHead ? null : makeMarkdown(await bodyToText((await requireBody()).paste))
      return new Response(article, {
        headers: {
          "Content-Type": `text/html;charset=UTF-8`,
          ...pasteCacheHeader(env, record.metadata),
          ...lastModifiedHeader(record.metadata),
        },
      })
    }

    // handle metadata access
    if (role === "m") {
      await refreshRemainingReads(env, name, record)
      const returnedMetadata = metaResponseFromMetadata(record.metadata)
      return new Response(isHead ? null : JSON.stringify(returnedMetadata, null, 2), {
        headers: {
          "Content-Type": `application/json;charset=UTF-8`,
          ...pasteCacheHeader(env, record.metadata),
          ...lastModifiedHeader(record.metadata),
        },
      })
    }

    // handle display page with SSR
    if (role === "d") {
      try {
        const { canRenderDisplayPage, renderDisplayPage } = await import("../pages/display.js")
        const urlLang = url.searchParams.get("lang") || undefined
        if (!isHead && canRenderDisplayPage(record.metadata)) {
          await consumeBeforeOpen()
          const page = await renderDisplayPage(
            env,
            name,
            filename,
            ext,
            urlLang,
            (await requireBody()).paste,
            record.metadata,
          )
          if (page) {
            return new Response(page, {
              headers: {
                "Content-Type": `text/html;charset=UTF-8`,
                ...pasteCacheHeader(env, record.metadata),
                ...lastModifiedHeader(record.metadata),
              },
            })
          }
        }
        // SSR skipped, fall through to CSR
      } catch (e) {
        if (e instanceof WorkerError) throw e
        console.error("SSR failed, falling back to CSR:", e)
      }
      // CSR fallback
      const pageUrl = url
      pageUrl.search = ""
      pageUrl.pathname = "/display.html"
      const displayName = record.metadata.filenames?.length
        ? itemCountLabel(record.metadata.filenames.length)
        : filenameForTitle(record.metadata.filename)
      const titleFilename = filenameForTitle(filename)
      const page = (await (await env.ASSETS.fetch(pageUrl)).text()).replace(
        "{{PASTE_NAME}}",
        name + (titleFilename ? " / " + titleFilename : ext ? ext : displayName ? " / " + displayName : ""),
      )
      return new Response(isHead ? null : page, {
        headers: {
          "Content-Type": `text/html;charset=UTF-8`,
          ...pasteCacheHeader(env, record.metadata),
          ...lastModifiedHeader(record.metadata),
        },
      })
    }

    // handle default
    const supportsRange = record.metadata.location === "R2" && !hasReadLimit(record.metadata)
    if (!isHead && supportsRange) {
      const parsedRange = parseByteRange(request.headers.get("Range"), record.metadata.sizeBytes)
      const applyRange = parsedRange.kind !== "none" && (await ifRangeMatches(request, env, name, record.metadata))
      if (applyRange && parsedRange.kind === "unsatisfiable") {
        return new Response(null, {
          status: 416,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${record.metadata.sizeBytes}`,
            "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range",
            ...pasteCacheHeader(env, record.metadata),
            ...lastModifiedHeader(record.metadata),
          },
        })
      }
      if (applyRange && parsedRange.kind === "range") responseRange = parsedRange.range
    }

    if (isHead) {
      await refreshRemainingReads(env, name, record)
    } else {
      await consumeBeforeOpen()
      await requireBody()
    }

    const headers: Headers = {
      "Content-Type": `${inferred_mime}`,
      ...pasteCacheHeader(env, record.metadata),
      ...lastModifiedHeader(record.metadata),
    }
    const exposeHeaders = ["Content-Disposition"]

    if (supportsRange) {
      headers["Accept-Ranges"] = "bytes"
      exposeHeaders.push("Accept-Ranges")
    }

    if (responseRange) {
      const end = responseRange.offset + responseRange.length - 1
      headers["Content-Range"] = `bytes ${responseRange.offset}-${end}/${record.metadata.sizeBytes}`
      headers["Content-Length"] = responseRange.length.toString()
      exposeHeaders.push("Content-Range")
    }

    if (record.metadata.encryptionScheme) {
      headers["X-PB-Encryption-Scheme"] = record.metadata.encryptionScheme
      exposeHeaders.push("X-PB-Encryption-Scheme")
      if (decryptedContentType !== null) {
        headers["X-PB-Decrypted-Content-Type"] = decryptedContentType
        exposeHeaders.push("X-PB-Decrypted-Content-Type")
      }
    }

    if (record.metadata.highlightLanguage) {
      headers["X-PB-Highlight-Language"] = record.metadata.highlightLanguage
      exposeHeaders.push("X-PB-Highlight-Language")
    }

    if (record.metadata.remainingReads !== undefined) {
      headers["X-PB-Remaining-Reads"] = record.metadata.remainingReads.toString()
      exposeHeaders.push("X-PB-Remaining-Reads")
    }

    if (body?.httpEtag) {
      headers.etag = body.httpEtag
    }

    if (returnFilename) {
      const encodedFilename = encodeURIComponent(returnFilename)
      headers["Content-Disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
    } else {
      headers["Content-Disposition"] = `${disp}`
    }
    headers["Access-Control-Expose-Headers"] = exposeHeaders.join(", ")

    // if content is nonempty, Content-Length will be set automatically
    if (isHead) {
      headers["Content-Length"] = record.metadata.sizeBytes.toString()
    }
    const response = new Response(isHead ? null : body!.paste, { status: responseRange ? 206 : 200, headers })
    return response
  } finally {
    await discardPasteRecord(record)
  }
}
