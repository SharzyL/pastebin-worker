// This file contains things shared with frontend

export type PasteResponse = {
  url: string
  suggestedUrl?: string
  manageUrl: string
  expirationSeconds: number
  expireAt: string
}

export const CHAR_GEN = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678"
export const NAME_REGEX = /^[a-zA-Z0-9+_\-[\]*$@,;]{3,}$/
export const PASTE_NAME_LEN = 4
export const PRIVATE_PASTE_NAME_LEN = 24
export const DEFAULT_PASSWD_LEN = 24
export const PASSWD_SEP = ":"
export const MAX_LEN = 25 * 1024 * 1024

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
  // Example of paths (SEP=':'). Note: query string is not processed here
  // > example.com/~stocking
  // > example.com/~stocking:uLE4Fhb/d3414adlW653Vx0VSVw=
  // > example.com/abcd
  // > example.com/abcd.jpg
  // > example.com/abcd/myphoto.jpg
  // > example.com/u/abcd
  // > example.com/abcd:3ffd2e7ff214989646e006bd9ad36c58d447065e
  pathname = pathname.slice(1) // strip the leading slash

  let role: string | undefined = undefined,
    ext: string | undefined = undefined,
    filename: string | undefined = undefined,
    passwd: string | undefined = undefined,
    short: string | undefined = undefined

  // extract and remove role
  if (pathname[1] === "/") {
    role = pathname[0]
    pathname = pathname.slice(2)
  }

  // extract and remove filename
  const startOfFilename = pathname.lastIndexOf("/")
  if (startOfFilename >= 0) {
    filename = pathname.slice(startOfFilename + 1)
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
