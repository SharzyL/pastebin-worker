import { PASSWD_SEP } from "./constants.js"

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
  if (isNaN(expirationSeconds)) {
    return null
  }

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

  const num = parseFloat(expirationStr)
  if (isNaN(num)) {
    return null
  }
  const lastChar = expirationStr[expirationStr.length - 1]
  if (lastChar === "m") return `${num} minute${num > 1 ? "s" : ""}`
  else if (lastChar === "h") return `${num} hour${num > 1 ? "s" : ""}`
  else if (lastChar === "d") return `${num} day${num > 1 ? "s" : ""}`
  return `${num} second${num > 1 ? "s" : ""}`
}

export type ParsedPath = {
  name: string
  role?: string
  password?: string
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
  return { role, name: short, password: passwd, ext, filename }
}

export function parseFilenameFromContentDisposition(contentDisposition: string): string | undefined {
  let filename: string | undefined = undefined

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
