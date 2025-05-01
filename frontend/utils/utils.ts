import { NAME_REGEX, PASSWD_SEP } from "../../shared/constants.js"
import { parseExpiration, parseExpirationReadable } from "../../shared/parsers.js"

export const BaseUrl = DEPLOY_URL
export const APIUrl = API_URL

export const maxExpirationSeconds = parseExpiration(MAX_EXPIRATION)!
export const maxExpirationReadable = parseExpirationReadable(MAX_EXPIRATION)!

export class ErrorWithTitle extends Error {
  public title: string

  constructor(title: string, msg: string) {
    super(msg)
    this.title = title
  }
}

export function formatSize(size: number): string {
  if (!size) return "0"
  if (size < 1024) {
    return `${size} Bytes`
  } else if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(2)} KB`
  } else if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)} MB`
  } else {
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
  }
}

export function verifyExpiration(expiration: string): [boolean, string] {
  const parsed = parseExpiration(expiration)
  if (parsed === null) {
    return [false, "Invalid expiration"]
  } else {
    if (parsed > maxExpirationSeconds) {
      return [false, `Exceed max expiration (${maxExpirationReadable})`]
    } else {
      return [true, `Expires in ${parseExpirationReadable(expiration)!}`]
    }
  }
}

export function verifyName(name: string): [boolean, string] {
  if (name.length < 3) {
    return [false, "Should have at least 3 characters"]
  } else if (!NAME_REGEX.test(name)) {
    return [false, "Should only contain alphanumeric and +_-[]*$@,;"]
  } else {
    return [true, ""]
  }
}

export function verifyManageUrl(url: string): [boolean, string] {
  try {
    const url_parsed = new URL(url)
    if (url_parsed.origin !== BaseUrl) {
      return [false, `URL should starts with ${BaseUrl}`]
    } else if (url_parsed.pathname.indexOf(PASSWD_SEP) < 0) {
      return [false, `URL should contain a colon`]
    } else {
      return [true, ""]
    }
  } catch (e) {
    if (e instanceof TypeError) {
      return [false, "Invalid URL"]
    } else {
      throw e
    }
  }
}
