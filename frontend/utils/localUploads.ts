import type { OriginalFileInfo, PasteResponse } from "../../shared/interfaces.js"
import { makeDisplayUrl, pasteKeyFromUrl } from "./pasteUrls.js"

export interface LocalUploadRecord {
  key: string
  displayUrl: string
  manageUrl: string
  filename?: string
  filenames?: OriginalFileInfo[]
  expireAt: string
  remainingReads?: number
  sizeBytes: number
}

export const LOCAL_UPLOADS_KEY = "pastebinWorkerLocalUploads"
const MAX_LOCAL_UPLOADS = 50

function isOriginalFileInfo(value: unknown): value is OriginalFileInfo {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === "string" &&
    typeof record.sizeBytes === "number" &&
    Number.isFinite(record.sizeBytes) &&
    record.sizeBytes >= 0
  )
}

function normalizeLocalUploadRecord(value: unknown): LocalUploadRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const displayUrl = record.displayUrl
  const manageUrl = record.manageUrl
  const filename = record.filename
  const filenames = record.filenames
  const expireAt = record.expireAt
  const remainingReads = record.remainingReads
  const sizeBytes = record.sizeBytes

  const hasRecordShape =
    typeof displayUrl === "string" &&
    typeof manageUrl === "string" &&
    typeof expireAt === "string" &&
    typeof sizeBytes === "number" &&
    Number.isFinite(sizeBytes) &&
    sizeBytes >= 0 &&
    (remainingReads === undefined ||
      (typeof remainingReads === "number" && Number.isSafeInteger(remainingReads) && remainingReads >= 0)) &&
    (filename === undefined || typeof filename === "string") &&
    (filenames === undefined || (Array.isArray(filenames) && filenames.every(isOriginalFileInfo)))

  if (!hasRecordShape) return undefined

  let key: string
  if (typeof record.key === "string" && record.key.length > 0) {
    key = record.key
  } else {
    try {
      key = pasteKeyFromUrl(manageUrl)
    } catch {
      return undefined
    }
  }

  const normalized: LocalUploadRecord = {
    key,
    displayUrl,
    manageUrl,
    expireAt,
    sizeBytes,
  }
  if (filename !== undefined) normalized.filename = filename
  if (filenames !== undefined) normalized.filenames = filenames
  if (remainingReads !== undefined) normalized.remainingReads = remainingReads
  return normalized
}

function isExpired(record: LocalUploadRecord, now = Date.now()): boolean {
  const expireTime = new Date(record.expireAt).getTime()
  return Number.isFinite(expireTime) && expireTime <= now
}

export function readLocalUploads(): LocalUploadRecord[] {
  if (typeof window === "undefined") return []

  try {
    const raw = window.localStorage.getItem(LOCAL_UPLOADS_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const records = parsed.flatMap((item) => {
      const record = normalizeLocalUploadRecord(item)
      return record === undefined ? [] : [record]
    })
    const activeRecords = records.filter((record) => !isExpired(record))
    if (activeRecords.length !== records.length) {
      writeLocalUploads(activeRecords)
    }
    return activeRecords
  } catch {
    return []
  }
}

export function writeLocalUploads(records: LocalUploadRecord[]): LocalUploadRecord[] {
  const nextRecords = records.slice(0, MAX_LOCAL_UPLOADS)
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCAL_UPLOADS_KEY, JSON.stringify(nextRecords))
    } catch {
      // Local upload history is best-effort; storage failures should not break uploads.
    }
  }
  return nextRecords
}

export function upsertLocalUpload(response: PasteResponse, encryptionKey?: string): LocalUploadRecord[] {
  const record: LocalUploadRecord = {
    key: pasteKeyFromUrl(response.url),
    displayUrl: makeDisplayUrl(response.url, encryptionKey),
    manageUrl: response.manageUrl,
    filename: response.filename,
    filenames: response.filenames,
    expireAt: response.expireAt,
    remainingReads: response.remainingReads,
    sizeBytes: response.sizeBytes,
  }

  const records = readLocalUploads()
  return writeLocalUploads([record, ...records.filter((item) => item.key !== record.key)])
}

export function removeLocalUpload(key: string): LocalUploadRecord[] {
  return writeLocalUploads(readLocalUploads().filter((item) => item.key !== key))
}
