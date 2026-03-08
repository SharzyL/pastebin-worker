import { renderToReadableStream } from "react-dom/server.edge"
import React from "react"
import { PasteBin } from "../../frontend/pages/PasteBin.js"
import { decode, escapeHtml } from "../common.js"
import manifest from "../../dist/frontend/.vite/manifest.json"
import { parsePath } from "../../shared/parsers.js"
import { getAssetPaths, DARK_MODE_SCRIPT, type Manifest } from "../ssrUtils.js"

export async function renderIndexPage(env: Env, pathname: string): Promise<string | null> {
  // Check if this is an admin URL (contains password)
  const { password } = parsePath(pathname)

  // Admin URLs skip SSR because they need client-side fetch
  if (password !== undefined) {
    return null
  }

  // Build React element
  const config: Env = {
    DEPLOY_URL: env.DEPLOY_URL,
    REPO: env.REPO,
    MAX_EXPIRATION: env.MAX_EXPIRATION,
    DEFAULT_EXPIRATION: env.DEFAULT_EXPIRATION,
    INDEX_PAGE_TITLE: env.INDEX_PAGE_TITLE,
  } as Env

  const reactElement = React.createElement(React.StrictMode, null, React.createElement(PasteBin, { config }))

  // Render to HTML stream
  const stream = await renderToReadableStream(reactElement)
  const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>
  let html = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    html += decode(value.buffer as ArrayBuffer)
  }

  // Get resource paths from manifest
  const { jsFile, cssPath } = getAssetPaths(manifest as Manifest, "index.html")

  // Generate complete HTML
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" href="/favicon.ico" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(env.INDEX_PAGE_TITLE)}</title>
<link rel="stylesheet" href="/${cssPath}">
<script>
${DARK_MODE_SCRIPT}
</script>
</head>
<body>
<div id="root">${html}</div>
<script type="module" src="/${jsFile}"></script>
</body>
</html>`
}
