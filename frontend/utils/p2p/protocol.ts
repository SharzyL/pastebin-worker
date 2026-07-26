import type { P2PCreateResponse, P2PUpdateResponse } from "../../../shared/interfaces.js"
import { parseP2PSignalMessage, type P2PSignalMessage } from "../../../shared/p2pSignal.js"

export const verificationBlockSize = 4 * 1024 * 1024
export const maxP2PControlMessageLength = 1024 * 1024
const maxP2PFileNameLength = 1024
const maxP2PTypeLength = 256
const maxP2PMessageTextLength = 2048

export interface P2PFileMeta {
  revision?: string
  name: string
  size: number
  type: string
  lastModified: number
  highlightLanguage?: string
  verifyTransfer: boolean
}

export function isP2PFileMeta(value: unknown): value is P2PFileMeta {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<P2PFileMeta>
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    candidate.name.length <= maxP2PFileNameLength &&
    typeof candidate.size === "number" &&
    Number.isSafeInteger(candidate.size) &&
    candidate.size >= 0 &&
    typeof candidate.type === "string" &&
    candidate.type.length <= maxP2PTypeLength &&
    typeof candidate.lastModified === "number" &&
    Number.isFinite(candidate.lastModified) &&
    typeof candidate.verifyTransfer === "boolean" &&
    (candidate.revision === undefined ||
      (typeof candidate.revision === "string" && candidate.revision.length > 0 && candidate.revision.length <= 128)) &&
    (candidate.highlightLanguage === undefined ||
      (typeof candidate.highlightLanguage === "string" && candidate.highlightLanguage.length <= 128))
  )
}

function parseP2PControlObject(raw: string): Record<string, unknown> {
  if (raw.length > maxP2PControlMessageLength) throw new Error("P2P control message is too large.")
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("Invalid P2P message JSON.")
  }
  if (typeof value !== "object" || value === null || typeof (value as { type?: unknown }).type !== "string") {
    throw new Error("Invalid P2P message.")
  }
  return value as Record<string, unknown>
}

export interface P2PProgress {
  doneBytes: number
  totalBytes: number
  speedBytesPerSecond?: number
}

export interface P2PVerificationManifest {
  blockSize: number
  hashes: string[]
}

export type P2PTransferStatus =
  "READY" | "UPLOADING" | "DOWNLOADING" | "VERIFYING" | "REPAIRING" | "PAUSED" | "WAITING" | "RECONNECTING" | "DONE"

export type P2PConnectionRoute = "direct" | "relay"

export type P2PSenderConnectionPhase =
  "pairing" | "connected" | "pairing-retry" | "reconnecting" | "pairing-failed" | "reconnect-failed" | "disconnected"

export interface P2PSenderFileInfo {
  revision: string
  name: string
  order: number
}

export type P2PFileCleanup = () => Promise<void>

export interface P2PSenderPeerInfo {
  peerId: string
  file: P2PSenderFileInfo
  browser: string
  status: string
  connectionPhase: P2PSenderConnectionPhase
  connectionRoute?: P2PConnectionRoute
  transferStatus: P2PTransferStatus
  progress?: P2PProgress
  isConnected: boolean
  isWaitingForResume: boolean
  isPaused: boolean
  isComplete: boolean
}

export interface P2PSenderSession {
  response: P2PCreateResponse
  currentFile: P2PSenderFileInfo
  updateRoomOptions: (expire: string, maxTransfers: string, signal?: AbortSignal) => Promise<P2PUpdateResponse>
  updateFile: (
    file: File,
    verifyTransfer: boolean,
    highlightLanguage?: string,
    cleanup?: P2PFileCleanup,
  ) => P2PSenderFileInfo
  close: () => void
}

export interface P2PReceiverSession {
  requestDownload: () => void
  acceptUpdate: () => void
  pause: () => void
  resume: () => void
  terminate: () => void
  close: () => void
}

export interface P2PReceiverCallbacks {
  onStatus: (status: string) => void
  onConnectionRouteChange?: (route: P2PConnectionRoute | undefined) => void
  onMeta: (meta: P2PFileMeta) => void
  onUpdateAvailable?: (meta: P2PFileMeta | undefined) => void
  onProgress: (progress: P2PProgress | undefined) => void
  onPausedChange: (isPaused: boolean) => void
  onPausePendingChange?: (isPending: boolean) => void
  onReconnectingChange?: (isReconnecting: boolean) => void
  onFile: (file: File) => void
  onAbandoned?: () => void
  onTransferLimitReached?: () => void
  onRoomAvailabilityChange?: (joinable: boolean) => void
  onError: (error: Error) => void
}

