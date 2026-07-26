import type { PublicEnv } from "../shared/interfaces.js"

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

export function publicEnv(env: Env): PublicEnv {
  return {
    DEPLOY_URL: env.DEPLOY_URL,
    REPO: env.REPO,
    MAX_EXPIRATION: env.MAX_EXPIRATION,
    DEFAULT_READS: env.DEFAULT_READS,
    DEFAULT_EXPIRATION: env.DEFAULT_EXPIRATION,
    DEFAULT_TAB: env.DEFAULT_TAB,
    DEFAULT_P2P_EXPIRATION: env.DEFAULT_P2P_EXPIRATION,
    MAX_P2P_EXPIRATION: env.MAX_P2P_EXPIRATION,
    DEFAULT_P2P_TRANSFERS: env.DEFAULT_P2P_TRANSFERS,
    DEFAULT_P2P_VERIFY: env.DEFAULT_P2P_VERIFY,
    DEFAULT_P2P_TRANSFER: env.DEFAULT_P2P_TRANSFER,
    INDEX_PAGE_TITLE: env.INDEX_PAGE_TITLE,
    R2_MAX_ALLOWED: env.R2_MAX_ALLOWED,
    DISALLOWED_MIME_FOR_PASTE: env.DISALLOWED_MIME_FOR_PASTE,
  }
}

export const DARK_MODE_SCRIPT = `(function() {
  const stored = localStorage.getItem('darkModeSelect') || 'system';
  const isDark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.add(isDark ? 'dark' : 'light');
  root.style.colorScheme = isDark ? 'dark' : 'light';
})();`

export const MAX_SSR_FILE_SIZE = 1024 * 1024 // 1MB
