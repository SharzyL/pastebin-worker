import { parsePath } from "../../shared/parsers.js"

export function withPathPrefix(url: string, prefix: string): string {
  const u = new URL(url)
  u.pathname = prefix + u.pathname
  return u.toString()
}

export function makeDisplayUrl(url: string, encryptionKey?: string): string {
  const displayUrl = withPathPrefix(url, "/d")
  return encryptionKey ? `${displayUrl}#${encryptionKey}` : displayUrl
}

export function pasteKeyFromUrl(url: string): string {
  return parsePath(new URL(url).pathname).name
}
