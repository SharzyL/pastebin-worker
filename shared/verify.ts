import { MAX_PASSWD_LEN, MIN_PASSWD_LEN, NAME_REGEX } from "./constants.js"
import type { OriginalFileInfo } from "./interfaces.js"
import { parseExpiration, parseExpirationReadable } from "./parsers.js"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type VerifyResult = [ok: true, message: string] | [ok: false, error: string]

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

export function isLegalUrl(url: string): boolean {
  return URL.canParse(url)
}

export function isOriginalFileInfo(value: unknown): value is OriginalFileInfo {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<OriginalFileInfo>
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.sizeBytes === "number" &&
    Number.isSafeInteger(candidate.sizeBytes) &&
    candidate.sizeBytes >= 0
  )
}

export function verifyPassword(password: string): VerifyResult {
  if (password === "") {
    return [true, ""]
  } else if (password.length < MIN_PASSWD_LEN) {
    return [false, `Password too short (${password.length} < ${MIN_PASSWD_LEN})`]
  } else if (password.length > MAX_PASSWD_LEN) {
    return [false, `Password too long (${password.length} > ${MAX_PASSWD_LEN})`]
  } else if (password.includes("\n")) {
    return [false, "Password should not contain newlines"]
  }
  return [true, ""]
}

export function verifyName(name: string): VerifyResult {
  if (name.length < 3) {
    return [false, "Name should have at least 3 characters"]
  } else if (!NAME_REGEX.test(name)) {
    return [false, `Name ${name} not satisfying regexp ${NAME_REGEX}`]
  }
  return [true, ""]
}

export function verifyExpiration(expiration: string, maxExpiration: string): VerifyResult {
  const parsed = parseExpiration(expiration)
  if (parsed === null) {
    return [false, `‘${expiration}’ is not a valid expiration specification`]
  }
  const maxExpirationSeconds = parseExpiration(maxExpiration)!
  if (parsed > maxExpirationSeconds) {
    return [false, `Exceed max expiration (${parseExpirationReadable(maxExpiration)!})`]
  }
  return [true, `Expires in ${parseExpirationReadable(expiration)!}`]
}

export function parseReadLimit(readLimit: string | number | null | undefined): number | null {
  if (readLimit === null || readLimit === undefined) return null
  const parsed = typeof readLimit === "number" ? readLimit : Number(readLimit)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function verifyReadLimit(readLimit: string | number): VerifyResult {
  const parsed = parseReadLimit(readLimit)
  if (parsed === null) {
    return [false, "Reads must be a non-negative integer"]
  }
  if (parsed === 0) {
    return [true, "Unlimited reads"]
  }
  if (parsed === 1) {
    return [true, "Burn after read"]
  }
  return [true, `${parsed} max reads`]
}

export function verifyReceiverLimit(receiverLimit: string | number): VerifyResult {
  const parsed = parseReadLimit(receiverLimit)
  if (parsed === null) {
    return [false, "Transfers must be a non-negative integer"]
  }
  if (parsed === 0) {
    return [true, "Unlimited transfers"]
  }
  if (parsed === 1) {
    return [true, "Stop after transfer"]
  }
  return [true, `${parsed} max transfers`]
}
