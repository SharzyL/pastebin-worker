// Slim per-entry asset map produced by the `ssr-manifest` Vite plugin in
// frontend/vite.config.js. Importing the full Vite manifest pulls every chunk
// (one per highlight.js language) into the worker bundle, which we don't want.
export interface SsrAssetPaths {
  jsFile: string
  // ALL transitively-reached CSS chunk paths for this entry, not just one —
  // an entry like index.html now reaches both a Tailwind/component-styles
  // chunk and a highlight-theme chunk through different transitive imports.
  cssPaths: string[]
  // Every JS chunk the entry imports statically, however deep. Without the
  // hints the browser learns of each import level only after the previous one
  // arrived, a round trip per level.
  preloadPaths: string[]
}

export type SsrManifest = Record<string, SsrAssetPaths>

export function getAssetPaths(manifest: SsrManifest, entryKey: string): SsrAssetPaths {
  return (
    manifest[entryKey] ?? {
      jsFile: `assets/${entryKey.replace(".html", ".js")}`,
      cssPaths: ["assets/style.css"],
      preloadPaths: [],
    }
  )
}

export function renderCssLinks(cssPaths: readonly string[]): string {
  return cssPaths.map((p) => `<link rel="stylesheet" href="/${p}">`).join("")
}

// No crossorigin attribute: the page's module script has none either, and a
// preload only counts when its credentials mode matches the script's.
export function renderPreloadLinks(preloadPaths: readonly string[]): string {
  return preloadPaths.map((p) => `<link rel="modulepreload" href="/${p}">`).join("")
}

// The same hints as a Link header. The header reaches the browser before the
// body does, and Cloudflare turns it into a 103 Early Hints response once that
// is enabled for the zone, so the chunks load while the worker still renders.
export function assetLinkHeader({ cssPaths, preloadPaths }: SsrAssetPaths): Record<string, string> {
  const links = [
    ...cssPaths.map((p) => `</${p}>; rel=preload; as=style`),
    ...preloadPaths.map((p) => `</${p}>; rel=modulepreload`),
  ]
  return links.length > 0 ? { Link: links.join(", ") } : {}
}

export const DARK_MODE_SCRIPT = `(function() {
  const stored = localStorage.getItem('darkModeSelect') || 'system';
  const isDark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.add(isDark ? 'dark' : 'light');
  root.style.colorScheme = isDark ? 'dark' : 'light';
})();`

export const MAX_SSR_FILE_SIZE = 1024 * 1024 // 1MB

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
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
