// Slim per-entry asset map produced by the `ssr-manifest` Vite plugin in
// frontend/vite.config.js. Importing the full Vite manifest pulls every chunk
// (one per highlight.js language) into the worker bundle, which we don't want.
export interface SsrAssetPaths {
  jsFile: string
  // ALL transitively-reached CSS chunk paths for this entry, not just one —
  // an entry like index.html now reaches both a Tailwind/component-styles
  // chunk and a highlight-theme chunk through different transitive imports.
  cssPaths: string[]
}

export type SsrManifest = Record<string, SsrAssetPaths>

export function getAssetPaths(manifest: SsrManifest, entryKey: string): SsrAssetPaths {
  return manifest[entryKey] ?? { jsFile: `assets/${entryKey.replace(".html", ".js")}`, cssPaths: ["assets/style.css"] }
}

export function renderCssLinks(cssPaths: readonly string[]): string {
  return cssPaths.map((p) => `<link rel="stylesheet" href="/${p}">`).join("")
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
