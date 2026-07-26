import type { P2PIceServer } from "./interfaces.js"

const MAX_SIGNAL_MESSAGE_LENGTH = 256 * 1024
const MAX_SDP_LENGTH = 192 * 1024
const MAX_CANDIDATE_LENGTH = 16 * 1024
const MAX_PEER_ID_LENGTH = 128
const MAX_SHORT_TEXT_LENGTH = 512

export type P2PRole = "sender" | "receiver"

export interface P2PSessionDescription {
  type: "offer" | "answer" | "pranswer" | "rollback"
  sdp?: string
}

export interface P2PIceCandidate {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export interface P2PSignalingPeer {
  peerId: string
  userAgent?: string
  connectionId?: string
}

export type P2PSignalMessage =
  | {
      type: "ready"
      role: P2PRole
      peerId?: string
      iceServers?: P2PIceServer[]
      peers: { sender: boolean; receivers: P2PSignalingPeer[] }
    }
  | {
      type: "peer-joined"
      role: P2PRole
      peerId?: string
      userAgent?: string
      connectionId?: string
      iceServers?: P2PIceServer[]
    }
  | { type: "peer-left"; role: P2PRole; peerId?: string; resumable?: boolean }
  | { type: "offer"; peerId: string; sdp: P2PSessionDescription; negotiationId?: string }
  | { type: "answer"; peerId: string; sdp: P2PSessionDescription; negotiationId?: string }
  | { type: "candidate"; peerId: string; candidate: P2PIceCandidate; negotiationId?: string }
  | { type: "receiver-paired"; peerId: string }
  | { type: "receiver-pair-result"; peerId: string; accepted: boolean }
  | { type: "receiver-limit-reached" }
  | { type: "transfer-complete"; peerId: string }
  | { type: "transfer-limit-complete" }
  | { type: "transfer-checkpoint" }
  | { type: "transfer-checkpoint-clear" }
  | { type: "transfer-checkpoint-result"; accepted: boolean }
  | { type: "transfer-abandon" }
  | { type: "transfer-abandoned" }
  | { type: "sender-leave" }
  | { type: "peer-reconnect-request"; peerId?: string; retryToken?: string }
  | { type: "peer-reconnect-failed"; peerId: string; retryToken: string }
  | {
      type: "peer-signaling-disconnected"
      role: P2PRole
      peerId?: string
      connectionId?: string
    }
  | { type: "room-options-updated"; expireAt: string; maxTransfers: number; joinable: boolean }
  | { type: "ping" }
  | { type: "pong" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxLength = MAX_SHORT_TEXT_LENGTH, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= maxLength
}

function isOptionalBoundedString(value: unknown, maxLength = MAX_SHORT_TEXT_LENGTH): value is string | undefined {
  return value === undefined || isBoundedString(value, maxLength)
}

function isRole(value: unknown): value is P2PRole {
  return value === "sender" || value === "receiver"
}

export function isP2PIceServer(value: unknown): value is P2PIceServer {
  if (!isRecord(value)) return false
  const urls = value.urls
  return (
    (isBoundedString(urls, 2048) ||
      (Array.isArray(urls) && urls.length > 0 && urls.every((url) => isBoundedString(url, 2048)))) &&
    isOptionalBoundedString(value.username, 512) &&
    isOptionalBoundedString(value.credential, 1024) &&
    (value.credentialType === undefined || value.credentialType === "password" || value.credentialType === "oauth")
  )
}

export function isP2PSessionDescription(value: unknown): value is P2PSessionDescription {
  if (!isRecord(value)) return false
  return (
    (value.type === "offer" || value.type === "answer" || value.type === "pranswer" || value.type === "rollback") &&
    (value.sdp === undefined || isBoundedString(value.sdp, MAX_SDP_LENGTH, true))
  )
}

export function isP2PIceCandidate(value: unknown): value is P2PIceCandidate {
  if (!isRecord(value)) return false
  return (
    (value.candidate === undefined || isBoundedString(value.candidate, MAX_CANDIDATE_LENGTH, true)) &&
    (value.sdpMid === undefined || value.sdpMid === null || isBoundedString(value.sdpMid, 256)) &&
    (value.sdpMLineIndex === undefined ||
      value.sdpMLineIndex === null ||
      (Number.isSafeInteger(value.sdpMLineIndex) && (value.sdpMLineIndex as number) >= 0)) &&
    (value.usernameFragment === undefined ||
      value.usernameFragment === null ||
      isBoundedString(value.usernameFragment, 256))
  )
}

function isPeer(value: unknown): value is P2PSignalingPeer {
  return (
    isRecord(value) &&
    isBoundedString(value.peerId, MAX_PEER_ID_LENGTH) &&
    isOptionalBoundedString(value.userAgent, MAX_SHORT_TEXT_LENGTH) &&
    isOptionalBoundedString(value.connectionId, MAX_PEER_ID_LENGTH)
  )
}

export function isP2PSignalMessage(value: unknown): value is P2PSignalMessage {
  if (!isRecord(value) || !isBoundedString(value.type, 64)) return false
  const hasOptionalPeerId = isOptionalBoundedString(value.peerId, MAX_PEER_ID_LENGTH)
  const hasOptionalNegotiationId = isOptionalBoundedString(value.negotiationId, MAX_PEER_ID_LENGTH)

  switch (value.type) {
    case "ready":
      return (
        isRole(value.role) &&
        hasOptionalPeerId &&
        isRecord(value.peers) &&
        typeof value.peers.sender === "boolean" &&
        Array.isArray(value.peers.receivers) &&
        value.peers.receivers.every(isPeer) &&
        (value.iceServers === undefined || (Array.isArray(value.iceServers) && value.iceServers.every(isP2PIceServer)))
      )
    case "peer-joined":
      return (
        isRole(value.role) &&
        hasOptionalPeerId &&
        isOptionalBoundedString(value.userAgent, MAX_SHORT_TEXT_LENGTH) &&
        isOptionalBoundedString(value.connectionId, MAX_PEER_ID_LENGTH) &&
        (value.iceServers === undefined || (Array.isArray(value.iceServers) && value.iceServers.every(isP2PIceServer)))
      )
    case "peer-left":
      return (
        isRole(value.role) &&
        hasOptionalPeerId &&
        (value.resumable === undefined || typeof value.resumable === "boolean")
      )
    case "offer":
    case "answer":
      return (
        isBoundedString(value.peerId, MAX_PEER_ID_LENGTH) &&
        hasOptionalNegotiationId &&
        isP2PSessionDescription(value.sdp)
      )
    case "candidate":
      return (
        isBoundedString(value.peerId, MAX_PEER_ID_LENGTH) &&
        hasOptionalNegotiationId &&
        isP2PIceCandidate(value.candidate)
      )
    case "receiver-paired":
    case "transfer-complete":
      return isBoundedString(value.peerId, MAX_PEER_ID_LENGTH)
    case "receiver-pair-result":
      return isBoundedString(value.peerId, MAX_PEER_ID_LENGTH) && typeof value.accepted === "boolean"
    case "peer-reconnect-request":
      return hasOptionalPeerId && isOptionalBoundedString(value.retryToken, MAX_PEER_ID_LENGTH)
    case "peer-reconnect-failed":
      return isBoundedString(value.peerId, MAX_PEER_ID_LENGTH) && isBoundedString(value.retryToken, MAX_PEER_ID_LENGTH)
    case "peer-signaling-disconnected":
      return isRole(value.role) && hasOptionalPeerId && isOptionalBoundedString(value.connectionId, MAX_PEER_ID_LENGTH)
    case "room-options-updated":
      return (
        isBoundedString(value.expireAt, 64) &&
        Number.isSafeInteger(value.maxTransfers) &&
        (value.maxTransfers as number) >= 0 &&
        typeof value.joinable === "boolean"
      )
    case "transfer-checkpoint-result":
      return typeof value.accepted === "boolean"
    case "receiver-limit-reached":
    case "transfer-limit-complete":
    case "transfer-checkpoint":
    case "transfer-checkpoint-clear":
    case "transfer-abandon":
    case "transfer-abandoned":
    case "sender-leave":
    case "ping":
    case "pong":
      return true
    default:
      return false
  }
}

export function parseP2PSignalMessage(raw: unknown): P2PSignalMessage | null {
  if (typeof raw !== "string") return null
  if (raw.length > MAX_SIGNAL_MESSAGE_LENGTH) throw new Error("P2P signaling message is too large.")

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("Invalid P2P signaling message JSON.")
  }
  if (!isP2PSignalMessage(value)) throw new Error("Invalid P2P signaling message.")
  return value
}