export interface P2PTransferHistoryItem {
  id: string
  meta: P2PFileMeta
  status: string
  transferStatus: P2PTransferStatus | "STOPPED"
  connectionRoute?: P2PConnectionRoute
  progress?: P2PProgress
  file?: File
}

export type SignalMessage = P2PSignalMessage
export { parseP2PSignalMessage }

export type DataMessage =
  | { type: "meta"; meta: P2PFileMeta }
  | { type: "file-update"; meta: P2PFileMeta }
  | { type: "download"; offset: number; revision?: string }
  | { type: "progress"; doneBytes: number; revision?: string }
  | { type: "pause" }
  | { type: "paused" }
  | { type: "stop" }
  | { type: "stopped" }
  | { type: "verification-start"; blockSize: number; hashCount: number }
  | { type: "verification-chunk"; startIndex: number; hashes: string[] }
  | { type: "done"; verification?: P2PVerificationManifest }
  | { type: "repair-request"; indices: number[] }
  | { type: "repair-start"; index: number; size: number }
  | { type: "repair-end"; index: number }
  | { type: "verified" }
  | { type: "received"; revision?: string }
  | { type: "error"; message: string }

export type P2PDataMessageSource = "sender" | "receiver"

const senderDataMessageTypes = new Set<DataMessage["type"]>([
  "meta",
  "file-update",
  "paused",
  "stopped",
  "verification-start",
  "verification-chunk",
  "done",
  "repair-start",
  "repair-end",
  "error",
])

const receiverDataMessageTypes = new Set<DataMessage["type"]>([
  "download",
  "progress",
  "pause",
  "stop",
  "repair-request",
  "verified",
  "received",
])

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function hasValidRevision(message: Record<string, unknown>): boolean {
  return (
    message.revision === undefined ||
    (typeof message.revision === "string" && message.revision.length > 0 && message.revision.length <= 128)
  )
}

export function parseP2PDataMessage(raw: string, source: P2PDataMessageSource): DataMessage {
  const message = parseP2PControlObject(raw)
  const type = message.type as DataMessage["type"]
  const allowedTypes = source === "sender" ? senderDataMessageTypes : receiverDataMessageTypes
  if (!allowedTypes.has(type)) throw new Error(`Unexpected P2P ${source} message type.`)
  if (!hasValidRevision(message)) throw new Error("Invalid P2P message revision.")

  switch (type) {
    case "meta":
    case "file-update":
      if (!isP2PFileMeta(message.meta)) throw new Error("Invalid P2P file metadata.")
      break
    case "download":
      if (!isSafeNonNegativeInteger(message.offset)) throw new Error("Invalid P2P download offset.")
      break
    case "progress":
      if (!isSafeNonNegativeInteger(message.doneBytes)) throw new Error("Invalid P2P progress.")
      break
    case "verification-start":
      if (message.blockSize !== verificationBlockSize || !isSafeNonNegativeInteger(message.hashCount)) {
        throw new Error("Invalid P2P verification manifest header.")
      }
      break
    case "verification-chunk":
      if (
        !isSafeNonNegativeInteger(message.startIndex) ||
        !Array.isArray(message.hashes) ||
        message.hashes.length === 0 ||
        !message.hashes.every((hash) => typeof hash === "string" && /^[a-f0-9]{40}$/i.test(hash))
      ) {
        throw new Error("Invalid P2P verification manifest chunk.")
      }
      break
    case "done":
      if (message.verification !== undefined) {
        if (typeof message.verification !== "object" || message.verification === null) {
          throw new Error("Invalid P2P verification manifest.")
        }
        const verification = message.verification as Partial<P2PVerificationManifest>
        if (
          verification.blockSize !== verificationBlockSize ||
          !Array.isArray(verification.hashes) ||
          !verification.hashes.every((hash) => typeof hash === "string" && /^[a-f0-9]{40}$/i.test(hash))
        ) {
          throw new Error("Invalid P2P verification manifest.")
        }
      }
      break
    case "repair-request":
      if (!Array.isArray(message.indices) || !message.indices.every(isSafeNonNegativeInteger)) {
        throw new Error("Invalid P2P repair request.")
      }
      break
    case "repair-start":
      if (!isSafeNonNegativeInteger(message.index) || !isSafeNonNegativeInteger(message.size)) {
        throw new Error("Invalid P2P repair block.")
      }
      break
    case "repair-end":
      if (!isSafeNonNegativeInteger(message.index)) throw new Error("Invalid P2P repair block index.")
      break
    case "error":
      if (typeof message.message !== "string" || message.message.length > maxP2PMessageTextLength) {
        throw new Error("Invalid P2P error message.")
      }
      break
  }

  return message as unknown as DataMessage
}
