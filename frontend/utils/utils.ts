import { NAME_REGEX, PASSWD_SEP } from "../../shared/constants.js"
import { parseExpiration, parseExpirationReadable } from "../../shared/parsers.js"

export function getMaxExpirationSeconds(config: Env): number {
  return parseExpiration(config.MAX_EXPIRATION)!
}

export function getMaxExpirationReadable(config: Env): string {
  return parseExpirationReadable(config.MAX_EXPIRATION)!
}

export { ErrorWithTitle } from "./errors.js"

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

export function verifyExpiration(expiration: string, config: Env): [boolean, string] {
  const parsed = parseExpiration(expiration)
  if (parsed === null) {
    return [false, "Invalid expiration"]
  } else {
    const maxSeconds = getMaxExpirationSeconds(config)
    const maxReadable = getMaxExpirationReadable(config)
    if (parsed > maxSeconds) {
      return [false, `Exceed max expiration (${maxReadable})`]
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

export function verifyManageUrl(url: string, config: Env): [boolean, string] {
  try {
    const url_parsed = new URL(url)
    if (url_parsed.origin !== config.DEPLOY_URL) {
      return [false, `URL should starts with ${config.DEPLOY_URL}`]
    } else if (!url_parsed.pathname.includes(PASSWD_SEP)) {
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
