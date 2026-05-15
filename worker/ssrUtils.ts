// Slim per-entry asset map produced by the `ssr-manifest` Vite plugin in
// frontend/vite.config.js. Importing the full Vite manifest pulls every chunk
// (one per highlight.js language) into the worker bundle, which we don't want.
export interface SsrAssetPaths {
  jsFile: string
  cssPath: string
}

export type SsrManifest = Record<string, SsrAssetPaths>

export function getAssetPaths(manifest: SsrManifest, entryKey: string): SsrAssetPaths {
  return manifest[entryKey] ?? { jsFile: `assets/${entryKey.replace(".html", ".js")}`, cssPath: "assets/style.css" }
}

export const DARK_MODE_SCRIPT = `(function() {
  const stored = localStorage.getItem('darkModeSelect') || 'system';
  const isDark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.add(isDark ? 'dark' : 'light');
  root.style.colorScheme = isDark ? 'dark' : 'light';
})();`

export const MAX_SSR_FILE_SIZE = 1024 * 1024 // 1MB
