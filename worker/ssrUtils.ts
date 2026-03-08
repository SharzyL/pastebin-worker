export interface ManifestEntry {
  file: string
  imports?: string[]
  css?: string[]
}

export type Manifest = Record<string, ManifestEntry>

export function getAssetPaths(manifest: Manifest, entryKey: string) {
  const entry = manifest[entryKey]
  const jsFile = entry?.file || `assets/${entryKey.replace(".html", ".js")}`
  const cssImport = entry?.imports?.find((i) => manifest[i]?.css)
  const cssPath = (cssImport && manifest[cssImport]?.css?.[0]) || "assets/style.css"
  return { jsFile, cssPath }
}

export const DARK_MODE_SCRIPT = `(function() {
  const stored = localStorage.getItem('darkModeSelect') || 'system';
  const isDark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.add(isDark ? 'dark' : 'light');
  root.style.colorScheme = isDark ? 'dark' : 'light';
})();`

export const MAX_SSR_FILE_SIZE = 1024 * 1024 // 1MB
