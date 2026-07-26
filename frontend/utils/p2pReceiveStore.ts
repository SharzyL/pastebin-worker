import { isP2PFileMeta, verificationBlockSize, type P2PFileMeta } from "./p2pCommon.js"
import { isUuid } from "../../shared/verify.js"
import {
  acquireOPFSFileLease,
  clearQueuedOPFSFileDeletion,
  deleteOwnedOPFSFile,
  queueOPFSFileDeletion,
  type OPFSFileLease,
} from "./opfs.js"
import { acquireExclusiveWebLock, type WebLockLease } from "./webLock.js"

const checkpointSchemaVersion = 1
const sessionPeerSchemaVersion = 1
const checkpointKeyPrefix = "pastebin-worker:p2p-resume:"
const sessionPeerKeyPrefix = "pastebin-worker:p2p-peer:"
const checkpointMaxAgeMs = 24 * 60 * 60 * 1000
const sessionPeerMaxAgeMs = checkpointMaxAgeMs
export const p2pCheckpointIntervalBytes = 1024 * 1024
const persistentWriteBatchBytes = p2pCheckpointIntervalBytes

export interface P2PResumeCheckpoint {
  version: typeof checkpointSchemaVersion
  roomName: string
  peerId: string
  storageId?: string
  meta: P2PFileMeta
  receivedBytes: number
  completedHashes: string[]
  updatedAt: number
}

interface P2PSessionPeer {
  version: typeof sessionPeerSchemaVersion
  peerId: string
  updatedAt: number
}

interface WorkerResponse {
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

interface OpenResult {
  tail: ArrayBuffer
}

function checkpointKey(roomName: string): string {
  return `${checkpointKeyPrefix}${roomName}`
}

function sessionPeerKey(roomName: string): string {
  return `${sessionPeerKeyPrefix}${roomName}`
}

function isCheckpoint(value: unknown, roomName: string, now = Date.now()): value is P2PResumeCheckpoint {
  if (typeof value !== "object" || value === null) return false
  const checkpoint = value as Partial<P2PResumeCheckpoint>
  return (
    checkpoint.version === checkpointSchemaVersion &&
    checkpoint.roomName === roomName &&
    isUuid(checkpoint.peerId) &&
    (checkpoint.storageId === undefined || isUuid(checkpoint.storageId)) &&
    isP2PFileMeta(checkpoint.meta) &&
    typeof checkpoint.receivedBytes === "number" &&
    Number.isSafeInteger(checkpoint.receivedBytes) &&
    checkpoint.receivedBytes > 0 &&
    checkpoint.receivedBytes < checkpoint.meta.size &&
    Array.isArray(checkpoint.completedHashes) &&
    checkpoint.completedHashes.every((hash) => typeof hash === "string" && /^[a-f0-9]{40}$/i.test(hash)) &&
    checkpoint.completedHashes.length * verificationBlockSize <= checkpoint.receivedBytes &&
    (!checkpoint.meta.verifyTransfer ||
      checkpoint.receivedBytes - checkpoint.completedHashes.length * verificationBlockSize < verificationBlockSize) &&
    (checkpoint.meta.verifyTransfer || checkpoint.completedHashes.length === 0) &&
    typeof checkpoint.updatedAt === "number" &&
    Number.isFinite(checkpoint.updatedAt) &&
    checkpoint.updatedAt > now - checkpointMaxAgeMs &&
    checkpoint.updatedAt <= now + 60_000
  )
}

function isSessionPeer(value: unknown, now = Date.now()): value is P2PSessionPeer {
  if (typeof value !== "object" || value === null) return false
  const peer = value as Partial<P2PSessionPeer>
  return (
    peer.version === sessionPeerSchemaVersion &&
    isUuid(peer.peerId) &&
    typeof peer.updatedAt === "number" &&
    Number.isFinite(peer.updatedAt) &&
    peer.updatedAt > now - sessionPeerMaxAgeMs &&
    peer.updatedAt <= now + 60_000
  )
}

function readSessionPeerValue(raw: string, now = Date.now()): P2PSessionPeer | undefined {
  // Migrate the UUID-only format written by versions before session peer expiry
  // was introduced.
  if (isUuid(raw)) return { version: sessionPeerSchemaVersion, peerId: raw, updatedAt: now }
  try {
    const value: unknown = JSON.parse(raw)
    return isSessionPeer(value, now) ? value : undefined
  } catch {
    return undefined
  }
}

export function readP2PSessionPeerId(roomName: string): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined
  try {
    const key = sessionPeerKey(roomName)
    const raw = sessionStorage.getItem(key)
    if (raw === null) return undefined
    const peer = readSessionPeerValue(raw)
    if (peer) {
      if (raw === peer.peerId) sessionStorage.setItem(key, JSON.stringify(peer))
      return peer.peerId
    }
    sessionStorage.removeItem(key)
  } catch {
    // Session storage may be disabled.
  }
  return undefined
}

