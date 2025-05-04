// This file contains things shared with frontend

export type PasteLocation = "KV" | "R2"

export type PasteResponse = {
  url: string
  manageUrl: string
  expirationSeconds: number
  expireAt: string
}

export type MetaResponse = {
  lastModifiedAt: string
  createdAt: string
  expireAt: string
  sizeBytes: number
  location: PasteLocation
  filename?: string
  highlightLanguage?: string
  encryptionScheme?: string
}

export type MPUCreateResponse = {
  name: string
  key: string
  uploadId: string
}
