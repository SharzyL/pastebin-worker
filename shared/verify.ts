import { MAX_PASSWD_LEN, MIN_PASSWD_LEN, NAME_REGEX } from "./constants.js"
import { parseExpiration, parseExpirationReadable } from "./parsers.js"

export type VerifyResult = [ok: true, message: string] | [ok: false, error: string]

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

export function verifyExpiration(expiration: string, maxExpirationSeconds: number): VerifyResult {
  const parsed = parseExpiration(expiration)
  if (parsed === null) {
    return [false, `‘${expiration}’ is not a valid expiration specification`]
  }
  if (parsed > maxExpirationSeconds) {
    return [false, `Exceed max expiration (${parseExpirationReadable(`${maxExpirationSeconds}s`)!})`]
  }
  return [true, `Expires in ${parseExpirationReadable(expiration)!}`]
}
