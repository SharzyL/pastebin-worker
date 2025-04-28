// This file contains things shared with frontend

export type PasteLocation = "KV" | "R2"

export type PasteResponse = {
  url: string
  suggestedUrl?: string
  manageUrl: string
  expirationSeconds: number
  expireAt: string
}

export type MetaResponse = {
  lastModifiedAt: string
  createdAt: string
  expireAt: string
  sizeBytes: number
  filename?: string
  location: PasteLocation
}

export const CHAR_GEN = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678"
export const NAME_REGEX = /^[a-zA-Z0-9+_\-[\]*$@,;]{3,}$/
export const PASTE_NAME_LEN = 4
export const PRIVATE_PASTE_NAME_LEN = 24
export const DEFAULT_PASSWD_LEN = 24
export const MAX_PASSWD_LEN = 128
export const MIN_PASSWD_LEN = 8
export const MAX_URL_REDIRECT_LEN = 2000
export const PASSWD_SEP = ":"

export function parseSize(sizeStr: string): number | null {
  sizeStr = sizeStr.trim()
  const EXPIRE_REGEX = /^[\d.]+\s*[KMG]?$/
  if (!EXPIRE_REGEX.test(sizeStr)) {
    return null
  }

  let sizeBytes = parseFloat(sizeStr)
  const lastChar = sizeStr[sizeStr.length - 1]
  if (lastChar === "K") sizeBytes *= 1024
  else if (lastChar === "M") sizeBytes *= 1024 * 1024
  else if (lastChar === "G") sizeBytes *= 1024 * 1024 * 1024
  return sizeBytes
}

export function parseExpiration(expirationStr: string): number | null {
  expirationStr = expirationStr.trim()
  const EXPIRE_REGEX = /^[\d.]+\s*[smhd]?$/
  if (!EXPIRE_REGEX.test(expirationStr)) {
    return null
  }

  let expirationSeconds = parseFloat(expirationStr)
  const lastChar = expirationStr[expirationStr.length - 1]
  if (lastChar === "m") expirationSeconds *= 60
  else if (lastChar === "h") expirationSeconds *= 3600
  else if (lastChar === "d") expirationSeconds *= 3600 * 24
  return expirationSeconds
}

export function parseExpirationReadable(expirationStr: string): string | null {
  expirationStr = expirationStr.trim()
  const EXPIRE_REGEX = /^[\d.]+\s*[smhd]?$/
  if (!EXPIRE_REGEX.test(expirationStr)) {
    return null
  }

  const expirationSeconds = parseFloat(expirationStr)
  const lastChar = expirationStr[expirationStr.length - 1]
  if (lastChar === "m") return `${expirationSeconds} minutes`
  else if (lastChar === "h") return `${expirationSeconds} hours`
  else if (lastChar === "d") return `${expirationSeconds} days`
  return `${expirationSeconds} seconds`
}

export type ParsedPath = {
  nameFromPath: string
  role?: string
  passwd?: string
  ext?: string
  filename?: string
}

export function parsePath(pathname: string): ParsedPath {
  pathname = pathname.slice(1) // strip the leading slash

  let role: string | undefined,
    ext: string | undefined,
    filename: string | undefined,
    passwd: string | undefined,
    short: string | undefined

  // extract and remove role
  if (pathname[1] === "/") {
    role = pathname[0]
    pathname = pathname.slice(2)
  }

  // extract and remove filename
  const startOfFilename = pathname.lastIndexOf("/")
  if (startOfFilename >= 0) {
    filename = decodeURIComponent(pathname.slice(startOfFilename + 1))
    pathname = pathname.slice(0, startOfFilename)
  }

  // if having filename, parse ext from filename, else from remaining pathname
  if (filename) {
    const startOfExt = filename.indexOf(".")
    if (startOfExt >= 0) {
      ext = filename.slice(startOfExt)
    }
  } else {
    const startOfExt = pathname.indexOf(".")
    if (startOfExt >= 0) {
      ext = pathname.slice(startOfExt)
      pathname = pathname.slice(0, startOfExt)
    }
  }

  const endOfShort = pathname.indexOf(PASSWD_SEP)
  if (endOfShort < 0) {
    short = pathname
    passwd = undefined
  } else {
    short = pathname.slice(0, endOfShort)
    passwd = pathname.slice(endOfShort + 1)
  }
  return { role, nameFromPath: short, passwd, ext, filename }
}

export function parseFilenameFromContentDisposition(contentDisposition: string): string | undefined {
  let filename: string | undefined = undefined

  // 尝试解析 filename*
  const filenameStarRegex = /filename\*=UTF-8''([^;]*)/i
  const filenameStarMatch = contentDisposition.match(filenameStarRegex)

  if (filenameStarMatch && filenameStarMatch[1]) {
    filename = decodeURIComponent(filenameStarMatch[1])
  }

  if (!filename) {
    const filenameRegex = /filename="([^"]*)"/i
    const filenameMatch = contentDisposition.match(filenameRegex)

    if (filenameMatch && filenameMatch[1]) {
      filename = filenameMatch[1]
    }
  }

  return filename
}
