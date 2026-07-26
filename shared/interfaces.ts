// This file contains things shared with frontend

export type PasteLocation = "KV" | "R2"

export interface OriginalFileInfo {
  name: string
  sizeBytes: number
}

export interface MetaResponse {
  lastModifiedAt: string
  createdAt: string
  expireAt: string
  sizeBytes: number
  location: PasteLocation
  remainingReads?: number
  filename?: string
  filenames?: OriginalFileInfo[]
  mimeType?: string
  highlightLanguage?: string
  encryptionScheme?: string
}

export interface PasteResponse extends MetaResponse {
  url: string
  manageUrl: string
  expirationSeconds: number
}

export type PublicEnv = Pick<
  Env,
  | "DEPLOY_URL"
  | "REPO"
  | "MAX_EXPIRATION"
  | "DEFAULT_READS"
  | "DEFAULT_EXPIRATION"
  | "DEFAULT_TAB"
  | "DEFAULT_P2P_EXPIRATION"
  | "MAX_P2P_EXPIRATION"
  | "DEFAULT_P2P_TRANSFERS"
  | "DEFAULT_P2P_VERIFY"
  | "DEFAULT_P2P_TRANSFER"
  | "INDEX_PAGE_TITLE"
  | "R2_MAX_ALLOWED"
  | "DISALLOWED_MIME_FOR_PASTE"
>

export interface P2PCreateResponse {
  name: string
  url: string
  displayUrl: string
  senderToken: string
  expireAt: string
  expirationSeconds: number
}

export interface P2PUpdateResponse {
  expireAt: string
  expirationSeconds: number
  maxTransfers: number
  joinable: boolean
  pairedReceivers: number
  successfulReceivers: number
}

export interface P2PIceServer {
  urls: string | string[]
  username?: string
  credential?: string
  credentialType?: "password" | "oauth"
}

export interface MPUCreateResponse {
  name: string
  key: string
  uploadId: string
}

export interface SerializedPasteData {
  content: string
  metadata: MetaResponse
  name: string
  isBinary: boolean
  guessedEncoding: string | null
}

declare global {
  interface Window {
    __PASTE_DATA__?: SerializedPasteData
  }
}
