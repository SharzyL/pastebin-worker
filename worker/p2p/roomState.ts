import { isUuid } from "../../shared/verify.js"
import type { P2PIceServer } from "../../shared/interfaces.js"

export const ROOM_TTL_MS = 60 * 60 * 1000
export const CREATED_AT_KEY = "createdAt"
export const EXPIRES_AT_KEY = "expiresAt"
export const ICE_SERVERS_KEY = "iceServers"
export const ICE_SERVERS_EXPIRES_AT_KEY = "iceServersExpiresAt"
export const MAX_TRANSFERS_KEY = "maxTransfers"
export const PAIRED_RECEIVER_IDS_KEY = "pairedReceiverIds"
export const RESUMABLE_RECEIVER_IDS_KEY = "resumableReceiverIds"
export const SUCCESSFUL_RECEIVER_IDS_KEY = "successfulReceiverIds"
export const SENDER_TOKEN_KEY = "senderToken"
export const RECEIVER_CLEANUP_AT_KEY = "receiverCleanupAt"

export interface P2PRoomStatus {
  active: boolean
  joinable: boolean
  hasSender: boolean
  hasReceiver: boolean
}

export interface P2PRoomInit {
  iceServers?: P2PIceServer[]
  iceServersExpiresAt?: number
  senderToken?: string
  expiresAt?: number
  maxTransfers?: number
}

export interface P2PRoomUpdate {
  senderToken: string
  expiresAt: number
  expirationSeconds: number
  maxTransfers: number
}

export function storedStringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
}

export function storedReceiverDeadlines(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => isUuid(entry[0]) && Number.isFinite(entry[1])),
  )
}

export function storedRoomExpiresAt(stored: Map<string, unknown>): number {
  const expiresAt = stored.get(EXPIRES_AT_KEY)
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) return expiresAt
  const createdAt = stored.get(CREATED_AT_KEY)
  return (typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0) + ROOM_TTL_MS
}

export function canAddReceiverFromStorage(stored: Map<string, unknown>, peerId?: string): boolean {
  const successfulReceiverIds = storedStringIds(stored.get(SUCCESSFUL_RECEIVER_IDS_KEY))
  if (peerId && successfulReceiverIds.includes(peerId)) return false
  const pairedReceiverIds = storedStringIds(stored.get(PAIRED_RECEIVER_IDS_KEY))
  if (peerId && pairedReceiverIds.includes(peerId)) {
    return storedStringIds(stored.get(RESUMABLE_RECEIVER_IDS_KEY)).includes(peerId)
  }
  const maxTransfersValue = stored.get(MAX_TRANSFERS_KEY)
  const maxTransfers = typeof maxTransfersValue === "number" ? maxTransfersValue : 0
  return maxTransfers === 0 || pairedReceiverIds.length < maxTransfers
}

export interface P2PRoomMembership {
  maxTransfers: number
  pairedReceiverIds: string[]
  resumableReceiverIds: string[]
  successfulReceiverIds: string[]
}

type P2PRoomMembershipChanges = Partial<
  Pick<P2PRoomMembership, "pairedReceiverIds" | "resumableReceiverIds" | "successfulReceiverIds">
>

export class P2PRoomMembershipStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async load(): Promise<P2PRoomMembership> {
    const stored = await this.storage.get([
      MAX_TRANSFERS_KEY,
      PAIRED_RECEIVER_IDS_KEY,
      RESUMABLE_RECEIVER_IDS_KEY,
      SUCCESSFUL_RECEIVER_IDS_KEY,
    ])
    const maxTransfersValue = stored.get(MAX_TRANSFERS_KEY)
    return {
      maxTransfers: typeof maxTransfersValue === "number" ? maxTransfersValue : 0,
      pairedReceiverIds: storedStringIds(stored.get(PAIRED_RECEIVER_IDS_KEY)),
      resumableReceiverIds: storedStringIds(stored.get(RESUMABLE_RECEIVER_IDS_KEY)),
      successfulReceiverIds: storedStringIds(stored.get(SUCCESSFUL_RECEIVER_IDS_KEY)),
    }
  }

  async save(changes: P2PRoomMembershipChanges): Promise<void> {
    const entries: Record<string, string[]> = {}
    if (changes.pairedReceiverIds !== undefined) {
      entries[PAIRED_RECEIVER_IDS_KEY] = changes.pairedReceiverIds
    }
    if (changes.resumableReceiverIds !== undefined) {
      entries[RESUMABLE_RECEIVER_IDS_KEY] = changes.resumableReceiverIds
    }
    if (changes.successfulReceiverIds !== undefined) {
      entries[SUCCESSFUL_RECEIVER_IDS_KEY] = changes.successfulReceiverIds
    }
    if (Object.keys(entries).length > 0) await this.storage.put(entries)
  }
}
