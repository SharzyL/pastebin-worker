export const params = {
  CHAR_GEN : "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678",
  NAME_REGEX : /^[a-zA-Z0-9+_\-\[\]*$:@,;\/]{3,}$/,
  RAND_LEN : 4,
  PRIVATE_RAND_LEN : 24,
  ADMIN_PATH_LEN : 24,
  SEP : ":",
  MAX_LEN : 25 * 1024 * 1024,
}

export function decode(arrayBuffer) {
  return new TextDecoder().decode(arrayBuffer)
}

export class WorkerError extends Error {
  constructor(statusCode, ...params) {
    super(...params)
    this.statusCode = statusCode
  }
}

export function genRandStr(len) {
  // TODO: switch to Web Crypto random generator
  let str = ""
  const numOfRand = params.CHAR_GEN.length
  for (let i = 0; i < len; i++) {
    str += params.CHAR_GEN.charAt(Math.floor(Math.random() * numOfRand))
  }
  return str
}

export function parsePath(pathname) {
  // Example of paths (SEP=':'). Note: query string is not processed here
  // > example.com/~stocking
  // > example.com/~stocking:uLE4Fhb/d3414adlW653Vx0VSVw=
  // > example.com/abcd
  // > example.com/abcd.jpg
  // > example.com/u/abcd
  // > example.com/abcd:3ffd2e7ff214989646e006bd9ad36c58d447065e
  let role = "", ext = ""
  if (pathname[2] === "/") {
    role = pathname[1]
    pathname = pathname.slice(2)
  }
  let startOfExt = pathname.indexOf(".")
  if (startOfExt >= 0) {
    ext = pathname.slice(startOfExt)
    pathname = pathname.slice(0, startOfExt)
  }
  let endOfShort = pathname.indexOf(params.SEP)
  if (endOfShort < 0) endOfShort = pathname.length // when there is no SEP, passwd is left empty
  const short = pathname.slice(1, endOfShort)
  const passwd = pathname.slice(endOfShort + 1)
  return { role, short, passwd, ext }
}

export function parseExpiration(expirationStr) {
  let expirationSeconds = parseFloat(expirationStr)
  const lastChar = expirationStr[expirationStr.length - 1]
  if (lastChar === 'm') expirationSeconds *= 60
  else if (lastChar === 'h') expirationSeconds *= 3600
  else if (lastChar === 'd') expirationSeconds *= 3600 * 24
  else if (lastChar === 'w') expirationSeconds *= 3600 * 24 * 7
  else if (lastChar === 'M') expirationSeconds *= 3600 * 24 * 7 * 30
  return expirationSeconds
}

export function escapeHtml(str) {
  const tagsToReplace = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot",
    "'": "&#x27"
  }
  return str.replace(/[&<>]/g, function (tag) {
    return tagsToReplace[tag] || tag
  })
}