export function writeP2PSessionPeerId(roomName: string, peerId: string): boolean {
  if (typeof sessionStorage === "undefined" || !isUuid(peerId)) return false
  try {
    const peer: P2PSessionPeer = {
      version: sessionPeerSchemaVersion,
      peerId,
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(sessionPeerKey(roomName), JSON.stringify(peer))
    return true
  } catch {
    return false
  }
}

export function cleanupStaleP2PSessionPeers(now = Date.now()): number {
  if (typeof sessionStorage === "undefined") return 0
  let removed = 0
  try {
    const keys: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(sessionPeerKeyPrefix)) keys.push(key)
    }
    for (const key of keys) {
      const roomName = key.slice(sessionPeerKeyPrefix.length)
      const raw = sessionStorage.getItem(key)
      const peer = raw === null ? undefined : readSessionPeerValue(raw, now)
      if (roomName && peer) {
        if (raw === peer.peerId) sessionStorage.setItem(key, JSON.stringify(peer))
        continue
      }
      sessionStorage.removeItem(key)
      removed += 1
    }
  } catch {
    // Storage may be disabled.
  }
  return removed
}

export function cleanupStaleP2PResumeCheckpoints(now = Date.now()): number {
  if (typeof localStorage === "undefined") return 0
  let removed = 0
  try {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(checkpointKeyPrefix)) keys.push(key)
    }
    for (const key of keys) {
      const roomName = key.slice(checkpointKeyPrefix.length)
      try {
        const raw = localStorage.getItem(key)
        const value: unknown = raw === null ? undefined : JSON.parse(raw)
        if (roomName && isCheckpoint(value, roomName, now)) continue
      } catch {
        // Invalid and obsolete checkpoints are removed below.
      }
      localStorage.removeItem(key)
      removed += 1
    }
  } catch {
    // Storage may be disabled.
  }
  return removed
}

export function readP2PResumeCheckpoint(roomName: string): P2PResumeCheckpoint | undefined {
  if (typeof localStorage === "undefined") return undefined
  try {
    const raw = localStorage.getItem(checkpointKey(roomName))
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (isCheckpoint(value, roomName)) return value
    localStorage.removeItem(checkpointKey(roomName))
  } catch {
    // Storage may be disabled or contain an obsolete checkpoint.
  }
  return undefined
}

export function writeP2PResumeCheckpoint(checkpoint: P2PResumeCheckpoint): boolean {
  writeP2PSessionPeerId(checkpoint.roomName, checkpoint.peerId)
  if (typeof localStorage === "undefined") return false
  try {
    localStorage.setItem(checkpointKey(checkpoint.roomName), JSON.stringify(checkpoint))
    return true
  } catch {
    return false
  }
}

export function removeP2PResumeCheckpoint(roomName: string): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(checkpointKey(roomName))
  } catch {
    // Storage may be disabled.
  }
}

export function p2pResumeMetaMatches(left: P2PFileMeta, right: P2PFileMeta): boolean {
  return (
    left.revision === right.revision &&
    left.name === right.name &&
    left.size === right.size &&
    left.type === right.type &&
    left.lastModified === right.lastModified &&
    left.verifyTransfer === right.verifyTransfer
  )
}

export class P2PPersistentReceiveStore {
  private readonly worker: Worker
  private nextRequestId = 1
  private readonly requests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()
  private closed = false
  private closeError: Error | undefined
  private pendingWritePosition: number | undefined
  private pendingWriteParts: ArrayBuffer[] = []
  private pendingWriteBytes = 0
  private fileRemoved = false
  private fileLease: OPFSFileLease | undefined

