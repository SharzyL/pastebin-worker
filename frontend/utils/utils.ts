import { PASSWD_SEP } from "../../shared/constants.js"
import { parseExpirationReadable, parseSize } from "../../shared/parsers.js"
import { verifyExpiration as verifyExpirationShared } from "../../shared/verify.js"
import type { PublicEnv } from "../../shared/interfaces.js"

export function getMaxExpirationReadable(config: PublicEnv): string {
  return parseExpirationReadable(config.MAX_EXPIRATION)!
}

export { ErrorWithTitle } from "./errors.js"

export function verifyFileSize(size: number, config: PublicEnv): [boolean, string] {
  const max = parseSize(config.R2_MAX_ALLOWED)
  if (max === null || size <= max) return [true, ""]
  return [false, `File too large (${formatSize(size)} > ${formatSize(max)})`]
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

export function formatSpeed(bytesPerSecond: number | undefined): string {
  const speed = Math.max(0, bytesPerSecond ?? 0)
  const formatRate = (rate: number) => Number(rate.toFixed(1)).toString()
  if (speed < 1024 * 1024) {
    return `${formatRate(speed / 1024)} KB/s`
  } else if (speed < 1024 * 1024 * 1024) {
    return `${formatRate(speed / 1024 / 1024)} MB/s`
  } else {
    return `${formatRate(speed / 1024 / 1024 / 1024)} GB/s`
  }
}

export function verifyExpiration(expiration: string, config: PublicEnv): [boolean, string] {
  return verifyExpirationShared(expiration, config.MAX_EXPIRATION)
}

export function verifyP2PExpiration(expiration: string, config: PublicEnv): [boolean, string] {
  return verifyExpirationShared(expiration, config.MAX_P2P_EXPIRATION)
}

export function verifyManageUrl(url: string, config: PublicEnv): [boolean, string] {
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
