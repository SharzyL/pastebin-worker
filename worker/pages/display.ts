import { renderToReadableStream } from "react-dom/server.edge"
import React from "react"
import { HeroUIProvider } from "@heroui/react"
import { DisplayPasteView } from "../../frontend/pages/DisplayPasteView.js"
import type { PasteMetadata } from "../storage/storage.js"
import type { SerializedPasteData, MetaResponse } from "../../shared/interfaces.js"
import { decode, escapeHtml } from "../common.js"
import manifest from "../../dist/frontend/.vite/manifest.json"
import chardet from "chardet"
import { getAssetPaths, DARK_MODE_SCRIPT, MAX_SSR_FILE_SIZE, type Manifest } from "../ssrUtils.js"

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result.buffer
}

export async function renderDisplayPage(
  env: Env,
  name: string,
  paste: ArrayBuffer | ReadableStream<Uint8Array>,
  metadata: PasteMetadata,
): Promise<string | null> {
  // Skip SSR for encrypted files (client needs hash key to decrypt)
  if (metadata.encryptionScheme) {
    return null
  }

  // Skip SSR for large files (>1MB) to avoid memory/CPU overhead
  if (metadata.sizeBytes > MAX_SSR_FILE_SIZE) {
    return null
  }

  const content = paste instanceof ArrayBuffer ? paste : await streamToArrayBuffer(paste)

  // Detect binary files
  const utf8CompatibleEncodings = ["UTF-8", "ASCII", "ISO-8859-1"]
  const encoding = chardet.detect(new Uint8Array(content))
  const isBinary = encoding === null || !utf8CompatibleEncodings.includes(encoding)

  const contentBase64 = arrayBufferToBase64(content)

  const metaResponse: MetaResponse = {
    lastModifiedAt: new Date(metadata.lastModifiedAtUnix * 1000).toISOString(),
    createdAt: new Date(metadata.createdAtUnix * 1000).toISOString(),
    expireAt: new Date(metadata.willExpireAtUnix * 1000).toISOString(),
    sizeBytes: metadata.sizeBytes,
    location: metadata.location,
    filename: metadata.filename,
    highlightLanguage: metadata.highlightLanguage,
    encryptionScheme: metadata.encryptionScheme,
  }

  const serializedData: SerializedPasteData = {
    content: contentBase64,
    metadata: metaResponse,
    name,
    isBinary,
    guessedEncoding: encoding,
  }

  const pasteFile = new File([content], metadata.filename || name)

  const config: Env = {
    DEPLOY_URL: env.DEPLOY_URL,
    REPO: env.REPO,
    MAX_EXPIRATION: env.MAX_EXPIRATION,
    DEFAULT_EXPIRATION: env.DEFAULT_EXPIRATION,
    INDEX_PAGE_TITLE: env.INDEX_PAGE_TITLE,
  } as Env

  const reactElement = React.createElement(
    React.StrictMode,
    null,
    React.createElement(
      HeroUIProvider,
      null,
      React.createElement(DisplayPasteView, {
        pasteFile,
        pasteContentBuffer: content,
        pasteLang: metadata.highlightLanguage,
        isFileBinary: isBinary,
        guessedEncoding: encoding,
        isDecrypted: "not encrypted",
        forceShowBinary: false,
        setForceShowBinary: () => {
          // SSR: no-op
        },
        isLoading: false,
        name,
        config,
      }),
    ),
  )

  const stream = await renderToReadableStream(reactElement)
  const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>
  let html = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    html += decode(value)
  }

  const { jsFile, cssPath } = getAssetPaths(manifest as Manifest, "display.html")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" href="/favicon.ico" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(env.INDEX_PAGE_TITLE)} / ${escapeHtml(name)}</title>
<link rel="stylesheet" href="/${cssPath}">
<script>
${DARK_MODE_SCRIPT}
</script>
</head>
<body>
<div id="root">${html}</div>
<script id="__PASTE_DATA__" type="application/json">${JSON.stringify(serializedData)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")}</script>
<script>window.__PASTE_DATA__=JSON.parse(document.getElementById('__PASTE_DATA__').textContent)</script>
<script type="module" src="/${jsFile}"></script>
</body>
</html>`
}
