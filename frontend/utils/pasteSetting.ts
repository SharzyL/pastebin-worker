import type { PublicEnv } from "../../shared/interfaces.js"
import { verifyName, verifyPassword, verifyReadLimit, verifyReceiverLimit } from "../../shared/verify.js"
import { verifyExpiration, verifyManageUrl, verifyP2PExpiration } from "./utils.js"

export type UploadKind = "short" | "long" | "custom" | "manage"

export interface PasteSetting {
  uploadKind: UploadKind
  isP2P: boolean
  expiration: string
  readLimit: string
  password: string
  name: string
  manageUrl: string
  doEncrypt: boolean
  verifyP2P: boolean
}

export type ValidationResult = [boolean, string]

export interface PasteSettingValidation {
  expiration: ValidationResult
  readLimit: ValidationResult
  manageUrl: ValidationResult
  password: ValidationResult
  name: ValidationResult
  isValid: boolean
}

const VALID: ValidationResult = [true, ""]

export function validatePasteSetting(setting: PasteSetting, config: PublicEnv): PasteSettingValidation {
  const isP2P = setting.isP2P
  const expiration = isP2P
    ? verifyP2PExpiration(setting.expiration, config)
    : verifyExpiration(setting.expiration, config)
  const readLimit = isP2P ? verifyReceiverLimit(setting.readLimit) : verifyReadLimit(setting.readLimit)
  const manageUrl = !isP2P && setting.uploadKind === "manage" ? verifyManageUrl(setting.manageUrl, config) : VALID
  const password = isP2P ? VALID : verifyPassword(setting.password)
  const name = !isP2P && setting.uploadKind === "custom" ? verifyName(setting.name) : VALID
  const results = [expiration, readLimit, manageUrl, password, name]

  return {
    expiration,
    readLimit,
    manageUrl,
    password,
    name,
    isValid: results.every(([valid]) => valid),
  }
}
