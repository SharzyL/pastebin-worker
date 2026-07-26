import type { P2PIceServer, PublicEnv } from "../../shared/interfaces.js"
import {
  OPFS_LARGE_FILE_THRESHOLD_BYTES,
  OPFS_REQUIRED_SPACE_MULTIPLIER,
  P2P_RECEIVER_SIGNAL_RECONNECT_WINDOW_MS,
  P2P_RTC_DISCONNECT_GRACE_MS,
} from "../../shared/constants.js"
import {
  P2PWakeLock,
  P2PIceCandidateBuffer,
  appendHashData,
  closeP2PConnection,
  createSpeedTracker,
  finishHashData,
  maxVerificationRepairAttempts,
  measureSpeed,
  createP2PSignalingTransport,
  progressUpdateIntervalMs,
  parseP2PDataMessage,
  probeP2PRoomAvailability,
  rtcConfig,
  selectedP2PConnectionRoute,
  sendData,
  sha1Hex,
  sliceArrayBuffer,
  uuid,
  verificationBlockByteLength,
  verificationBlockSize,
  verificationBlocksByteLength,
  verificationHashIndices,
  wsUrl,
  type BlockHashState,
  type P2PFileMeta,
  type P2PProgress,
  type P2PReceiverCallbacks,
  type P2PReceiverSession,
  type P2PVerificationManifest,
  type P2PSignalingTransport,
  type SignalMessage,
} from "./p2pCommon.js"
import {
  P2PPersistentReceiveStore,
  acquireP2PReceiverRoomLock,
  cleanupStaleP2PResumeCheckpoints,
  cleanupStaleP2PSessionPeers,
  p2pCheckpointIntervalBytes,
  p2pResumeMetaMatches,
  readP2PResumeCheckpoint,
  readP2PSessionPeerId,
  removeP2PResumeCheckpoint,
  writeP2PSessionPeerId,
  writeP2PResumeCheckpoint,
  type P2PResumeCheckpoint,
} from "./p2pReceiveStore.js"
import {
  acquireOPFSFileLease,
  cleanupOPFSTemporaryFilesOnce,
  deleteOwnedOPFSFile,
  queueOPFSFileDeletion,
  type OPFSFileLease,
} from "./opfs.js"
import type { WebLockLease } from "./webLock.js"

// Memory fallback is intentionally bounded; larger transfers require OPFS.
const MAX_MEMORY_P2P_BYTES = 1024 * 1024 * 1024
const maxIncompleteTransferRetries = 3

type OPFSStorageManager = StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> }

interface RepairBlockState {
  index: number
  size: number
  bytes: number
  parts: ArrayBuffer[]
}

interface VerificationManifestAssembly {
  blockSize: number
  hashCount: number
  hashes: string[]
}

type ReceiverTransferState =
  | { kind: "idle" }
  | { kind: "downloading" }
  | { kind: "pausing" }
  | { kind: "paused" }
  | { kind: "stopping"; restartAfterStop: boolean }
  | { kind: "verifying" }
  | { kind: "repairing" }
  | { kind: "complete" }

interface OPFSReceivedFile {
  root: FileSystemDirectoryHandle
  filename: string
  handle: FileSystemFileHandle
  writable?: FileSystemWritableFileStream
  writePosition: number
  pendingParts: ArrayBuffer[]
  pendingBytes: number
  lease?: OPFSFileLease
}

interface ReceivedStore {
  readonly kind: "memory" | "opfs" | "persistent"
  append(position: number, chunk: ArrayBuffer): Promise<void>
  replaceBlock(index: number, parts: ArrayBuffer[]): Promise<void>
  checkpoint(): Promise<void>
  file(meta: P2PFileMeta): Promise<File>
  preserve(): Promise<void>
  queueDeletion(): void
  discard(): Promise<void>
}