  constructor(private readonly storageId: string) {
    this.worker = new Worker(new URL("./p2pStorage.worker.ts", import.meta.url), {
      type: "module",
      name: "p2p-receive-store",
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const request = this.requests.get(response.id)
      if (!request) return
      this.requests.delete(response.id)
      if (response.ok) request.resolve(response.value)
      else request.reject(new Error(response.error || "P2P storage worker failed."))
    }
    this.worker.onerror = () => this.failWorker(new Error("P2P storage worker failed."))
    this.worker.onmessageerror = () => this.failWorker(new Error("P2P storage worker returned an invalid message."))
  }

  static supported(): boolean {
    return (
      typeof Worker !== "undefined" &&
      typeof navigator !== "undefined" &&
      typeof (navigator.storage as (StorageManager & { getDirectory?: unknown }) | undefined)?.getDirectory ===
        "function"
    )
  }

  async open(checkpointBytes: number, tailOffset: number): Promise<OpenResult> {
    const leaseRequest = acquireOPFSFileLease(this.filename())
    const lease = leaseRequest ? await leaseRequest : undefined
    if (lease === null) throw new Error("The saved P2P temporary file is already in use.")
    this.fileLease = lease
    try {
      return (await this.request("open", { peerId: this.storageId, checkpointBytes, tailOffset })) as OpenResult
    } catch (error) {
      this.releaseFileLease()
      throw error
    }
  }

  async write(position: number, data: ArrayBuffer): Promise<void> {
    if (this.pendingWritePosition === undefined) this.pendingWritePosition = position
    const expectedPosition = this.pendingWritePosition + this.pendingWriteBytes
    if (position !== expectedPosition) {
      await this.flushPendingWrite()
      this.pendingWritePosition = position
    }
    this.pendingWriteParts.push(data)
    this.pendingWriteBytes += data.byteLength
    if (this.pendingWriteBytes >= persistentWriteBatchBytes) await this.flushPendingWrite()
  }

  async replace(position: number, parts: ArrayBuffer[]): Promise<void> {
    await this.flushPendingWrite()
    await this.request("write", { position, parts }, parts)
  }

  async flush(): Promise<void> {
    await this.flushPendingWrite()
    await this.request("flush")
  }

  async file(meta: P2PFileMeta): Promise<File> {
    await this.closeHandle()
    try {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle(this.filename())
      const file = await handle.getFile()
      // OPFS-backed File objects are lazy in Chromium. Removing their entry here can
      // make a later preview or object-URL download fail with NotFoundError.
      return new File([file], meta.name, { type: meta.type, lastModified: meta.lastModified })
    } finally {
      this.terminate()
    }
  }

  async preserve(): Promise<void> {
    try {
      await this.closeHandle()
    } finally {
      this.terminate()
      this.releaseFileLease()
    }
  }

  queueDeletion(): void {
    queueOPFSFileDeletion(this.filename())
  }

  async discard(): Promise<void> {
    this.queueDeletion()
    this.clearPendingWrite()
    if (this.closed) {
      try {
        const root = await navigator.storage.getDirectory()
        await this.removeStoredFile(root)
      } finally {
        this.terminate()
        this.releaseFileLease()
      }
      return
    }
    try {
      await this.request("discard")
      this.fileRemoved = true
      clearQueuedOPFSFileDeletion(this.filename())
    } finally {
      this.terminate()
      this.releaseFileLease()
    }
  }

  private filename(): string {
    return `p2p-${this.storageId}.tmp`
  }

  private releaseFileLease(): void {
    this.fileLease?.release()
    this.fileLease = undefined
  }

  private async removeStoredFile(root: FileSystemDirectoryHandle): Promise<void> {
    if (this.fileRemoved) return
    this.fileRemoved = await deleteOwnedOPFSFile(root, this.filename())
  }

  private async closeHandle(): Promise<void> {
    if (this.closed) return
    await this.flushPendingWrite()
    await this.request("close")
    this.closed = true
  }

  private async flushPendingWrite(): Promise<void> {
    if (this.pendingWriteBytes === 0 || this.pendingWritePosition === undefined) return
    const position = this.pendingWritePosition
    const parts = this.pendingWriteParts
    this.clearPendingWrite()
    await this.request("write", { position, parts }, parts)
  }

  private clearPendingWrite(): void {
    this.pendingWritePosition = undefined
    this.pendingWriteParts = []
    this.pendingWriteBytes = 0
  }

  private request(
    type: string,
    payload: Record<string, unknown> = {},
    transfer: Transferable[] = [],
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closeError ?? new Error("P2P storage worker is closed."))
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject })
      try {
        this.worker.postMessage({ id, type, ...payload }, transfer)
      } catch (error) {
        this.requests.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private failPending(error: Error): void {
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
  }

  private failWorker(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.closeError = error
    this.clearPendingWrite()
    this.worker.terminate()
    this.failPending(error)
  }

  private terminate(): void {
    this.closed = true
    this.clearPendingWrite()
    this.worker.terminate()
    this.failPending(new Error("P2P storage worker closed."))
  }
}

export function acquireP2PReceiverRoomLock(roomName: string): Promise<WebLockLease | null> | undefined {
  return acquireExclusiveWebLock(`pastebin-worker:p2p-receiver-room:${roomName}`)
}
