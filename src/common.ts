import {FormDataDisposition} from "./parseFormdata.js";

export const params = {
  CHAR_GEN : "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678",
  NAME_REGEX : /^[a-zA-Z0-9+_\-\[\]*$@,;]{3,}$/,
  PASTE_NAME_LEN : 4,
  PRIVATE_PASTE_NAME_LEN : 24,
  DEFAULT_PASSWD_LEN : 24,
  SEP : ":",
  MAX_LEN : 25 * 1024 * 1024,
}

export function decode(arrayBuffer: ArrayBuffer): string {
  return new TextDecoder().decode(arrayBuffer)
}

export function btoa_utf8(value: string): string {
  return btoa(
    String.fromCharCode(
      ...new TextEncoder()
        .encode(value)
    )
  );
}

export function atob_utf8(value: string): string {
  const value_latin1 = atob(value);
  return new TextDecoder('utf-8').decode(
    Uint8Array.from(
      { length: value_latin1.length },
      (element, index) => value_latin1.charCodeAt(index)
    )
  )
}


export class WorkerError extends Error {
  public statusCode: number;
  constructor(statusCode: number, ...params: any[]) {
    super(...params)
    this.statusCode = statusCode
  }
}

export function dateToUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function genRandStr(len: number) {
  // TODO: switch to Web Crypto random generator
  let str = ""
  const numOfRand = params.CHAR_GEN.length
  for (let i = 0; i < len; i++) {
    str += params.CHAR_GEN.charAt(Math.floor(Math.random() * numOfRand))
  }
  return str
}

type ParsedPath = {
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
  pathname = pathname.slice(1,)  // strip the leading slash

  let role = undefined, ext = undefined, filename = undefined

  // extract and remove role
  if (pathname[1] === "/") {
    role = pathname[0]
    pathname = pathname.slice(2)
  }

  // extract and remove filename
  let startOfFilename = pathname.lastIndexOf("/")
  if (startOfFilename >= 0) {
    filename = pathname.slice(startOfFilename + 1)
    pathname = pathname.slice(0, startOfFilename)
  }

  // if having filename, parse ext from filename, else from remaining pathname
  if (filename) {
    let startOfExt = filename.indexOf(".")
    if (startOfExt >= 0) {
      ext = filename.slice(startOfExt)
    }
  } else {
    let startOfExt = pathname.indexOf(".")
    if (startOfExt >= 0) {
      ext = pathname.slice(startOfExt)
      pathname = pathname.slice(0, startOfExt)
    }
  }

  let endOfShort = pathname.indexOf(params.SEP)
  if (endOfShort < 0) endOfShort = pathname.length // when there is no SEP, passwd is left empty
  const short = pathname.slice(0, endOfShort)
  const passwd = endOfShort >= 0 ? pathname.slice(endOfShort + 1) : undefined
  return { role, nameFromPath: short, passwd, ext, filename }
}

export function parseExpiration(expirationStr: string): number {
  const EXPIRE_REGEX = /^[\d.]+\s*[smhdwMY]?$/
  if (!EXPIRE_REGEX.test(expirationStr)) {
    throw new WorkerError(400, `‘${expirationStr}’ is not a valid expiration specification`)
  }

  let expirationSeconds = parseFloat(expirationStr)
  const lastChar = expirationStr[expirationStr.length - 1]
  if (lastChar === 'm') expirationSeconds *= 60
  else if (lastChar === 'h') expirationSeconds *= 3600
  else if (lastChar === 'd') expirationSeconds *= 3600 * 24
  else if (lastChar === 'w') expirationSeconds *= 3600 * 24 * 7
  else if (lastChar === 'M') expirationSeconds *= 3600 * 24 * 30
  else if (lastChar === 'Y') expirationSeconds *= 3600 * 24 * 365
  return expirationSeconds
}

export function escapeHtml(str: string): string {
  const tagsToReplace: Map<string, string> = new Map([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ["\"", "&quot"],
    ["'", "&#x27"],
  ])
  return str.replace(/[&<>]/g, function (tag): string{
    return tagsToReplace.get(tag) || tag
  })
}

export function isLegalUrl(url: string): boolean {
  return URL.canParse(url)
}