export function startP2PReceiver(name: string, config: PublicEnv, callbacks: P2PReceiverCallbacks): P2PReceiverSession {
  cleanupStaleP2PResumeCheckpoints()
  cleanupStaleP2PSessionPeers()
  let resumeCheckpoint: P2PResumeCheckpoint | undefined = readP2PResumeCheckpoint(name)
  const peerId = resumeCheckpoint?.peerId ?? readP2PSessionPeerId(name) ?? uuid()
  writeP2PSessionPeerId(name, peerId)
  let receiveStorageId = resumeCheckpoint?.storageId ?? (resumeCheckpoint ? peerId : uuid())
  const wakeLock = new P2PWakeLock(callbacks.onStatus)
  const storageManager =
    typeof navigator === "undefined" ? undefined : (navigator.storage as OPFSStorageManager | undefined)
  const opfsRootPromise =
    typeof storageManager?.getDirectory === "function"
      ? Promise.resolve(storageManager.getDirectory()).catch(() => undefined)
      : Promise.resolve(undefined)
  void opfsRootPromise.then((root) => (root ? cleanupOPFSTemporaryFilesOnce(root) : 0))
  let pc: RTCPeerConnection | undefined
  let dc: RTCDataChannel | undefined
  let iceServers: P2PIceServer[] | undefined
  let meta: P2PFileMeta | undefined
  let pendingUpdateMeta: P2PFileMeta | undefined
  let blocks: ArrayBuffer[][] = []
  let receivedBytes = 0
  let transferState: ReceiverTransferState = { kind: "idle" }
  let senderLeft = false
  let isClosed = false
  let closeCleanupStarted = false
  let downloadRequestedChannel: RTCDataChannel | undefined
  let speedTracker = createSpeedTracker(0)
  const iceCandidates = new P2PIceCandidateBuffer()
  let negotiationId: string | undefined
  let lastProgressAt = 0
  let verificationManifest: P2PVerificationManifest | undefined
  let verificationManifestAssembly: VerificationManifestAssembly | undefined
  let pendingRepairIndices = new Set<number>()
  let repairVerificationIndices = new Set<number>()
  let repairBlock: RepairBlockState | undefined
  let repairAttempts = 0
  let incompleteTransferRetries = 0
  let hashState: BlockHashState | undefined
  let dataMessageQueue = Promise.resolve()
  let dataChannelGeneration = 0
  let receivedStore: ReceivedStore | undefined
  const completedReceivedStores: ReceivedStore[] = []
  let lastCheckpointBytes = resumeCheckpoint?.receivedBytes ?? 0
  let receivedStorageQueue: Promise<void> = Promise.resolve()
  let forceMemoryStorage = false
  let roomLock: WebLockLease | undefined
  let ownsRoomSession = false
  let rtcRecoveryTimer: ReturnType<typeof setTimeout> | undefined
  let recoveryRequestSent = false
  let recoveryRetryToken: string | undefined
  let isRecoveringConnection = false
  let isSignalingReady = false
  let senderSignalingAvailable = false
  let pendingCheckpointClear = false
  let checkpointRegistration: "unregistered" | "pending" | "registered" = "unregistered"
  let roomAvailabilityProbe: Promise<void> | undefined
  let stoppedTransferCleanup: Promise<void> | undefined

  const releaseRoomLock = () => {
    roomLock?.release()
    roomLock = undefined
  }

  const rotatePeerIdForNextSession = () => {
    writeP2PSessionPeerId(name, uuid())
  }

  const isComplete = () => transferState.kind === "complete"
  const isDiscarding = () => transferState.kind === "stopping"
  const wantsDownload = () => transferState.kind === "downloading"
  const isPaused = () => transferState.kind === "paused"
  const isPausePending = () => transferState.kind === "pausing"
  const restartAfterStop = () => transferState.kind === "stopping" && transferState.restartAfterStop
  const transitionTransfer = (next: ReceiverTransferState) => {
    transferState = next
  }

  const clearPauseState = () => {
    if (isPaused() || isPausePending()) transitionTransfer({ kind: "idle" })
    callbacks.onPausedChange(false)
    callbacks.onPausePendingChange?.(false)
  }

  const confirmPause = () => {
    if (!isPausePending() || isComplete() || isDiscarding()) return
    transitionTransfer({ kind: "paused" })
    callbacks.onPausePendingChange?.(false)
    callbacks.onPausedChange(true)
    callbacks.onStatus("Paused.")
    if (meta) {
      callbacks.onProgress({ doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 })
      if (dc?.readyState === "open") {
        sendData(dc, { type: "progress", doneBytes: receivedBytes, revision: meta.revision })
      }
      void enqueueReceivedStorage(() => checkpointReceivedData(true)).catch(callbacks.onError)
    }
    void wakeLock.stop()
  }

  const sendReceiverSignal = (message: SignalMessage) => {
    return signalingTransport.send(message)
  }

  const registerCheckpoint = () => {
    if (!resumeCheckpoint || checkpointRegistration !== "unregistered") return
    if (sendReceiverSignal({ type: "transfer-checkpoint" })) checkpointRegistration = "pending"
  }

  const isPeerTransportUsable = () =>
    dc?.readyState === "open" &&
    pc?.connectionState !== "closed" &&
    pc?.connectionState !== "failed" &&
    pc?.connectionState !== "disconnected"

  const setConnectionRecovering = (recovering: boolean) => {
    if (isRecoveringConnection === recovering) return
    isRecoveringConnection = recovering
    callbacks.onReconnectingChange?.(recovering)
  }

  const cancelRTCRecoveryTimer = () => {
    if (rtcRecoveryTimer === undefined) return
    clearTimeout(rtcRecoveryTimer)
    rtcRecoveryTimer = undefined
  }

  const finishConnectionRecovery = () => {
    cancelRTCRecoveryTimer()
    recoveryRequestSent = false
    recoveryRetryToken = undefined
    setConnectionRecovering(false)
  }

  const requestPeerRecovery = (immediate = false) => {
    if (isClosed || isComplete()) return
    setConnectionRecovering(true)
    callbacks.onStatus(
      isDiscarding()
        ? restartAfterStop()
          ? "Connection interrupted while switching files. Reconnecting..."
          : "Connection interrupted while terminating. Reconnecting..."
        : isPaused()
          ? "Paused. Reconnecting to the sender..."
          : "Peer connection interrupted. Reconnecting...",
    )
    if (recoveryRequestSent) return
    if (rtcRecoveryTimer !== undefined) {
      if (!immediate) return
      cancelRTCRecoveryTimer()
    }
    rtcRecoveryTimer = setTimeout(
      () => {
        rtcRecoveryTimer = undefined
        if (!isSignalingReady || !senderSignalingAvailable) {
          recoveryRequestSent = false
          callbacks.onStatus(
            isPaused()
              ? "Paused. Waiting for signaling before reconnecting..."
              : "Peer connection interrupted. Waiting for signaling to reconnect...",
          )
          return
        }
        recoveryRequestSent = sendReceiverSignal({
          type: "peer-reconnect-request",
          ...(recoveryRetryToken ? { retryToken: recoveryRetryToken } : {}),
        })
      },
      immediate ? 0 : P2P_RTC_DISCONNECT_GRACE_MS,
    )
  }

  const clearReceivedData = () => {
    blocks = []
    receivedBytes = 0
    lastProgressAt = 0
    verificationManifest = undefined
    verificationManifestAssembly = undefined
    pendingRepairIndices = new Set<number>()
    repairVerificationIndices = new Set<number>()
    repairBlock = undefined
    repairAttempts = 0
    incompleteTransferRetries = 0
    hashState = undefined
  }

  const enqueueReceivedStorage = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = receivedStorageQueue.then(operation, operation)
    receivedStorageQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const createOPFSReceivedFile = async (fileMeta: P2PFileMeta): Promise<OPFSReceivedFile | undefined> => {
    if (fileMeta.size < OPFS_LARGE_FILE_THRESHOLD_BYTES) return undefined
    if (typeof storageManager?.getDirectory !== "function") return undefined

    const estimate = await storageManager.estimate().catch(() => undefined)
    if (estimate?.quota !== undefined) {
      const availableBytes = Math.max(0, estimate.quota - (estimate.usage ?? 0))
      if (availableBytes < fileMeta.size * OPFS_REQUIRED_SPACE_MULTIPLIER) return undefined
    }

    let root: FileSystemDirectoryHandle | undefined
    const filename = `p2p-${Date.now()}-${peerId}-${uuid()}.tmp`
    let lease: OPFSFileLease | undefined
    try {
      root = await opfsRootPromise
      if (!root) return undefined
      const leaseRequest = acquireOPFSFileLease(filename)
      const acquiredLease = leaseRequest ? await leaseRequest : undefined
      if (acquiredLease === null) return undefined
      lease = acquiredLease
      const handle = await root.getFileHandle(filename, { create: true })
      const writable = await handle.createWritable({ keepExistingData: false })
      return {
        root,
        filename,
        handle,
        writable,
        writePosition: 0,
        pendingParts: [],
        pendingBytes: 0,
        lease,
      }
    } catch {
      if (root) await root.removeEntry(filename).catch(() => undefined)
      lease?.release()
      return undefined
    }
  }

  const flushOPFSPendingParts = async (storage: OPFSReceivedFile) => {
    if (storage.pendingBytes === 0) return
    if (!storage.writable) throw new Error("P2P temporary file is no longer writable.")
    const parts = storage.pendingParts
    const byteLength = storage.pendingBytes
    storage.pendingParts = []
    storage.pendingBytes = 0
    try {
      await storage.writable.write({
        type: "write",
        position: storage.writePosition,
        data: new Blob(parts),
      })
      storage.writePosition += byteLength
    } catch (error) {
      storage.pendingParts = parts
      storage.pendingBytes = byteLength
      throw error
    }
  }

  const memoryReceivedStore = (): ReceivedStore => ({
    kind: "memory",
    append(position, chunk) {
      let chunkOffset = 0
      let writePosition = position
      while (chunkOffset < chunk.byteLength) {
        const blockIndex = Math.floor(writePosition / verificationBlockSize)
        const blockOffset = writePosition % verificationBlockSize
        const takeBytes = Math.min(verificationBlockSize - blockOffset, chunk.byteLength - chunkOffset)
        const part = sliceArrayBuffer(chunk, chunkOffset, chunkOffset + takeBytes)
        blocks[blockIndex] ??= []
        blocks[blockIndex].push(part)
        writePosition += part.byteLength
        chunkOffset += takeBytes
      }
      return Promise.resolve()
    },
    replaceBlock(index, parts) {
      blocks[index] = parts
      return Promise.resolve()
    },
    checkpoint: () => Promise.resolve(),
    file(fileMeta) {
      const file = new File(blocks.flat(), fileMeta.name, {
        type: fileMeta.type,
        lastModified: fileMeta.lastModified,
      })
      blocks = []
      return Promise.resolve(file)
    },
    preserve: () => Promise.resolve(),
    queueDeletion() {
      // Memory-backed files do not need persistent cleanup.
    },
    discard() {
      blocks = []
      return Promise.resolve()
    },
  })

  const opfsStore = (storage: OPFSReceivedFile): ReceivedStore => {
    let fileRemoved = false
    const removeStoredFile = async () => {
      if (fileRemoved) return
      fileRemoved = await deleteOwnedOPFSFile(storage.root, storage.filename)
    }
    const discard = async () => {
      try {
        if (storage.writable) {
          await storage.writable.abort().catch(() => undefined)
          storage.writable = undefined
        }
        storage.pendingParts = []
        storage.pendingBytes = 0
        await removeStoredFile()
      } finally {
        storage.lease?.release()
      }
    }
    return {
      kind: "opfs",
      async append(_position, chunk) {
        storage.pendingParts.push(chunk)
        storage.pendingBytes += chunk.byteLength
        if (storage.pendingBytes >= verificationBlockSize) await flushOPFSPendingParts(storage)
      },
      async replaceBlock(index, parts) {
        await flushOPFSPendingParts(storage)
        if (!storage.writable) throw new Error("P2P temporary file is no longer writable.")
        await storage.writable.write({
          type: "write",
          position: index * verificationBlockSize,
          data: new Blob(parts),
        })
      },
      async checkpoint() {
        await flushOPFSPendingParts(storage)
      },
      async file(fileMeta) {
        await flushOPFSPendingParts(storage)
        if (storage.writable) {
          await storage.writable.close()
          storage.writable = undefined
        }
        const storedFile = await storage.handle.getFile()
        const receivedFile = new File([storedFile], fileMeta.name, {
          type: fileMeta.type,
          lastModified: fileMeta.lastModified,
        })
        return receivedFile
      },
      preserve: discard,
      queueDeletion: () => queueOPFSFileDeletion(storage.filename),
      discard,
    }
  }

  const persistentStore = (storage: P2PPersistentReceiveStore): ReceivedStore => ({
    kind: "persistent",
    append: (position, chunk) => storage.write(position, chunk),
    replaceBlock: (index, parts) => storage.replace(index * verificationBlockSize, parts),
    checkpoint: () => storage.flush(),
    file: (fileMeta) => storage.file(fileMeta),
    preserve: () => storage.preserve(),
    queueDeletion: () => storage.queueDeletion(),
    discard: () => storage.discard(),
  })

  const initializeReceivedStorage = async () => {
    if (receivedStore || !meta) return
    if (!forceMemoryStorage && P2PPersistentReceiveStore.supported()) {
      const storage = new P2PPersistentReceiveStore(receiveStorageId)
      try {
        await storage.open(0, 0)
        receivedStore = persistentStore(storage)
        return
      } catch {
        await storage.discard().catch(() => undefined)
      }
    }
    const opfsFile = forceMemoryStorage ? undefined : await createOPFSReceivedFile(meta)
    if (!opfsFile && meta.size > MAX_MEMORY_P2P_BYTES) {
      throw new Error("This file is too large to receive without disk-backed browser storage.")
    }
    receivedStore = opfsFile ? opfsStore(opfsFile) : memoryReceivedStore()
  }

  const disposeReceivedStorage = async () => {
    const storage = receivedStore
    receivedStore = undefined
    resumeCheckpoint = undefined
    checkpointRegistration = "unregistered"
    lastCheckpointBytes = 0
    removeP2PResumeCheckpoint(name)
    await storage?.discard().catch(() => undefined)
    receiveStorageId = uuid()
  }

  const resetReceivedData = async () => {
    await enqueueReceivedStorage(async () => {
      const hadCheckpoint = resumeCheckpoint !== undefined || checkpointRegistration !== "unregistered"
      if (hadCheckpoint) {
        pendingCheckpointClear = !sendReceiverSignal({ type: "transfer-checkpoint-clear" })
      }
      await disposeReceivedStorage()
      clearReceivedData()
    })
  }

  const beginStoppedTransferCleanup = () => {
    stoppedTransferCleanup ??= resetReceivedData()
    return stoppedTransferCleanup
  }

  const prepareReceivedStorage = async () => {
    await enqueueReceivedStorage(async () => {
      if (receivedBytes === 0) clearReceivedData()
      await initializeReceivedStorage()
    })
  }

  const appendReceivedBlockData = async (chunk: ArrayBuffer) => {
    await enqueueReceivedStorage(async () => {
      await initializeReceivedStorage()
      if (!receivedStore) throw new Error("P2P receive storage is unavailable.")
      // Persistent storage transfers this buffer to its worker, which detaches it.
      // Capture the length first so the durable receive offset cannot move backwards.
      const chunkByteLength = chunk.byteLength
      if (hashState) await appendHashData(hashState, chunk)
      await receivedStore.append(receivedBytes, chunk)
      receivedBytes += chunkByteLength
      await checkpointReceivedData()
    })
  }

  const checkpointReceivedData = async (force = false) => {
    if (
      receivedStore?.kind !== "persistent" ||
      !meta ||
      receivedBytes <= 0 ||
      receivedBytes >= meta.size ||
      (!force && lastCheckpointBytes > 0 && receivedBytes - lastCheckpointBytes < p2pCheckpointIntervalBytes)
    ) {
      return
    }
    await receivedStore.checkpoint()
    const checkpoint: P2PResumeCheckpoint = {
      version: 1,
      roomName: name,
      peerId,
      storageId: receiveStorageId,
      meta,
      receivedBytes,
      completedHashes: hashState?.hashes.slice() ?? [],
      updatedAt: Date.now(),
    }
    if (!writeP2PResumeCheckpoint(checkpoint)) return
    resumeCheckpoint = checkpoint
    lastCheckpointBytes = receivedBytes
    registerCheckpoint()
  }

  const replaceReceivedBlock = async (index: number, parts: ArrayBuffer[]) => {
    await enqueueReceivedStorage(async () => {
      if (!receivedStore) throw new Error("P2P receive storage is unavailable.")
      await receivedStore.replaceBlock(index, parts)
    })
  }

  const createReceivedFile = async (fileMeta: P2PFileMeta): Promise<File> => {
    return await enqueueReceivedStorage(async () => {
      if (!receivedStore) throw new Error("P2P receive storage is unavailable.")
      return await receivedStore.file(fileMeta)
    })
  }

  const verifyReceivedBlocks = async (
    manifest: P2PVerificationManifest,
    indicesToVerify?: Iterable<number>,
    isCurrent: () => boolean = () => true,
  ): Promise<number[]> => {
    if (hashState) await finishHashData(hashState)
    if (!isCurrent()) return []
    const indices = verificationHashIndices(manifest, indicesToVerify)
    const mismatches: number[] = []
    for (const index of indices) {
      if (!isCurrent()) return []
      const actual = hashState?.hashes[index] ?? (await sha1Hex(blocks[index] ?? []))
      if (actual !== manifest.hashes[index]) mismatches.push(index)
    }
    return mismatches.sort((a, b) => a - b)
  }

  const finishVerifiedTransfer = async (status = "Transfer complete.", isCurrent: () => boolean = () => !isClosed) => {
    if (!meta) return
    const file = await createReceivedFile(meta)
    if (!isCurrent()) return
    if (file.size !== meta.size) {
      const message = `Stored P2P file size mismatch: expected ${meta.size} bytes, got ${file.size} bytes.`
      await failVerifiedTransfer(message, isCurrent)
      if (isCurrent()) callbacks.onError(new Error(message))
      return
    }
    incompleteTransferRetries = 0
    transitionTransfer({ kind: "complete" })
    downloadRequestedChannel = undefined
    callbacks.onProgress({
      doneBytes: meta.size,
      totalBytes: meta.size,
      speedBytesPerSecond: measureSpeed(speedTracker, meta.size, true),
    })
    clearPauseState()
    callbacks.onStatus(status)
    callbacks.onFile(file)
    if (dc) sendData(dc, { type: "received", revision: meta.revision })
    void wakeLock.stop()
    resumeCheckpoint = undefined
    checkpointRegistration = "unregistered"
    lastCheckpointBytes = 0
    removeP2PResumeCheckpoint(name)
    rotatePeerIdForNextSession()
  }

  const failVerifiedTransfer = async (message: string, isCurrent: () => boolean = () => !isClosed) => {
    transitionTransfer({ kind: "idle" })
    downloadRequestedChannel = undefined
    await resetReceivedData()
    if (!isCurrent()) return
    speedTracker = createSpeedTracker(0)
    callbacks.onProgress(undefined)
    clearPauseState()
    callbacks.onStatus(`${message} Receive the file again to retry.`)
    void wakeLock.stop()
  }

  const emitRepairProgress = () => {
    if (!meta) return
    const repairBytes = verificationBlocksByteLength(pendingRepairIndices, meta.size)
    const doneBytes = Math.max(0, meta.size - repairBytes)
    callbacks.onProgress({ doneBytes, totalBytes: meta.size, speedBytesPerSecond: 0 })
    if (dc) sendData(dc, { type: "progress", doneBytes, revision: meta.revision })
  }

  const verifyOrRequestRepair = async (
    manifest: P2PVerificationManifest,
    indicesToVerify?: Iterable<number>,
    isCurrent: () => boolean = () => true,
  ) => {
    const mismatches = await verifyReceivedBlocks(manifest, indicesToVerify, isCurrent)
    if (!isCurrent()) return
    if (mismatches.length === 0) {
      if (dc) sendData(dc, { type: "verified" })
      await finishVerifiedTransfer("File received and verified. Saving should start automatically.", isCurrent)
      return
    }

    repairAttempts += 1
    if (repairAttempts > maxVerificationRepairAttempts) {
      const message = `Transfer verification failed after ${maxVerificationRepairAttempts} repair attempts.`
      await failVerifiedTransfer(message, isCurrent)
      if (!isCurrent()) return
      callbacks.onError(new Error(message))
      return
    }

    pendingRepairIndices = new Set(mismatches)
    repairVerificationIndices = new Set(mismatches)
    transitionTransfer({ kind: "repairing" })
    emitRepairProgress()
    callbacks.onStatus(`Repairing ${mismatches.length} block${mismatches.length === 1 ? "" : "s"}...`)
    if (dc) sendData(dc, { type: "repair-request", indices: mismatches })
  }

  const preserveOrDisposeReceivedStorage = async (discardCompleted = false) => {
    await enqueueReceivedStorage(async () => {
      if (receivedStore?.kind === "persistent" && resumeCheckpoint && receivedBytes > 0 && !isComplete()) {
        const storage = receivedStore
        receivedStore = undefined
        await storage.preserve().catch(() => undefined)
        clearReceivedData()
      } else {
        await disposeReceivedStorage()
        clearReceivedData()
      }
      if (discardCompleted) {
        const completedStores = completedReceivedStores.splice(0)
        await Promise.all(completedStores.map((storage) => storage.discard().catch(() => undefined)))
      }
    })
  }

  interface FinishReceiverRuntimeOptions {
    transferState?: ReceiverTransferState
    progress?: P2PProgress
    pauseState?: "keep" | "clear" | "paused"
  }

  const finishReceiverRuntime = ({
    transferState = { kind: "idle" },
    progress,
    pauseState = "clear",
  }: FinishReceiverRuntimeOptions = {}) => {
    isClosed = true
    finishConnectionRecovery()
    transitionTransfer(transferState)
    callbacks.onProgress(progress)
    if (pauseState === "clear") {
      clearPauseState()
    } else if (pauseState === "paused") {
      callbacks.onPausePendingChange?.(false)
      callbacks.onPausedChange(true)
    }
    signalingTransport.close()
    resetPeerConnection()
    void wakeLock.stop()
  }

  const close = () => {
    if (closeCleanupStarted) return
    closeCleanupStarted = true
    const preserveCurrent =
      receivedStore?.kind === "persistent" && resumeCheckpoint !== undefined && receivedBytes > 0 && !isComplete()
    if (!preserveCurrent) receivedStore?.queueDeletion()
    for (const storage of completedReceivedStores) storage.queueDeletion()
    finishReceiverRuntime({ pauseState: "keep" })
    if (ownsRoomSession) void preserveOrDisposeReceivedStorage(true).finally(releaseRoomLock)
  }

  const stopUnavailableRoom = async () => {
    if (isClosed) return
    await enqueueReceivedStorage(() => checkpointReceivedData(true)).catch(() => undefined)
    downloadRequestedChannel = undefined
    finishReceiverRuntime({
      transferState: { kind: "paused" },
      progress: meta ? { doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 } : undefined,
      pauseState: "paused",
    })
    callbacks.onStatus(
      resumeCheckpoint
        ? "P2P room is no longer available. The saved partial transfer has been retained."
        : "P2P room is no longer available. Transfer recovery has stopped.",
    )
    if (ownsRoomSession) await preserveOrDisposeReceivedStorage().finally(releaseRoomLock)
  }

  const probeRoomBeforeRetry = () => {
    if (roomAvailabilityProbe || isClosed) return
    roomAvailabilityProbe = (async () => {
      if ((await probeP2PRoomAvailability(config, name)) === "unavailable") {
        await stopUnavailableRoom()
        return
      }
      if (!isClosed) signalingTransport.restartReconnect()
    })().finally(() => {
      roomAvailabilityProbe = undefined
    })
  }

  const requestDownloadFromCurrentOffset = async () => {
    const channel = dc
    if (channel?.readyState !== "open" || isComplete() || isDiscarding() || !meta) return
    if (downloadRequestedChannel === channel) return
    downloadRequestedChannel = channel
    void wakeLock.start()
    await prepareReceivedStorage()
    if (channel !== dc || channel.readyState !== "open" || downloadRequestedChannel !== channel || isClosed) return
    if (receivedBytes === 0 && meta?.verifyTransfer) {
      hashState = {
        index: 0,
        size: 0,
        buffer: new Uint8Array(0),
        hashes: [],
      }
    }
    lastProgressAt = performance.now()
    speedTracker = createSpeedTracker(receivedBytes)
    clearPauseState()
    callbacks.onProgress(meta ? { doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 } : undefined)
    sendData(channel, { type: "progress", doneBytes: receivedBytes, revision: meta.revision })
    sendData(channel, { type: "download", offset: receivedBytes, revision: meta.revision })
  }

  const requestDownload = () => {
    if (isClosed) return
    transitionTransfer({ kind: "downloading" })
    if (dc?.readyState !== "open") {
      callbacks.onStatus("Reconnecting to start transfer...")
      requestPeerRecovery(true)
      return
    }
    void requestDownloadFromCurrentOffset().catch((error: unknown) => {
      transitionTransfer({ kind: "idle" })
      downloadRequestedChannel = undefined
      void wakeLock.stop()
      callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    })
  }

  const adoptPendingUpdate = async (resetCurrentData = true) => {
    const nextMeta = pendingUpdateMeta
    if (!nextMeta) return false
    // Completed OPFS-backed files must remain on disk while their transfer-history
    // cards can still preview or download them. Session close performs the cleanup.
    if (isComplete() && receivedStore) {
      completedReceivedStores.push(receivedStore)
      receivedStore = undefined
    }
    if (resetCurrentData) await resetReceivedData()
    meta = nextMeta
    pendingUpdateMeta = undefined
    transitionTransfer({ kind: "idle" })
    downloadRequestedChannel = undefined
    speedTracker = createSpeedTracker(0)
    callbacks.onUpdateAvailable?.(undefined)
    callbacks.onMeta(nextMeta)
    callbacks.onProgress(undefined)
    clearPauseState()
    return true
  }

  const finishStoppedTransfer = async (
    shouldRestart: boolean,
    isCurrent: () => boolean,
    options: { autoRestart?: boolean; terminatedStatus?: string } = {},
  ) => {
    transitionTransfer({ kind: "idle" })
    downloadRequestedChannel = undefined
    const cleanup = beginStoppedTransferCleanup()
    await cleanup
    if (stoppedTransferCleanup === cleanup) stoppedTransferCleanup = undefined
    if (!isCurrent()) return
    speedTracker = createSpeedTracker(0)
    callbacks.onProgress(undefined)
    clearPauseState()
    if (shouldRestart) {
      const adopted = await adoptPendingUpdate(false)
      if (!isCurrent() || !adopted) return
      if (options.autoRestart === false) {
        callbacks.onStatus("Updated file selected. Receive the file to reconnect and start.")
        void wakeLock.stop()
        return
      }
      callbacks.onStatus("Updated file selected. Starting to receive...")
      requestDownload()
      return
    }
    callbacks.onStatus(
      options.terminatedStatus ??
        (forceMemoryStorage
          ? "Disk storage failed. Receive the file again to retry in memory."
          : "Transfer terminated. Receive the file again to start over."),
    )
    void wakeLock.stop()
  }

  const acceptUpdate = () => {
    if (isClosed || !pendingUpdateMeta) return
    const channel = dc
    const hasActiveTransfer = !isComplete() && (wantsDownload() || isPaused() || isPausePending() || receivedBytes > 0)
    if (channel?.readyState === "open" && hasActiveTransfer) {
      transitionTransfer({ kind: "stopping", restartAfterStop: true })
      downloadRequestedChannel = undefined
      clearPauseState()
      callbacks.onStatus("Switching to the updated file...")
      sendData(channel, { type: "stop" })
      void beginStoppedTransferCleanup().catch(callbacks.onError)
      return
    }

    void adoptPendingUpdate()
      .then((adopted) => {
        if (!adopted || isClosed) return
        callbacks.onStatus("Updated file selected. Starting to receive...")
        requestDownload()
      })
      .catch(callbacks.onError)
  }

  const pause = () => {
    if (isClosed) return
    const channel = dc
    if (isComplete() || isPaused() || isPausePending() || !wantsDownload()) return
    transitionTransfer({ kind: "pausing" })
    downloadRequestedChannel = undefined
    callbacks.onPausePendingChange?.(true)
    callbacks.onStatus("Pausing...")
    if (meta) callbacks.onProgress({ doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 })
    if (isPeerTransportUsable() && channel) {
      sendData(channel, { type: "pause" })
      return
    }
    confirmPause()
    requestPeerRecovery(true)
  }

  const resume = () => {
    if (isClosed || isPausePending() || !isPaused()) return
    transitionTransfer({ kind: "downloading" })
    callbacks.onPausedChange(false)
    if (dc?.readyState === "open") {
      callbacks.onStatus("Resuming transfer...")
      requestDownload()
      return
    }
    callbacks.onStatus("Reconnecting to resume transfer...")
    requestPeerRecovery(true)
  }

  const terminate = () => {
    if (isClosed) return
    const channel = dc
    if (isComplete() || isDiscarding()) return
    downloadRequestedChannel = undefined
    transitionTransfer({ kind: "stopping", restartAfterStop: false })
    clearPauseState()
    callbacks.onProgress(meta ? { doneBytes: 0, totalBytes: meta.size, speedBytesPerSecond: 0 } : undefined)
    callbacks.onStatus("Terminating transfer...")
    void beginStoppedTransferCleanup().catch(callbacks.onError)
    if (isPeerTransportUsable() && channel) {
      sendData(channel, { type: "stop" })
      return
    }
    requestPeerRecovery(true)
  }

  function attachDataChannel(channel: RTCDataChannel) {
    if (isClosed) {
      channel.close()
      return
    }
    const channelGeneration = dataChannelGeneration + 1
    dataChannelGeneration = channelGeneration
    const isCurrentChannel = () => !isClosed && dataChannelGeneration === channelGeneration && dc === channel
    if (dc && dc !== channel) {
      dc.onopen = null
      dc.onmessage = null
      dc.onclose = null
      dc.onerror = null
      dc.close()
    }
    dc = channel
    downloadRequestedChannel = undefined
    dataMessageQueue = Promise.resolve()
    dc.binaryType = "arraybuffer"
    dc.onopen = () => {
      if (!isCurrentChannel()) return
      if (pc) void refreshConnectionRoute(pc)
      finishConnectionRecovery()
      if (isDiscarding()) {
        callbacks.onStatus(
          restartAfterStop() ? "Reconnected. Finishing file switch..." : "Reconnected. Finishing termination...",
        )
        sendData(channel, { type: "stop" })
        return
      }
      callbacks.onStatus(
        isPaused()
          ? "Paused. Waiting for file details..."
          : wantsDownload() && receivedBytes > 0
            ? "Reconnected. Resuming transfer..."
            : "Connected. Waiting for file details...",
      )
      if (wantsDownload() && meta) void requestDownloadFromCurrentOffset().catch(callbacks.onError)
    }
    const handleDataMessage = async (data: MessageEvent["data"]) => {
      if (!isCurrentChannel()) return
      if (typeof data === "string") {
        const message = parseP2PDataMessage(data, "sender")
        if (message.type === "meta") {
          if (isDiscarding()) {
            if (restartAfterStop() && pendingUpdateMeta) pendingUpdateMeta = message.meta
            return
          }
          if (message.meta.verifyTransfer) {
            if (message.meta.size > MAX_MEMORY_P2P_BYTES && forceMemoryStorage) {
              throw new Error("This file is too large to receive in memory after disk storage failed.")
            }
          }
          if (
            meta &&
            !p2pResumeMetaMatches(meta, message.meta) &&
            (receivedBytes > 0 || wantsDownload() || isPaused() || isComplete())
          ) {
            pendingUpdateMeta = message.meta
            callbacks.onUpdateAvailable?.(message.meta)
            downloadRequestedChannel = undefined
            if (wantsDownload()) await requestDownloadFromCurrentOffset()
            return
          }
          meta = message.meta
          callbacks.onMeta(meta)
          if (isPaused()) {
            callbacks.onProgress({ doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 })
            sendData(channel, { type: "progress", doneBytes: receivedBytes, revision: meta.revision })
            sendData(channel, { type: "pause" })
            callbacks.onStatus("Paused.")
            return
          }
          callbacks.onStatus(
            wantsDownload() && receivedBytes > 0
              ? "File details received. Resuming transfer..."
              : "File details received. Ready to receive.",
          )
          if (wantsDownload()) await requestDownloadFromCurrentOffset()
        } else if (message.type === "file-update") {
          if (message.meta.revision && message.meta.revision === meta?.revision) return
          if (!isComplete() && receivedBytes === 0 && !wantsDownload() && !isPaused() && !isPausePending()) {
            meta = message.meta
            callbacks.onMeta(meta)
            callbacks.onProgress(undefined)
            callbacks.onStatus("The sender updated the file. Ready to receive the new version.")
            return
          }
          pendingUpdateMeta = message.meta
          callbacks.onUpdateAvailable?.(message.meta)
        } else if (message.type === "verification-start") {
          if (!meta?.verifyTransfer || isDiscarding()) {
            throw new Error("Unexpected P2P verification manifest header.")
          }
          const expectedHashCount = Math.ceil(meta.size / verificationBlockSize)
          if (message.hashCount !== expectedHashCount) {
            throw new Error("Transfer verification manifest length mismatch.")
          }
          verificationManifestAssembly = {
            blockSize: message.blockSize,
            hashCount: message.hashCount,
            hashes: [],
          }
        } else if (message.type === "verification-chunk") {
          const assembly = verificationManifestAssembly
          if (message.startIndex !== assembly?.hashes.length) {
            throw new Error("Transfer verification manifest chunks are out of order.")
          }
          if (assembly.hashes.length + message.hashes.length > assembly.hashCount) {
            throw new Error("Transfer verification manifest contains too many hashes.")
          }
          assembly.hashes.push(...message.hashes)
        } else if (message.type === "done") {
          if (!meta) return
          if (isDiscarding()) return
          if (receivedBytes < meta.size) {
            verificationManifestAssembly = undefined
            if (incompleteTransferRetries >= maxIncompleteTransferRetries) {
              const errorMessage = `P2P transfer remained incomplete after ${maxIncompleteTransferRetries} retries.`
              await failVerifiedTransfer(errorMessage, isCurrentChannel)
              if (isCurrentChannel()) callbacks.onError(new Error(errorMessage))
              return
            }
            incompleteTransferRetries += 1
            downloadRequestedChannel = undefined
            callbacks.onStatus(
              `Transfer ended early at ${receivedBytes} of ${meta.size} bytes. Requesting the missing data ` +
                `(retry ${incompleteTransferRetries}/${maxIncompleteTransferRetries})...`,
            )
            callbacks.onProgress({ doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 })
            await requestDownloadFromCurrentOffset()
            return
          }
          if (meta.verifyTransfer) {
            const assembledVerification = verificationManifestAssembly
            const manifest =
              message.verification ??
              (assembledVerification
                ? { blockSize: assembledVerification.blockSize, hashes: assembledVerification.hashes }
                : undefined)
            verificationManifestAssembly = undefined
            if (!manifest) {
              callbacks.onError(new Error("Transfer verification manifest missing."))
              return
            }
            if (manifest.blockSize !== verificationBlockSize) {
              callbacks.onError(new Error("Transfer verification block size mismatch."))
              return
            }
            const expectedHashCount = Math.ceil(meta.size / verificationBlockSize)
            if (manifest.hashes.length !== expectedHashCount) {
              callbacks.onError(new Error("Transfer verification manifest length mismatch."))
              return
            }
            verificationManifest = manifest
            transitionTransfer({ kind: "verifying" })
            callbacks.onStatus("Verifying transfer...")
            await verifyOrRequestRepair(manifest, undefined, isCurrentChannel)
            return
          }
          await finishVerifiedTransfer("Transfer complete.", isCurrentChannel)
        } else if (message.type === "error") {
          callbacks.onError(new Error(message.message))
        } else if (message.type === "paused") {
          confirmPause()
        } else if (message.type === "stopped") {
          const shouldRestart = restartAfterStop()
          await finishStoppedTransfer(shouldRestart, isCurrentChannel)
        } else if (message.type === "repair-start") {
          if (!verificationManifest || message.index >= verificationManifest.hashes.length) {
            throw new Error("Invalid P2P repair block index.")
          }
          const expectedSize = verificationBlockByteLength(message.index, meta?.size ?? 0)
          if (message.size !== expectedSize) throw new Error("P2P repair block size mismatch.")
          repairBlock = { index: message.index, size: message.size, bytes: 0, parts: [] }
          callbacks.onStatus(`Repairing block ${message.index + 1}...`)
        } else if (message.type === "repair-end") {
          if (repairBlock?.index === message.index) {
            if (repairBlock.bytes !== repairBlock.size) {
              callbacks.onError(new Error(`Repaired block ${message.index} size mismatch.`))
              repairBlock = undefined
              return
            }
            const repairedHash = hashState?.hashes ? await sha1Hex(repairBlock.parts) : undefined
            await replaceReceivedBlock(message.index, repairBlock.parts)
            if (repairedHash && hashState?.hashes) hashState.hashes[message.index] = repairedHash
            if (!isCurrentChannel()) return
            pendingRepairIndices.delete(message.index)
            emitRepairProgress()
            repairBlock = undefined
            if (pendingRepairIndices.size === 0 && verificationManifest) {
              const indicesToVerify = [...repairVerificationIndices]
              repairVerificationIndices = new Set<number>()
              callbacks.onStatus("Verifying repaired blocks...")
              transitionTransfer({ kind: "verifying" })
              await verifyOrRequestRepair(verificationManifest, indicesToVerify, isCurrentChannel)
            }
          }
        }
        return
      }

      if (!meta) return
      const isExpectedFileData = wantsDownload() || isPausePending()
      const isExpectedRepairData = transferState.kind === "repairing" && repairBlock !== undefined
      if (isDiscarding()) return
      if (!isExpectedFileData && !isExpectedRepairData) {
        throw new Error("Unexpected P2P binary data for the current transfer state.")
      }
      const chunk = data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer)
      if (!(chunk instanceof ArrayBuffer)) throw new Error("Invalid P2P binary data.")
      if (!isCurrentChannel()) return
      if (repairBlock) {
        if (repairBlock.bytes + chunk.byteLength > repairBlock.size) {
          throw new Error("P2P repair block exceeds its declared size.")
        }
        repairBlock.parts.push(chunk)
        repairBlock.bytes += chunk.byteLength
        return
      }
      if (receivedBytes > meta.size || chunk.byteLength > meta.size - receivedBytes) {
        throw new Error("P2P transfer exceeds the declared file size.")
      }
      await appendReceivedBlockData(chunk)
      if (!isCurrentChannel()) return
      const now = performance.now()
      if (meta && (now - lastProgressAt >= progressUpdateIntervalMs || receivedBytes >= meta.size)) {
        lastProgressAt = now
        if (dc) sendData(dc, { type: "progress", doneBytes: receivedBytes, revision: meta.revision })
        callbacks.onProgress({
          doneBytes: receivedBytes,
          totalBytes: meta.size,
          speedBytesPerSecond: measureSpeed(speedTracker, receivedBytes),
        })
      }
    }

    dc.onmessage = (event) => {
      if (!isCurrentChannel()) return
      dataMessageQueue = dataMessageQueue
        .then(() => handleDataMessage(event.data))
        .catch(async (error) => {
          if (!isCurrentChannel()) return
          const receivedError = error instanceof Error ? error : new Error(String(error))
          if (
            (receivedStore?.kind === "opfs" || receivedStore?.kind === "persistent") &&
            (meta?.size ?? 0) <= MAX_MEMORY_P2P_BYTES
          ) {
            forceMemoryStorage = true
            transitionTransfer({ kind: "stopping", restartAfterStop: false })
            downloadRequestedChannel = undefined
            callbacks.onProgress(undefined)
            clearPauseState()
            callbacks.onStatus("Disk storage failed. Stopping transfer...")
            sendData(channel, { type: "stop" })
            await beginStoppedTransferCleanup()
            callbacks.onError(new Error(`Unable to write the P2P temporary file: ${receivedError.message}`))
            return
          }
          if (receivedStore?.kind === "opfs" || receivedStore?.kind === "persistent") {
            transitionTransfer({ kind: "stopping", restartAfterStop: false })
            downloadRequestedChannel = undefined
            callbacks.onProgress(undefined)
            clearPauseState()
            callbacks.onStatus("Disk storage failed and the file is too large for memory fallback.")
            sendData(channel, { type: "stop" })
            await beginStoppedTransferCleanup()
            callbacks.onError(new Error(`Unable to write the P2P temporary file: ${receivedError.message}`))
            return
          }
          callbacks.onError(receivedError)
        })
    }
    dc.onclose = () => {
      if (!isCurrentChannel() || isComplete()) return
      requestPeerRecovery(true)
    }
    dc.onerror = () => {
      if (!isCurrentChannel() || isComplete()) return
      requestPeerRecovery(true)
    }
  }

  function ensurePeerConnection(): RTCPeerConnection | undefined {
    if (isClosed) return undefined
    if (pc) return pc
    const connection = new RTCPeerConnection(rtcConfig(iceServers))
    pc = connection
    const refreshCurrentConnectionRoute = () => void refreshConnectionRoute(connection)
    connection.onicecandidate = (event) => {
      if (!isClosed && pc === connection && event.candidate) {
        sendReceiverSignal({ type: "candidate", peerId, candidate: event.candidate.toJSON(), negotiationId })
      }
    }
    connection.oniceconnectionstatechange = () => {
      if (
        !isClosed &&
        pc === connection &&
        (connection.iceConnectionState === "connected" || connection.iceConnectionState === "completed")
      ) {
        refreshCurrentConnectionRoute()
      }
    }
    connection.onconnectionstatechange = () => {
      if (isClosed || pc !== connection) return
      if (connection.connectionState === "connected") {
        refreshCurrentConnectionRoute()
        finishConnectionRecovery()
        callbacks.onStatus(isPaused() ? "Paused." : "Peer connected.")
      }
      if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
        requestPeerRecovery(connection.connectionState === "failed")
      }
    }
    connection.ondatachannel = (event) => {
      if (isClosed || pc !== connection) {
        event.channel.close()
        return
      }
      attachDataChannel(event.channel)
    }
    return connection
  }

  async function refreshConnectionRoute(connection: RTCPeerConnection): Promise<void> {
    const route = await selectedP2PConnectionRoute(connection).catch(() => undefined)
    if (!isClosed && pc === connection && route) callbacks.onConnectionRouteChange?.(route)
  }

  function resetPeerConnection() {
    if (isPausePending()) confirmPause()
    cancelRTCRecoveryTimer()
    recoveryRequestSent = false
    dataChannelGeneration += 1
    dataMessageQueue = Promise.resolve()
    downloadRequestedChannel = undefined
    const channel = dc
    const connection = pc
    dc = undefined
    pc = undefined
    if (!isComplete()) callbacks.onConnectionRouteChange?.(undefined)
    closeP2PConnection(connection, channel)
    iceCandidates.clear()
    negotiationId = undefined
  }

  const restoreSavedTransfer = async () => {
    const checkpoint = resumeCheckpoint
    if (!checkpoint) return
    if (!P2PPersistentReceiveStore.supported()) {
      removeP2PResumeCheckpoint(name)
      resumeCheckpoint = undefined
      lastCheckpointBytes = 0
      return
    }

    callbacks.onStatus("Restoring saved transfer...")
    const store = new P2PPersistentReceiveStore(receiveStorageId)
    try {
      const completedHashBytes = checkpoint.meta.verifyTransfer
        ? checkpoint.completedHashes.length * verificationBlockSize
        : checkpoint.receivedBytes
      const { tail } = await store.open(checkpoint.receivedBytes, completedHashBytes)
      receivedStore = persistentStore(store)
      meta = checkpoint.meta
      receivedBytes = checkpoint.receivedBytes
      transitionTransfer({ kind: "paused" })
      if (meta.verifyTransfer) {
        const buffer = new Uint8Array(verificationBlockSize)
        buffer.set(new Uint8Array(tail))
        hashState = {
          index: checkpoint.completedHashes.length,
          size: tail.byteLength,
          buffer,
          hashes: checkpoint.completedHashes.slice(),
        }
      }
      speedTracker = createSpeedTracker(receivedBytes)
      callbacks.onMeta(meta)
      callbacks.onProgress({ doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 })
      callbacks.onPausePendingChange?.(false)
      callbacks.onPausedChange(true)
      callbacks.onStatus("Saved transfer restored and paused. Looking for the sender...")
    } catch {
      await store.discard().catch(() => undefined)
      removeP2PResumeCheckpoint(name)
      resumeCheckpoint = undefined
      lastCheckpointBytes = 0
      receiveStorageId = uuid()
      meta = undefined
      clearReceivedData()
      callbacks.onStatus("Saved transfer was unavailable. Restarting from the beginning...")
    }
  }

  const signalingTransport: P2PSignalingTransport = createP2PSignalingTransport({
    url: () => wsUrl(config, name, "receiver", { peerId }),
    reconnectWindowMs: P2P_RECEIVER_SIGNAL_RECONNECT_WINDOW_MS,
    shouldReconnect: () => !isClosed && !senderLeft,
    onOpen: (isReconnect) => {
      checkpointRegistration = "unregistered"
      callbacks.onStatus(
        isPeerTransportUsable()
          ? isPaused()
            ? "Paused. Signaling connected; synchronizing..."
            : "Signaling connected; synchronizing while transfer continues..."
          : isPaused()
            ? isReconnect
              ? "Paused. Signaling reconnected..."
              : "Paused. Looking for the sender..."
            : isReconnect
              ? receivedBytes > 0
                ? "Signaling reconnected. Waiting to resume transfer..."
                : "Signaling reconnected. Looking for the sender..."
              : "Looking for the sender...",
      )
    },
    onSocketError: () => {
      isSignalingReady = false
      callbacks.onStatus(
        isPeerTransportUsable()
          ? "P2P signaling connection failed. Existing transfer continues while reconnecting..."
          : "P2P signaling connection failed. Reconnecting...",
      )
    },
    onClose: () => {
      isSignalingReady = false
      senderSignalingAvailable = false
      cancelRTCRecoveryTimer()
      recoveryRequestSent = false
      if (senderLeft) {
        finishConnectionRecovery()
        callbacks.onStatus("Sender left.")
        return
      }
      if (!isPeerTransportUsable() && (wantsDownload() || isPaused() || receivedBytes > 0)) {
        setConnectionRecovering(true)
      }
      callbacks.onStatus(
        isPeerTransportUsable()
          ? isPaused()
            ? "Paused. Signaling disconnected; peer connection remains available."
            : "P2P signaling disconnected. Transfer continues."
          : isPaused()
            ? "Paused. Reconnecting to the sender..."
            : wantsDownload() || receivedBytes > 0
              ? "Connection lost. Reconnecting to resume transfer..."
              : "P2P signaling closed. Reconnecting...",
      )
    },
    onReconnectExhausted: () => {
      if (
        isPeerTransportUsable() ||
        isRecoveringConnection ||
        resumeCheckpoint !== undefined ||
        receivedBytes > 0 ||
        isPaused() ||
        wantsDownload()
      ) {
        callbacks.onStatus(
          isPeerTransportUsable()
            ? "Signaling is still unavailable. Transfer continues while retrying..."
            : "Signaling is still unavailable. Retrying to preserve transfer recovery...",
        )
        probeRoomBeforeRetry()
        return
      }
      finishReceiverRuntime()
      void preserveOrDisposeReceivedStorage().finally(releaseRoomLock)
      callbacks.onStatus("Unable to reconnect to the sender. Transfer session closed.")
    },
    onImmediateMessage: (message) => {
      if (message.type === "transfer-limit-complete") {
        callbacks.onTransferLimitReached?.()
        return true
      }
      if (message.type === "room-options-updated") {
        callbacks.onRoomAvailabilityChange?.(message.joinable)
        return true
      }
      if (message.type === "transfer-checkpoint-result") {
        checkpointRegistration =
          resumeCheckpoint && message.accepted && !pendingCheckpointClear ? "registered" : "unregistered"
        return true
      }
      return false
    },
    onMessage: async (message, isCurrentSocket) => {
      if (message.type === "ready") {
        isSignalingReady = true
        senderSignalingAvailable = message.peers.sender
        signalingTransport.resetReconnect()
        if ("iceServers" in message) iceServers = message.iceServers
        if (pendingCheckpointClear && sendReceiverSignal({ type: "transfer-checkpoint-clear" })) {
          pendingCheckpointClear = false
        }
        registerCheckpoint()
        if (isRecoveringConnection && !isPeerTransportUsable() && senderSignalingAvailable) {
          recoveryRequestSent = false
          requestPeerRecovery(true)
        }
        if (isPeerTransportUsable()) {
          callbacks.onStatus(
            isComplete()
              ? "Transfer complete. Signaling restored."
              : isPaused()
                ? "Paused. Signaling restored."
                : "Signaling restored. Transfer continues.",
          )
        } else if (message.peers.sender) {
          callbacks.onStatus(
            isPaused()
              ? "Paused. Waiting for WebRTC pairing..."
              : wantsDownload() || receivedBytes > 0
                ? "Reconnected. Waiting for WebRTC pairing..."
                : "Sender found. Pairing...",
          )
        }
      }
      if (message.type === "offer") {
        isSignalingReady = true
        senderSignalingAvailable = true
        if (isRecoveringConnection) {
          cancelRTCRecoveryTimer()
          recoveryRequestSent = false
        }
        resetPeerConnection()
        negotiationId = message.negotiationId
        if (!isCurrentSocket()) return
        const connection = ensurePeerConnection()
        if (!connection) return
        await connection.setRemoteDescription(message.sdp)
        if (!isCurrentSocket() || pc !== connection) return
        await iceCandidates.flush(connection, () => isCurrentSocket() && pc === connection)
        if (!isCurrentSocket() || pc !== connection) return
        const answer = await connection.createAnswer()
        if (!isCurrentSocket() || pc !== connection) return
        await connection.setLocalDescription(answer)
        if (!isCurrentSocket() || pc !== connection) return
        signalingTransport.send({ type: "answer", peerId, sdp: answer, negotiationId })
      }
      if (message.type === "peer-signaling-disconnected" && message.role === "sender") {
        senderSignalingAvailable = false
        cancelRTCRecoveryTimer()
        recoveryRequestSent = false
        callbacks.onStatus(
          isPeerTransportUsable()
            ? isPaused()
              ? "Paused. Sender signaling disconnected; peer connection remains available."
              : "Sender signaling disconnected. Transfer continues."
            : isPaused()
              ? "Paused. Waiting for sender signaling to reconnect..."
              : "Peer connection interrupted. Waiting for sender signaling to reconnect...",
        )
      }
      if (message.type === "candidate") {
        if (message.negotiationId && negotiationId && message.negotiationId !== negotiationId) return
        const connection = pc
        if (connection) {
          await iceCandidates.addOrBuffer(connection, message.candidate, () => isCurrentSocket() && pc === connection)
        } else {
          iceCandidates.add(message.candidate)
        }
      }
      if (message.type === "receiver-pair-result" && message.accepted && resumeCheckpoint) {
        registerCheckpoint()
      }
      if (message.type === "peer-reconnect-failed") {
        finishConnectionRecovery()
        recoveryRetryToken = message.retryToken
        if (isDiscarding()) {
          const shouldRestart = restartAfterStop()
          resetPeerConnection()
          await finishStoppedTransfer(shouldRestart, () => !isClosed, {
            autoRestart: false,
            terminatedStatus: "Transfer terminated. Receive the file again to reconnect and start over.",
          })
          return
        }
        if (!isComplete() && !isDiscarding()) {
          resetPeerConnection()
          transitionTransfer({ kind: "paused" })
          downloadRequestedChannel = undefined
          callbacks.onPausePendingChange?.(false)
          callbacks.onPausedChange(true)
          if (meta) {
            callbacks.onProgress({ doneBytes: receivedBytes, totalBytes: meta.size, speedBytesPerSecond: 0 })
          }
          void enqueueReceivedStorage(() => checkpointReceivedData(true)).catch(callbacks.onError)
          void wakeLock.stop()
          callbacks.onStatus("Connection recovery failed. Resume to retry.")
        }
      }
      if (message.type === "receiver-limit-reached") {
        rotatePeerIdForNextSession()
        finishReceiverRuntime()
        callbacks.onStatus("P2P transfer limit reached.")
        void resetReceivedData().finally(releaseRoomLock)
        return
      }
      if (message.type === "transfer-abandoned") {
        rotatePeerIdForNextSession()
        finishReceiverRuntime()
        await resetReceivedData()
        releaseRoomLock()
        callbacks.onStatus("Transfer abandoned. Starting a new session...")
        callbacks.onAbandoned?.()
        return
      }
      if (message.type === "peer-left" && message.role === "sender") {
        const completed = isComplete()
        rotatePeerIdForNextSession()
        senderLeft = true
        finishReceiverRuntime()
        if (completed) {
          releaseRoomLock()
          callbacks.onStatus("Sender left. The completed file remains available.")
          return
        }
        downloadRequestedChannel = undefined
        pendingUpdateMeta = undefined
        callbacks.onUpdateAvailable?.(undefined)
        callbacks.onProgress(undefined)
        await resetReceivedData()
        releaseRoomLock()
        callbacks.onStatus("Sender left. Transfer session closed.")
      }
    },
    onError: callbacks.onError,
  })

  const connectAfterRestore = () => {
    if (!resumeCheckpoint) {
      signalingTransport.connect()
      return
    }
    void restoreSavedTransfer()
      .then(() => {
        if (!isClosed) signalingTransport.connect()
      })
      .catch(callbacks.onError)
  }

  const lockRequest = acquireP2PReceiverRoomLock(name)
  if (lockRequest) {
    void lockRequest.then((lock) => {
      if (!lock) {
        isClosed = true
        callbacks.onStatus("This P2P room is already open in another tab.")
        return
      }
      if (isClosed) {
        lock.release()
        return
      }
      roomLock = lock
      ownsRoomSession = true
      connectAfterRestore()
    })
  } else {
    ownsRoomSession = true
    connectAfterRestore()
  }

  return { requestDownload, acceptUpdate, pause, resume, terminate, close }
}
