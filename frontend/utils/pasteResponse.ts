import type { MetaResponse } from "../../shared/interfaces.js"
import { parseFilenameFromContentDisposition } from "../../shared/parsers.js"
import type { EncryptionScheme } from "../../shared/constants.js"

export interface ParsedPasteResponse {
  contentType: string | null
  contentLength: number | null
  highlightLanguage: string | null
  encryptionScheme: EncryptionScheme | null
  decryptedContentType: string | null
  effectiveContentType: string | null
  mimeType: string
  contentDisposition: string | null
  filename: string | undefined
  remainingReads: string | null
}

export function isMetaResponse(value: unknown): value is MetaResponse {
  return typeof value === "object" && value !== null && typeof (value as MetaResponse).sizeBytes === "number"
}

export function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function stripEncryptedSuffix(filename: string | undefined): string | undefined {
  return filename?.replace(/\.encrypted$/, "")
}

export function parsePasteResponseHeaders(
  headers: Headers,
  encryptionSchemeOverride?: EncryptionScheme | null,
): ParsedPasteResponse {
  const contentType = headers.get("Content-Type")
  const headerEncryptionScheme = headers.get("X-PB-Encryption-Scheme") as EncryptionScheme | null
  const encryptionScheme = encryptionSchemeOverride === undefined ? headerEncryptionScheme : encryptionSchemeOverride
  const decryptedContentType = headers.get("X-PB-Decrypted-Content-Type")
  const effectiveContentType = encryptionScheme === null ? contentType : decryptedContentType
  const contentDisposition = headers.get("Content-Disposition")
  const parsedFilename = contentDisposition
    ? parseFilenameFromContentDisposition(contentDisposition) || undefined
    : undefined

  return {
    contentType,
    contentLength: parseContentLength(headers.get("Content-Length")),
    highlightLanguage: headers.get("X-PB-Highlight-Language"),
    encryptionScheme,
    decryptedContentType,
    effectiveContentType,
    mimeType: effectiveContentType?.split(";", 1)[0]?.trim() || "",
    contentDisposition,
    filename: encryptionScheme === null ? parsedFilename : stripEncryptedSuffix(parsedFilename),
    remainingReads: headers.get("X-PB-Remaining-Reads"),
  }
}
