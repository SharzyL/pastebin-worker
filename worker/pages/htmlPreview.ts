// The /h/<name> page: a sticky header naming the site, a warning saying what
// the paste can and cannot do, and, once the viewer agrees, the paste
// rendered in a sandboxed iframe below the header. The browser fetches the
// paste (and decrypts it if needed), reads its title, and puts it in the
// frame as srcdoc or a blob URL: the raw URL itself never serves HTML. The
// header is in a document of its own so the paste cannot hide or cover it,
// and the sandbox keeps the paste in an opaque origin.
import { escapeHtml } from "../common.js"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"
import { getAssetPaths } from "../ssrUtils.js"
import { PASTE_SANDBOX_FLAGS } from "../../shared/mime.js"
import {
  HTML_PREVIEW_GATE_ID,
  HTML_PREVIEW_ID,
  HTML_PREVIEW_RENDER_ID,
  HTML_PREVIEW_STATUS_ID,
} from "../../shared/constants.js"

const styles = `
  :root { color-scheme: light dark; --bg: #f6f8fa; --fg: #1f2328; --muted: #59636e; --link: #0969da; --border: #d0d7de; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161b22; --fg: #e6edf3; --muted: #9198a1; --link: #4493f8; --border: #30363d; } }
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1rem; padding: 0.4rem 1rem; border-bottom: 1px solid var(--border); }
  .bar a { color: var(--link); text-decoration: none; }
  .bar a:hover { text-decoration: underline; }
  .site { font-weight: 600; }
  .label { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .links { display: flex; gap: 1rem; margin-left: auto; }
  .gate { max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
  .gate h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  .gate h2 { font-size: 1rem; margin: 0 0 0.25rem; }
  .gate ul { margin: 0; padding-left: 1.25rem; }
  .gate li { margin: 0.2rem 0; }
  .cols { display: grid; gap: 1rem 2rem; margin: 1rem 0; }
  @media (min-width: 40rem) { .cols { grid-template-columns: 1fr 1fr; } }
  .actions { display: flex; align-items: center; gap: 1.5rem; }
  .actions button { font: inherit; padding: 0.4rem 1.2rem; border: 1px solid var(--border); border-radius: 0.4rem; background: var(--link); color: #fff; cursor: pointer; }
  .actions button:hover { filter: brightness(1.1); }
  #${HTML_PREVIEW_ID} { flex: 1 1 auto; width: 100%; border: 0; background: #fff; }
  #${HTML_PREVIEW_STATUS_ID} { margin: 2rem 1rem; color: var(--muted); }
  [hidden] { display: none !important; }
`

export interface HtmlPreviewOptions {
  name: string
  ext?: string
  filename?: string
  // the query string for the framed paste, with its leading "?", or empty
  search: string
  encryptionScheme?: string
  // the `type/subtype` the paste is rendered as
  type: string
}

// The part of a paste URL after the name: `/<filename>` or `.<ext>`
export function pathSuffix(ext?: string, filename?: string): string {
  return filename ? `/${encodeURIComponent(filename)}` : (ext ?? "")
}

export function makeHtmlPreview(
  env: Env,
  { name, ext, filename, search, encryptionScheme, type }: HtmlPreviewOptions,
): string {
  const site = env.INDEX_PAGE_TITLE || "Pastebin"
  const suffix = pathSuffix(ext, filename)
  const rawPath = `/${name}${suffix}${search}`
  const label = `${name}${filename ? ` / ${filename}` : (ext ?? "")}`
  const { jsFile } = getAssetPaths(manifest, "pages/render/htmlPreview.ts")
  const keepKey = encryptionScheme ? " data-keep-key" : ""

  // The frame stays empty until the viewer agrees to render the paste. The
  // script then fetches `data-src`, decrypts it with the key in the URL
  // fragment if `data-scheme` is set (the key never reaches the server, and
  // the page carries nothing derived from the content), and renders it as
  // `data-type`.
  const scheme = encryptionScheme ? ` data-scheme="${escapeHtml(encryptionScheme)}"` : ""
  const frame = `<iframe id="${HTML_PREVIEW_ID}" sandbox="${PASTE_SANDBOX_FLAGS}" title="Paste content" data-src="${escapeHtml(rawPath)}" data-type="${escapeHtml(type)}"${scheme} hidden></iframe>`
  const sourceLink = `<a href="/d/${escapeHtml(name + suffix)}"${keepKey}>View source</a>`
  const links = encryptionScheme ? sourceLink : `${sourceLink}<a href="/${escapeHtml(name + suffix)}?a">Download</a>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <!-- srcdoc documents resolve relative URLs against this page's base: make it the site root, as for the raw URL -->
  <base href="/">
  <title>${escapeHtml(label)} - ${escapeHtml(site)}</title>
  <style>${styles}</style>
  <script type="module" src="/${jsFile}"></script>
</head>
<body>
<header class="bar">
  <a class="site" href="/">${escapeHtml(site)}</a>
  <span class="label">${escapeHtml(label)}${encryptionScheme ? " (encrypted)" : ""}</span>
  <nav class="links">${links}</nav>
</header>
<section id="${HTML_PREVIEW_GATE_ID}" class="gate" aria-labelledby="gate-title">
  <h1 id="gate-title">Render this paste as a web page?</h1>
  <p>It was uploaded by a user, not by ${escapeHtml(site)}, and runs in a sandbox.</p>
  <div class="cols">
    <div>
      <h2>It can</h2>
      <ul>
        <li>run scripts, show forms, open pop-ups and dialogs</li>
        <li>load resources from other sites, so its author can learn that you visited, when, your IP address and browser</li>
        <li>look like any site, including this one, and ask you to type things in</li>
      </ul>
    </div>
    <div>
      <h2>It cannot</h2>
      <ul>
        <li>read your cookies, logins or storage on ${escapeHtml(site)}</li>
        <li>read or change other pastes with your credentials</li>
        <li>leave this page, hide this header, or use your camera, microphone or location</li>
      </ul>
    </div>
  </div>
  <p class="actions">
    <button id="${HTML_PREVIEW_RENDER_ID}" type="button" autofocus>Render</button>
    ${sourceLink}
  </p>
  <noscript><p>Rendering needs JavaScript.</p></noscript>
</section>
<p id="${HTML_PREVIEW_STATUS_ID}" hidden></p>
${frame}
</body>
</html>
`
}
