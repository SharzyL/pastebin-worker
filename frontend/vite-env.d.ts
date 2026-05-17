/// <reference types="vite/client" />
/// <reference types="../worker-configuration" />

declare const __WRANGLER_CONFIG__: Env

declare module "virtual:hljs-aliases" {
  // alias name (e.g. "js", "py") → canonical highlight.js language name
  // (e.g. "javascript", "python"). Built by frontend/vite.config.js from the
  // installed highlight.js language sources.
  const aliases: Record<string, string>
  export default aliases
}
