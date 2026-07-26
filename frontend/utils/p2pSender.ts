import type { P2PCreateResponse, P2PIceServer, P2PUpdateResponse, PublicEnv } from "../../shared/interfaces.js"
import { P2P_RTC_DISCONNECT_GRACE_MS } from "../../shared/constants.js"
import { ErrorWithTitle } from "./errors.js"
import {
  P2PWakeLock,
  P2PIceCandidateBuffer,
  chunkSize,
  closeP2PConnection,
  createSpeedTracker,
  maxVerificationRepairAttempts,
  measureSpeed,
  p2pControlMessageLengthLimit,
  parseP2PDataMessage,
  probeP2PRoomAvailability,
  P2PReconnectPolicy,
  reconnectWindowMs,
  rtcConfig,
  selectedP2PConnectionRoute,
  sendData,
  streamBlobToDataChannel,
  appendHashData,
  finishHashData,
  sha1Hex,
  createP2PSignalingTransport,
  verificationBlockSize,
  verificationHashIndices,
  verificationManifestMessages,
  waitForBufferedAmount,
  wsUrl,
  uuid,
  type DataMessage,
  type P2PFileMeta,
  type P2PFileCleanup,
  type P2PConnectionRoute,
  type P2PProgress,
  type P2PSenderFileInfo,
  type P2PSenderPeerInfo,
  type P2PSenderSession,
  type P2PTransferStatus,
  type P2PVerificationManifest,
  type P2PSignalingTransport,
  type SignalMessage,
  type SpeedTracker,
  type BlockHashState,
} from "./p2pCommon.js"

const preferredChunkSize = 256 * 1024

interface SenderFileVersion {
  revision: string
  order: number
  file: File
  highlightLanguage?: string
  verifyTransfer: boolean
  verificationManifest?: P2PVerificationManifest
  verificationManifestPromise?: Promise<P2PVerificationManifest>
  verificationAbortController?: AbortController
  cleanup?: P2PFileCleanup
}

type SenderTransferState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "paused" }
  | { kind: "verifying" }
  | { kind: "repairing" }
  | { kind: "complete" }

type SenderRecoveryState = "idle" | "recovering" | "blocked"

interface SenderPeerState {
  peerId: string
  userAgent?: string
  browser: string
  pc: RTCPeerConnection
  dc: RTCDataChannel
  iceCandidates: P2PIceCandidateBuffer
  negotiationId: string
  signalingConnectionId?: string
  status: string
  connectionRoute?: P2PConnectionRoute
  progress?: P2PProgress
  isConnected: boolean
  hasOpenedDataChannel: boolean
  isSignalingConnected: boolean
  isWaitingForResume: boolean
  recoveryState: SenderRecoveryState
  recoveryRetryToken?: string
  transferState: SenderTransferState
  isPairReported: boolean
  isPairAuthorized: boolean
  isMetaSent: boolean
  isCompletionReported: boolean
  operationGeneration: number
  activeReader?: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>
  speedBytesPerSecond: number
  progressTracker?: SpeedTracker
  activeVersion?: SenderFileVersion
  repairAttempts: number
}

interface SenderPeerVersionRefs {
  current?: SenderFileVersion
  offered?: SenderFileVersion
}

interface SenderPeerRecovery {
  policy: P2PReconnectPolicy
  timer?: ReturnType<typeof setTimeout>
  isAttempting: boolean
}

interface EnsurePeerOptions {
  preserveProgress?: boolean
  recovering?: boolean
  signalingConnectionId?: string
}

async function createP2PRoom(
  config: PublicEnv,
  expire: string,
  maxTransfers: string,
  signal?: AbortSignal,
): Promise<P2PCreateResponse> {
  const resp = await fetch(`${config.DEPLOY_URL}/p2p/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expire, maxTransfers }),
    signal,
  })
  if (!resp.ok) {
    throw new ErrorWithTitle("Error on Creating P2P Share", await resp.text())
  }
  return await resp.json()
}

async function updateP2PRoom(
  response: P2PCreateResponse,
  config: PublicEnv,
  expire: string,
  maxTransfers: string,
  signal?: AbortSignal,
): Promise<P2PUpdateResponse> {
  const resp = await fetch(`${config.DEPLOY_URL}/p2p/update/${response.name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderToken: response.senderToken, expire, maxTransfers }),
    signal,
  })
  if (!resp.ok) {
    throw new ErrorWithTitle("Error on Updating P2P Share", await resp.text())
  }
  return await resp.json()
}

function createFileVersion(
  file: File,
  verifyTransfer: boolean,
  order: number,
  highlightLanguage?: string,
  cleanup?: P2PFileCleanup,
): SenderFileVersion {
  return {
    revision: uuid(),
    order,
    file,
    highlightLanguage,
    verifyTransfer,
    cleanup,
    verificationManifest: file.size === 0 ? { blockSize: verificationBlockSize, hashes: [] } : undefined,
  }
}

function releaseFileVersion(version: SenderFileVersion): void {
  version.verificationAbortController?.abort()
  version.verificationAbortController = undefined
  const cleanup = version.cleanup
  version.cleanup = undefined
  if (cleanup) void cleanup().catch(() => undefined)
}

function fileMeta(version: SenderFileVersion): P2PFileMeta {
  const { file, revision, highlightLanguage, verifyTransfer } = version
  return {
    revision,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    highlightLanguage,
    verifyTransfer,
  }
}

function senderFileInfo(version: SenderFileVersion): P2PSenderFileInfo {
  return { revision: version.revision, name: version.file.name, order: version.order }
}

function browserLabel(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown browser"
  const ua = userAgent
  const rules: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+).*Safari\//, "Safari"],
  ]
  for (const [regex, name] of rules) {
    const match = regex.exec(ua)
    if (match?.[1]) return `${name} ${match[1]}`
  }
  return "Unknown browser"
}

function senderTransferStatus(peer: SenderPeerState): P2PTransferStatus {
  if (peer.isWaitingForResume) return "WAITING"
  if (peer.recoveryState === "recovering" && peer.hasOpenedDataChannel && !isPeerPaused(peer)) return "RECONNECTING"
  switch (peer.transferState.kind) {
    case "complete":
      return "DONE"
    case "paused":
      return "PAUSED"
    case "repairing":
      return "REPAIRING"
    case "verifying":
      return "VERIFYING"
    case "uploading":
      return "UPLOADING"
    default:
      return "READY"
  }
}

function senderConnectionPhase(peer: SenderPeerState): P2PSenderPeerInfo["connectionPhase"] {
  if (peer.recoveryState === "recovering") return peer.hasOpenedDataChannel ? "reconnecting" : "pairing-retry"
  if (peer.recoveryState === "blocked") return peer.hasOpenedDataChannel ? "reconnect-failed" : "pairing-failed"
  if (peer.isConnected) return "connected"
  return peer.hasOpenedDataChannel ? "disconnected" : "pairing"
}

const isPeerComplete = (peer: SenderPeerState) => peer.transferState.kind === "complete"
const isPeerPaused = (peer: SenderPeerState) => peer.transferState.kind === "paused"
const isPeerSending = (peer: SenderPeerState) => peer.transferState.kind === "uploading"
const isPeerVerifying = (peer: SenderPeerState) => peer.transferState.kind === "verifying"
const isPeerRepairing = (peer: SenderPeerState) => peer.transferState.kind === "repairing"
const isPeerActive = (peer: SenderPeerState) => isPeerSending(peer) || isPeerVerifying(peer) || isPeerRepairing(peer)

function transitionPeer(peer: SenderPeerState, transferState: SenderTransferState): void {
  peer.transferState = transferState
}

function invalidateSenderPeerOperation(peer: SenderPeerState): number {
  peer.operationGeneration += 1
  const reader = peer.activeReader
  peer.activeReader = undefined
  if (reader) void reader.cancel().catch(() => undefined)
  return peer.operationGeneration
}

function closeSenderPeer(peer: SenderPeerState, preserveComplete = false, preserveResumable = false): boolean {
  const wasComplete = isPeerComplete(peer)
  invalidateSenderPeerOperation(peer)
  peer.isConnected = false
  closeP2PConnection(peer.pc, peer.dc)
  peer.recoveryState = "idle"
  if (preserveResumable && !wasComplete) {
    peer.isWaitingForResume = true
    if (peer.progress) peer.progress = { ...peer.progress, speedBytesPerSecond: 0 }
    transitionPeer(peer, { kind: "paused" })
    peer.status = "Disconnected. Waiting for receiver to resume."
    return true
  }
  peer.isWaitingForResume = false
  if (!preserveComplete || !wasComplete) {
    transitionPeer(peer, { kind: "idle" })
    return false
  }

  transitionPeer(peer, { kind: "complete" })
  peer.status = "Transfer complete."
  return true
}

export async function startP2PSender(
  file: File,
  config: PublicEnv,
  expire: string,
  maxTransfers: string,
  verifyTransfer: boolean,
  callbacks: {
    onStatus: (status: string) => void
    onPeersChange: (peers: P2PSenderPeerInfo[]) => void
    onIceServersChange?: (iceServers: P2PIceServer[] | undefined) => void
    onLimitReached?: () => void
    onError: (error: Error) => void
  },
  signal?: AbortSignal,
  highlightLanguage?: string,
  fileCleanup?: P2PFileCleanup,
): Promise<P2PSenderSession> {
  const response = await createP2PRoom(config, expire, maxTransfers, signal)
  const peers = new Map<string, SenderPeerState>()
  const wakeLock = new P2PWakeLock(callbacks.onStatus)
  const versions = new Map<string, SenderFileVersion>()
  const peerVersionRefs = new Map<string, SenderPeerVersionRefs>()
  const peerVersionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const versionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const peerRecoveries = new Map<string, SenderPeerRecovery>()
  const completedTransfers = new Map<string, P2PSenderPeerInfo>()
  let nextVersionOrder = 0
  let currentVersion = createFileVersion(file, verifyTransfer, nextVersionOrder++, highlightLanguage, fileCleanup)
  versions.set(currentVersion.revision, currentVersion)
  let iceServers: P2PIceServer[] | undefined
  let isClosed = false
  let isSignalingReady = false
  let wakeLockNeeded = false
  let roomAvailabilityProbe: Promise<void> | undefined

  const peerVersionRefsFor = (peerId: string) => {
    let refs = peerVersionRefs.get(peerId)
    if (!refs) {
      refs = {}
      peerVersionRefs.set(peerId, refs)
    }
    return refs
  }

  const retainedVersionRevisions = () => {
    const retainedRevisions = new Set<string>([currentVersion.revision])
    for (const refs of peerVersionRefs.values()) {
      if (refs.current) retainedRevisions.add(refs.current.revision)
      if (refs.offered) retainedRevisions.add(refs.offered.revision)
    }
    return retainedRevisions
  }

  const pruneVersions = () => {
    const retainedRevisions = retainedVersionRevisions()
    for (const revision of versions.keys()) {
      const existingTimer = versionCleanupTimers.get(revision)
      if (retainedRevisions.has(revision)) {
        if (existingTimer !== undefined) clearTimeout(existingTimer)
        versionCleanupTimers.delete(revision)
        continue
      }
      if (existingTimer !== undefined) continue
      versionCleanupTimers.set(
        revision,
        setTimeout(() => {
          versionCleanupTimers.delete(revision)
          if (!retainedVersionRevisions().has(revision)) {
            const version = versions.get(revision)
            if (version) releaseFileVersion(version)
            versions.delete(revision)
          }
        }, reconnectWindowMs),
      )
    }
  }

  const cancelPeerVersionCleanup = (peerId: string) => {
    const timer = peerVersionCleanupTimers.get(peerId)
    if (timer === undefined) return
    clearTimeout(timer)
    peerVersionCleanupTimers.delete(peerId)
  }

  const releasePeerVersionRefs = (peerId: string) => {
    cancelPeerVersionCleanup(peerId)
    const peer = peers.get(peerId)
    if (peer?.isConnected) return
    if (peer && !peer.isConnected && peer.pc.connectionState === "closed") {
      archiveCompletedTransfer(peer)
      closeSenderPeer(peer)
      peers.delete(peerId)
    }
    peerVersionRefs.delete(peerId)
    pruneVersions()
    emitPeers()
    emitReceiverStatus()
  }

  const schedulePeerVersionCleanup = (peerId: string) => {
    cancelPeerVersionCleanup(peerId)
    const timer = setTimeout(() => {
      peerVersionCleanupTimers.delete(peerId)
      releasePeerVersionRefs(peerId)
    }, reconnectWindowMs)
    peerVersionCleanupTimers.set(peerId, timer)
  }

  const syncWakeLock = () => {
    const hasActiveTransfer = [...peers.values()].some(isPeerActive)
    if (hasActiveTransfer === wakeLockNeeded) return
    wakeLockNeeded = hasActiveTransfer
    if (wakeLockNeeded) void wakeLock.start()
    else void wakeLock.stop()
  }

  const sendSenderSignal = (message: SignalMessage) => {
    return signalingTransport.send(message)
  }

  const isPeerTransportUsable = (peer: SenderPeerState) =>
    peer.isConnected &&
    peer.dc.readyState === "open" &&
    peer.pc.connectionState !== "closed" &&
    peer.pc.connectionState !== "failed" &&
    peer.pc.connectionState !== "disconnected"

  const canNegotiatePeer = (peer: SenderPeerState) => isSignalingReady && peer.isSignalingConnected

  const getVerificationManifest = async (version: SenderFileVersion): Promise<P2PVerificationManifest> => {
    if (version.verificationManifest) return version.verificationManifest
    if (!version.verificationManifestPromise) {
      const controller = new AbortController()
      version.verificationAbortController = controller
      const manifestPromise = (async () => {
        const hashes: string[] = []
        const blockCount = Math.ceil(version.file.size / verificationBlockSize)
        for (let index = 0; index < blockCount; index += 1) {
          controller.signal.throwIfAborted()
          const start = index * verificationBlockSize
          const end = Math.min(start + verificationBlockSize, version.file.size)
          const bytes = await version.file.slice(start, end).arrayBuffer()
          controller.signal.throwIfAborted()
          hashes[index] = await sha1Hex([bytes])
          controller.signal.throwIfAborted()
        }
        const manifest = { blockSize: verificationBlockSize, hashes }
        version.verificationManifest = manifest
        return manifest
      })().finally(() => {
        if (version.verificationAbortController === controller) {
          version.verificationAbortController = undefined
          if (!version.verificationManifest) version.verificationManifestPromise = undefined
        }
      })
      version.verificationManifestPromise = manifestPromise
    }
    return await version.verificationManifestPromise
  }

  const transferChunkSize = (peer: SenderPeerState): number => {
    const negotiated = peer.pc.sctp?.maxMessageSize
    if (negotiated === 0) return preferredChunkSize
    if (typeof negotiated === "number" && Number.isFinite(negotiated) && negotiated > 0) {
      return Math.max(1, Math.min(preferredChunkSize, Math.floor(negotiated)))
    }
    return chunkSize
  }

  const sendVerificationManifest = async (
    peer: SenderPeerState,
    manifest: P2PVerificationManifest,
    isCurrentOperation: () => boolean,
  ): Promise<boolean> => {
    const messageLengthLimit = p2pControlMessageLengthLimit(peer.pc.sctp?.maxMessageSize)
    const sendControlMessage = async (message: DataMessage): Promise<boolean> => {
      const raw = JSON.stringify(message)
      if (raw.length > messageLengthLimit) {
        throw new Error("The negotiated P2P control message limit is too small for transfer verification.")
      }
      await waitForBufferedAmount(peer.dc)
      if (!isCurrentOperation() || peer.dc.readyState !== "open") return false
      peer.dc.send(raw)
      return true
    }

    for (const message of verificationManifestMessages(manifest, messageLengthLimit)) {
      if (!(await sendControlMessage(message))) return false
    }
    return true
  }

  const sendPeerMeta = (peer: SenderPeerState) => {
    if (peer.isMetaSent || !peer.isPairAuthorized || isPeerComplete(peer) || peer.dc.readyState !== "open") return
    sendData(peer.dc, { type: "meta", meta: fileMeta(currentVersion) })
    const refs = peerVersionRefsFor(peer.peerId)
    if (!refs.current) refs.current = currentVersion
    else if (refs.current.revision !== currentVersion.revision) refs.offered = currentVersion
    peer.isMetaSent = true
    pruneVersions()
  }

  const reportPeerPaired = (peer: SenderPeerState, force = false) => {
    if (isPeerComplete(peer) || (!force && peer.isPairReported)) return
    peer.isPairReported = sendSenderSignal({ type: "receiver-paired", peerId: peer.peerId })
  }

  const reportTransferComplete = (peer: SenderPeerState, force = false) => {
    if (!force && peer.isCompletionReported) return
    peer.isCompletionReported = sendSenderSignal({ type: "transfer-complete", peerId: peer.peerId })
  }

  const senderPeerInfo = (peer: SenderPeerState): P2PSenderPeerInfo => ({
    peerId: peer.peerId,
    file: senderFileInfo(peer.activeVersion || currentVersion),
    browser: peer.browser,
    status: peer.status,
    connectionPhase: senderConnectionPhase(peer),
    connectionRoute: peer.connectionRoute,
    transferStatus: senderTransferStatus(peer),
    progress: peer.progress,
    isConnected: peer.isConnected,
    isWaitingForResume: peer.isWaitingForResume,
    isPaused: isPeerPaused(peer),
    isComplete: isPeerComplete(peer),
  })

  const archiveCompletedTransfer = (peer: SenderPeerState) => {
    if (!isPeerComplete(peer) || !peer.activeVersion) return
    completedTransfers.set(`${peer.activeVersion.revision}:${peer.peerId}`, senderPeerInfo(peer))
  }

  const switchPeerVersion = (peer: SenderPeerState, version: SenderFileVersion) => {
    if (peer.activeVersion?.revision !== version.revision) {
      archiveCompletedTransfer(peer)
      peer.activeVersion = version
      transitionPeer(peer, { kind: "idle" })
      peer.progress = undefined
      peer.progressTracker = undefined
      peer.speedBytesPerSecond = 0
      peer.repairAttempts = 0
    }
    const refs = peerVersionRefsFor(peer.peerId)
    refs.current = version
    if (refs.offered?.revision === version.revision) refs.offered = undefined
    pruneVersions()
  }

  const emitPeers = () => {
    callbacks.onPeersChange([...completedTransfers.values(), ...Array.from(peers.values(), senderPeerInfo)])
  }

  const receiverCountText = (count: number) => `${count} Receiver${count === 1 ? "" : "s"}`

  const emitReceiverStatus = () => {
    const phaseCounts: Record<P2PSenderPeerInfo["connectionPhase"], number> = {
      pairing: 0,
      connected: 0,
      "pairing-retry": 0,
      reconnecting: 0,
      "pairing-failed": 0,
      "reconnect-failed": 0,
      disconnected: 0,
    }
    let transportUsableCount = 0
    let waitingResumeCount = 0
    let remoteSignalingInterruptedCount = 0
    for (const peer of peers.values()) {
      phaseCounts[senderConnectionPhase(peer)] += 1
      if (peer.isWaitingForResume) waitingResumeCount += 1
      if (isPeerTransportUsable(peer)) {
        transportUsableCount += 1
        if (!peer.isSignalingConnected) remoteSignalingInterruptedCount += 1
      }
    }
    const connectedCount = phaseCounts.connected
    const pairingCount = phaseCounts.pairing
    const pairingRetryCount = phaseCounts["pairing-retry"]
    const reconnectingCount = phaseCounts.reconnecting
    const pairingFailedCount = phaseCounts["pairing-failed"]
    const recoveryFailedCount = phaseCounts["reconnect-failed"]

    if (!isSignalingReady) {
      callbacks.onStatus(
        transportUsableCount > 0
          ? "P2P signaling disconnected. Existing transfers continue."
          : "P2P signaling closed. Reconnecting...",
      )
      return
    }

    if (reconnectingCount > 0 || pairingRetryCount > 0) {
      const statusParts: string[] = []
      if (reconnectingCount > 0) {
        statusParts.push(
          reconnectingCount === 1
            ? "Receiver connection interrupted. Reconnecting..."
            : `${receiverCountText(reconnectingCount)} reconnecting...`,
        )
      }
      if (pairingRetryCount > 0) {
        statusParts.push(
          pairingRetryCount === 1
            ? "WebRTC pairing failed. Retrying..."
            : `${receiverCountText(pairingRetryCount)} retrying WebRTC pairing...`,
        )
      }
      callbacks.onStatus(statusParts.join(" "))
      return
    }

    if (recoveryFailedCount > 0 || pairingFailedCount > 0) {
      const statusParts: string[] = []
      if (recoveryFailedCount > 0) {
        statusParts.push(
          recoveryFailedCount === 1
            ? "Connection recovery failed. Waiting for receiver to retry."
            : `${receiverCountText(recoveryFailedCount)} waiting to retry connection recovery.`,
        )
      }
      if (pairingFailedCount > 0) {
        statusParts.push(
          pairingFailedCount === 1
            ? "Unable to establish a WebRTC connection. Waiting for receiver to retry."
            : `${receiverCountText(pairingFailedCount)} failed WebRTC pairing and are waiting to retry.`,
        )
      }
      callbacks.onStatus(statusParts.join(" "))
      return
    }

    if (remoteSignalingInterruptedCount > 0) {
      callbacks.onStatus(
        remoteSignalingInterruptedCount === 1
          ? "Receiver signaling interrupted. Existing transfer continues."
          : `${receiverCountText(remoteSignalingInterruptedCount)} signaling connections interrupted; transfers continue.`,
      )
      return
    }

    if (connectedCount > 0 && pairingCount > 0) {
      callbacks.onStatus(
        `${receiverCountText(connectedCount)} connected. ${receiverCountText(pairingCount)} pairing...`,
      )
      return
    }

    if (pairingCount > 0) {
      callbacks.onStatus(
        pairingCount === 1
          ? "Receiver found. Start WebRTC pairing..."
          : `${receiverCountText(pairingCount)} found. Start WebRTC pairing...`,
      )
      return
    }

    if (connectedCount > 0 && waitingResumeCount > 0) {
      callbacks.onStatus(
        `${receiverCountText(connectedCount)} connected. ${receiverCountText(waitingResumeCount)} waiting to resume.`,
      )
      return
    }

    if (waitingResumeCount > 0) {
      callbacks.onStatus(
        waitingResumeCount === 1
          ? "Receiver disconnected. Waiting for it to resume..."
          : `${receiverCountText(waitingResumeCount)} disconnected. Waiting for them to resume...`,
      )
      return
    }

    callbacks.onStatus(
      connectedCount === 0 ? "Waiting for receiver..." : `${receiverCountText(connectedCount)} connected.`,
    )
  }

  const disconnectPeer = (
    peerId: string,
    preserveComplete = false,
    releaseVersionRefs = false,
    preserveResumable = false,
  ) => {
    cancelPeerRecovery(peerId)
    const peer = peers.get(peerId)
    if (!peer) return
    if (releaseVersionRefs) archiveCompletedTransfer(peer)
    if (!closeSenderPeer(peer, preserveComplete && !releaseVersionRefs, preserveResumable && !releaseVersionRefs)) {
      peers.delete(peerId)
    }
    if (releaseVersionRefs) peerVersionRefs.delete(peerId)
    pruneVersions()
    syncWakeLock()
    emitPeers()
    emitReceiverStatus()
  }

  const disconnectAllPeers = (preserveComplete = false) => {
    for (const peerId of peerRecoveries.keys()) cancelPeerRecovery(peerId)
    for (const [peerId, peer] of peers.entries()) {
      if (!closeSenderPeer(peer, preserveComplete, preserveComplete && peer.isWaitingForResume)) {
        peers.delete(peerId)
      }
    }
    syncWakeLock()
    emitPeers()
  }

  const clearRetainedState = () => {
    for (const peerId of peerRecoveries.keys()) cancelPeerRecovery(peerId)
    for (const timer of peerVersionCleanupTimers.values()) clearTimeout(timer)
    for (const timer of versionCleanupTimers.values()) clearTimeout(timer)
    peerVersionCleanupTimers.clear()
    versionCleanupTimers.clear()
    peerVersionRefs.clear()
    for (const version of versions.values()) releaseFileVersion(version)
    versions.clear()
    completedTransfers.clear()
  }

  const markTransferLimitReached = () => {
    if (isClosed) return
    callbacks.onStatus("Receiver limit reached. Existing receivers can continue.")
    callbacks.onLimitReached?.()
  }

  const finishSenderRuntime = () => {
    isClosed = true
    disconnectAllPeers()
    void wakeLock.stop()
    signalingTransport.close()
    signal?.removeEventListener("abort", close)
    clearRetainedState()
  }

  const close = () => {
    if (isClosed) return
    sendSenderSignal({ type: "sender-leave" })
    finishSenderRuntime()
  }

  const probeRoomBeforeRetry = () => {
    if (roomAvailabilityProbe || isClosed) return
    roomAvailabilityProbe = (async () => {
      if ((await probeP2PRoomAvailability(config, response.name)) === "unavailable") {
        close()
        callbacks.onStatus("P2P room is no longer available. Share session closed.")
        return
      }
      if (!isClosed) signalingTransport.restartReconnect()
    })().finally(() => {
      roomAvailabilityProbe = undefined
    })
  }

  const updateFile = (
    nextFile: File,
    nextVerifyTransfer: boolean,
    nextHighlightLanguage?: string,
    cleanup?: P2PFileCleanup,
  ) => {
    if (isClosed) throw new Error("The P2P share session is closed.")
    currentVersion = createFileVersion(nextFile, nextVerifyTransfer, nextVersionOrder++, nextHighlightLanguage, cleanup)
    versions.set(currentVersion.revision, currentVersion)

    for (const peer of peers.values()) {
      if (!peer.isPairAuthorized || peer.dc.readyState !== "open") continue
      sendData(peer.dc, { type: "file-update", meta: fileMeta(currentVersion) })
      const refs = peerVersionRefsFor(peer.peerId)
      refs.current ??= peer.activeVersion
      refs.offered = currentVersion
      if (isPeerActive(peer) || isPeerPaused(peer)) {
        peer.status = "New file available. Current transfer continues."
      } else {
        peer.status = "File updated. Waiting for receiver."
      }
    }
    pruneVersions()
    callbacks.onStatus("P2P file updated. Existing link is unchanged.")
    emitPeers()
    return senderFileInfo(currentVersion)
  }

  const updateRoomOptions = async (
    nextExpire: string,
    nextMaxTransfers: string,
    updateSignal?: AbortSignal,
  ): Promise<P2PUpdateResponse> => {
    if (isClosed) throw new Error("The P2P share session is closed.")
    const updated = await updateP2PRoom(response, config, nextExpire, nextMaxTransfers, updateSignal)
    response.expireAt = updated.expireAt
    response.expirationSeconds = updated.expirationSeconds
    callbacks.onStatus(
      updated.joinable
        ? "P2P settings updated. Waiting for receivers..."
        : "P2P settings updated. No new receivers can join; existing transfers can continue.",
    )
    return updated
  }

  function cancelPeerRecovery(peerId: string) {
    const recovery = peerRecoveries.get(peerId)
    if (!recovery) return
    if (recovery.timer !== undefined) clearTimeout(recovery.timer)
    peerRecoveries.delete(peerId)
  }

  function deferPeerRecoveryUntilSignaling(peerId?: string) {
    const peerIds = peerId === undefined ? [...peerRecoveries.keys()] : [peerId]
    for (const recoveringPeerId of peerIds) {
      const recovery = peerRecoveries.get(recoveringPeerId)
      if (!recovery) continue
      if (recovery.timer !== undefined) clearTimeout(recovery.timer)
      recovery.timer = undefined
      recovery.policy.reset()
    }
  }

  function failPeerRecovery(peerId: string, recovery: SenderPeerRecovery) {
    if (peerRecoveries.get(peerId) !== recovery) return
    cancelPeerRecovery(peerId)
    const peer = peers.get(peerId)
    if (!peer || isPeerComplete(peer) || peer.isWaitingForResume) return
    invalidateSenderPeerOperation(peer)
    peer.recoveryState = "blocked"
    peer.recoveryRetryToken = uuid()
    transitionPeer(peer, { kind: "paused" })
    peer.speedBytesPerSecond = 0
    if (peer.progress) peer.progress = { ...peer.progress, speedBytesPerSecond: 0 }
    peer.status = peer.hasOpenedDataChannel
      ? "Connection recovery failed. Waiting for receiver to retry."
      : "Unable to establish a WebRTC connection. Waiting for receiver to retry."
    sendSenderSignal({ type: "peer-reconnect-failed", peerId, retryToken: peer.recoveryRetryToken })
    syncWakeLock()
    emitPeers()
    emitReceiverStatus()
  }

  function scheduleNextPeerRecoveryAttempt(peerId: string, recovery: SenderPeerRecovery) {
    if (peerRecoveries.get(peerId) !== recovery || recovery.timer !== undefined || recovery.isAttempting) return
    const peer = peers.get(peerId)
    if (!peer || !canNegotiatePeer(peer)) return
    const delay = recovery.policy.nextDelay()
    if (delay === null) {
      failPeerRecovery(peerId, recovery)
      return
    }
    recovery.timer = setTimeout(() => {
      recovery.timer = undefined
      void attemptPeerRecovery(peerId, recovery)
    }, delay)
  }

  async function attemptPeerRecovery(peerId: string, recovery: SenderPeerRecovery) {
    if (peerRecoveries.get(peerId) !== recovery || recovery.isAttempting || isClosed) return
    const peer = peers.get(peerId)
    if (!peer || isPeerComplete(peer) || peer.isWaitingForResume) {
      cancelPeerRecovery(peerId)
      return
    }
    if (!canNegotiatePeer(peer)) return
    recovery.isAttempting = true
    try {
      await ensurePeer(peerId, peer.userAgent, () => !isClosed && peerRecoveries.get(peerId) === recovery, {
        preserveProgress: true,
        recovering: true,
      })
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      recovery.isAttempting = false
    }
    const currentPeer = peers.get(peerId)
    if (peerRecoveries.get(peerId) === recovery && currentPeer && canNegotiatePeer(currentPeer)) {
      scheduleNextPeerRecoveryAttempt(peerId, recovery)
    }
  }

  function schedulePeerRecovery(peerId: string, immediate = false, explicitRetry = false) {
    const peer = peers.get(peerId)
    if (!peer || isClosed || isPeerComplete(peer) || peer.isWaitingForResume) return
    if (peer.recoveryState === "blocked" && !explicitRetry) return
    if (explicitRetry) {
      peer.recoveryState = "idle"
      peer.recoveryRetryToken = undefined
      transitionPeer(peer, { kind: "idle" })
    }
    invalidateSenderPeerOperation(peer)
    peer.isConnected = false
    peer.recoveryState = "recovering"
    if (!isPeerPaused(peer)) transitionPeer(peer, { kind: "idle" })
    peer.speedBytesPerSecond = 0
    if (peer.progress) peer.progress = { ...peer.progress, speedBytesPerSecond: 0 }
    peer.status = peer.hasOpenedDataChannel
      ? isPeerPaused(peer)
        ? "Paused. Reconnecting to receiver..."
        : "Reconnecting to receiver..."
      : "WebRTC pairing failed. Retrying..."
    syncWakeLock()
    emitPeers()
    emitReceiverStatus()

    let recovery = peerRecoveries.get(peerId)
    if (!recovery) {
      recovery = { policy: new P2PReconnectPolicy(), isAttempting: false }
      peerRecoveries.set(peerId, recovery)
    }
    if (recovery.isAttempting) return
    if (recovery.timer !== undefined) {
      if (!immediate) return
      clearTimeout(recovery.timer)
    }
    const scheduledRecovery = recovery
    scheduledRecovery.timer = setTimeout(
      () => {
        scheduledRecovery.timer = undefined
        void attemptPeerRecovery(peerId, scheduledRecovery)
      },
      immediate ? 0 : P2P_RTC_DISCONNECT_GRACE_MS,
    )
  }

  async function ensurePeer(
    peerId: string,
    userAgent?: string,
    isCurrent: () => boolean = () => !isClosed,
    options: EnsurePeerOptions = {},
  ) {
    if (!isCurrent()) return
    cancelPeerVersionCleanup(peerId)
    const existingPeer = peers.get(peerId)
    if (
      existingPeer &&
      isPeerComplete(existingPeer) &&
      existingPeer.activeVersion?.revision === currentVersion.revision
    ) {
      emitPeers()
      emitReceiverStatus()
      return
    }
    const preserveExisting = existingPeer && (existingPeer.isWaitingForResume || options.preserveProgress)
    const resumableProgress = preserveExisting ? existingPeer.progress : undefined
    const resumableVersion = preserveExisting ? existingPeer.activeVersion : undefined
    const preservedPausedState = options.preserveProgress && existingPeer ? isPeerPaused(existingPeer) : false
    const hasOpenedDataChannel = existingPeer?.hasOpenedDataChannel ?? false
    const effectiveUserAgent = userAgent ?? existingPeer?.userAgent
    if (existingPeer && isPeerComplete(existingPeer)) archiveCompletedTransfer(existingPeer)
    if (existingPeer) {
      closeSenderPeer(existingPeer)
      peers.delete(peerId)
    }
    if (!isCurrent()) return
    const pc = new RTCPeerConnection(rtcConfig(iceServers))
    const dc = pc.createDataChannel("file", { ordered: true })
    const negotiationId = uuid()
    const peer: SenderPeerState = {
      peerId,
      userAgent: effectiveUserAgent,
      browser: browserLabel(effectiveUserAgent),
      pc,
      dc,
      iceCandidates: new P2PIceCandidateBuffer(),
      negotiationId,
      signalingConnectionId: options.signalingConnectionId ?? existingPeer?.signalingConnectionId,
      status: options.recovering
        ? hasOpenedDataChannel
          ? preservedPausedState
            ? "Paused. Reconnecting to receiver..."
            : "Reconnecting to receiver..."
          : "WebRTC pairing failed. Retrying..."
        : "Pairing...",
      isConnected: false,
      hasOpenedDataChannel,
      isSignalingConnected: true,
      isWaitingForResume: false,
      recoveryState: options.recovering === true ? "recovering" : "idle",
      recoveryRetryToken: existingPeer?.recoveryRetryToken,
      transferState: preservedPausedState ? { kind: "paused" } : { kind: "idle" },
      isPairReported: false,
      isPairAuthorized: false,
      isMetaSent: false,
      isCompletionReported: false,
      operationGeneration: 0,
      speedBytesPerSecond: 0,
      progress: resumableProgress,
      progressTracker: resumableProgress ? createSpeedTracker(resumableProgress.doneBytes) : undefined,
      activeVersion: resumableVersion,
      repairAttempts: existingPeer?.repairAttempts ?? 0,
    }
    peers.set(peerId, peer)
    const isPeerCurrent = () => !isClosed && peers.get(peerId) === peer
    const refreshConnectionRoute = async () => {
      const route = await selectedP2PConnectionRoute(pc).catch(() => undefined)
      if (!isPeerCurrent() || !route || peer.connectionRoute === route) return
      peer.connectionRoute = route
      emitPeers()
    }
    emitPeers()
    emitReceiverStatus()

    pc.onicecandidate = (event) => {
      if (isPeerCurrent() && event.candidate) {
        sendSenderSignal({ type: "candidate", peerId, candidate: event.candidate.toJSON(), negotiationId })
      }
    }
    pc.oniceconnectionstatechange = () => {
      if (isPeerCurrent() && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")) {
        void refreshConnectionRoute()
      }
    }
    pc.onconnectionstatechange = () => {
      if (!isPeerCurrent()) return
      if (isPeerComplete(peer)) {
        emitPeers()
        emitReceiverStatus()
        return
      }
      if (pc.connectionState === "connected") {
        cancelPeerRecovery(peerId)
        reportPeerPaired(peer)
        void refreshConnectionRoute()
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        schedulePeerRecovery(peerId, pc.connectionState === "failed")
        return
      } else {
        emitPeers()
        return
      }
      emitPeers()
      emitReceiverStatus()
    }

    dc.binaryType = "arraybuffer"
    dc.onopen = () => {
      if (!isPeerCurrent()) return
      if (isPeerComplete(peer)) {
        emitPeers()
        emitReceiverStatus()
        return
      }
      cancelPeerRecovery(peerId)
      peer.isConnected = true
      peer.hasOpenedDataChannel = true
      peer.isWaitingForResume = false
      peer.recoveryState = "idle"
      peer.recoveryRetryToken = undefined
      peer.status = isPeerPaused(peer)
        ? "Paused by receiver."
        : peer.isPairAuthorized
          ? "Receiver connected."
          : "Authorizing receiver..."
      reportPeerPaired(peer)
      sendPeerMeta(peer)
      void refreshConnectionRoute()
      emitPeers()
      emitReceiverStatus()
    }
    dc.onclose = () => {
      if (!isPeerCurrent() || isPeerComplete(peer)) return
      schedulePeerRecovery(peerId, true)
    }
    dc.onerror = () => {
      if (!isPeerCurrent() || isPeerComplete(peer)) return
      schedulePeerRecovery(peerId, true)
    }
    dc.onmessage = (event) => {
      if (!isPeerCurrent()) return
      if (typeof event.data !== "string") return
      let message: DataMessage
      try {
        message = parseP2PDataMessage(event.data, "receiver")
      } catch (error) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (message.type === "download") {
        const version = message.revision ? versions.get(message.revision) : currentVersion
        if (version) void sendFileToPeer(peer, version, message.offset)
        else sendData(peer.dc, { type: "error", message: "The requested file version is no longer available." })
      }
      if (message.type === "progress") {
        const version = message.revision ? versions.get(message.revision) : peer.activeVersion || currentVersion
        if (!version) return
        if (message.revision && message.revision !== version.revision) return
        switchPeerVersion(peer, version)
        const { file: activeFile, verifyTransfer: verifyActiveTransfer } = version
        const doneBytes = Math.min(Math.max(Math.floor(message.doneBytes || 0), 0), activeFile.size)
        peer.progressTracker ??= createSpeedTracker(doneBytes)
        peer.speedBytesPerSecond = measureSpeed(peer.progressTracker, doneBytes, doneBytes >= activeFile.size)
        peer.progress = { doneBytes, totalBytes: activeFile.size, speedBytesPerSecond: peer.speedBytesPerSecond }
        if (doneBytes >= activeFile.size && !verifyActiveTransfer) {
          peer.status = "Waiting for receiver to finish..."
        } else if (doneBytes >= activeFile.size && verifyActiveTransfer) {
          transitionPeer(peer, { kind: "verifying" })
        }
        emitPeers()
      }
      if (message.type === "repair-request") {
        void resendBlocksToPeer(peer, message.indices)
      }
      if (message.type === "verified") {
        const activeFile = peer.activeVersion?.file
        invalidateSenderPeerOperation(peer)
        transitionPeer(peer, { kind: "verifying" })
        peer.status = "Receiver verified. Finalizing transfer..."
        if (peer.progress && activeFile) {
          peer.progress = { ...peer.progress, doneBytes: activeFile.size, speedBytesPerSecond: 0 }
        }
        syncWakeLock()
        emitPeers()
      }
      if (message.type === "received") {
        const version = message.revision ? versions.get(message.revision) : peer.activeVersion
        if (!version || version !== peer.activeVersion) return
        invalidateSenderPeerOperation(peer)
        transitionPeer(peer, { kind: "complete" })
        peer.status = version.verifyTransfer ? "Transfer verified." : "Transfer complete."
        peer.progress = { doneBytes: version.file.size, totalBytes: version.file.size, speedBytesPerSecond: 0 }
        reportTransferComplete(peer)
        syncWakeLock()
        emitPeers()
      }
      if (message.type === "pause" && !isPeerComplete(peer)) {
        invalidateSenderPeerOperation(peer)
        transitionPeer(peer, { kind: "paused" })
        peer.speedBytesPerSecond = 0
        if (peer.progress) peer.progress = { ...peer.progress, speedBytesPerSecond: 0 }
        peer.status = "Paused by receiver."
        sendData(peer.dc, { type: "paused" })
        syncWakeLock()
        emitPeers()
      }
      if (message.type === "stop") {
        invalidateSenderPeerOperation(peer)
        transitionPeer(peer, { kind: "idle" })
        peer.speedBytesPerSecond = 0
        peer.progressTracker = undefined
        peer.progress = undefined
        peer.activeVersion = undefined
        peer.status = "Transfer terminated by receiver."
        sendData(peer.dc, { type: "stopped" })
        syncWakeLock()
        emitPeers()
      }
    }

    const offer = await pc.createOffer()
    if (!isCurrent() || peers.get(peerId) !== peer) return
    await pc.setLocalDescription(offer)
    if (!isCurrent() || peers.get(peerId) !== peer) return
    sendSenderSignal({ type: "offer", peerId, sdp: offer, negotiationId })
  }

  const markPeerSignalingDisconnected = (peer: SenderPeerState) => {
    peer.isSignalingConnected = false
    if (isPeerTransportUsable(peer) && peer.recoveryState !== "recovering" && !isPeerComplete(peer)) {
      peer.status = isPeerPaused(peer)
        ? "Paused by receiver. Signaling reconnecting..."
        : "Signaling interrupted. Transfer continues."
    }
  }

  const reconcileSignalingPeer = async (
    peerId: string,
    userAgent?: string,
    connectionId?: string,
    isCurrent: () => boolean = () => !isClosed,
  ) => {
    if (!isCurrent()) return
    const existing = peers.get(peerId)
    if (!existing) {
      await ensurePeer(peerId, userAgent, isCurrent, { signalingConnectionId: connectionId })
      return
    }

    cancelPeerVersionCleanup(peerId)
    const signalingEndpointChanged = connectionId !== undefined && connectionId !== existing.signalingConnectionId
    existing.isSignalingConnected = true
    existing.signalingConnectionId = connectionId
    if (signalingEndpointChanged) peerRecoveries.get(peerId)?.policy.reset()
    if (userAgent) {
      existing.userAgent = userAgent
      existing.browser = browserLabel(userAgent)
    }
    if (isPeerComplete(existing)) {
      reportTransferComplete(existing, true)
      emitPeers()
      return
    }
    if (isPeerTransportUsable(existing)) {
      existing.status = isPeerPaused(existing)
        ? "Paused by receiver."
        : existing.isPairAuthorized
          ? "Receiver connected."
          : "Authorizing receiver..."
      reportPeerPaired(existing, true)
      sendPeerMeta(existing)
      emitPeers()
      emitReceiverStatus()
      return
    }
    if (signalingEndpointChanged) {
      schedulePeerRecovery(peerId, true, true)
      return
    }
    if (existing.recoveryState === "blocked") {
      emitPeers()
      emitReceiverStatus()
      return
    }
    if (existing.recoveryState === "recovering" || peerRecoveries.has(peerId)) {
      schedulePeerRecovery(peerId, true)
      return
    }

    const preserveProgress = Boolean(existing.progress) || isPeerPaused(existing) || existing.isWaitingForResume
    await ensurePeer(peerId, userAgent, isCurrent, {
      preserveProgress,
      recovering: preserveProgress,
    })
  }

  async function addCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peer = peers.get(peerId)
    if (!peer) return
    await peer.iceCandidates.addOrBuffer(peer.pc, candidate, () => !isClosed && peers.get(peerId) === peer)
  }

  async function flushCandidates(peer: SenderPeerState, isCurrent: () => boolean = () => !isClosed) {
    await peer.iceCandidates.flush(peer.pc, () => isCurrent() && peers.get(peer.peerId) === peer)
  }

  async function sendFileToPeer(peer: SenderPeerState, version: SenderFileVersion, rawOffset: number) {
    if (!peer.isPairAuthorized || peer.dc.readyState !== "open") return
    const operationGeneration = invalidateSenderPeerOperation(peer)
    const isCurrentOperation = () => peer.operationGeneration === operationGeneration && peers.get(peer.peerId) === peer
    const { file: activeFile, verifyTransfer: verifyActiveTransfer } = version
    const offset = Math.min(Math.max(Math.floor(rawOffset || 0), 0), activeFile.size)
    switchPeerVersion(peer, version)
    transitionPeer(peer, { kind: "uploading" })
    peer.speedBytesPerSecond = 0
    peer.progressTracker = createSpeedTracker(offset)
    peer.status = offset > 0 ? "Resuming transfer..." : "Sending file..."
    syncWakeLock()
    emitPeers()
    const streamedHashState: BlockHashState | undefined =
      verifyActiveTransfer && offset === 0 && !version.verificationManifest && !version.verificationManifestPromise
        ? {
            index: 0,
            size: 0,
            buffer: new Uint8Array(0),
            hashes: [],
          }
        : undefined

    try {
      let queuedBytes = offset
      const completed = await streamBlobToDataChannel({
        blob: activeFile.slice(offset),
        channel: peer.dc,
        chunkSize: transferChunkSize(peer),
        shouldContinue: () => isCurrentOperation() && isPeerSending(peer),
        onReaderChange: (reader, active) => {
          if (active) peer.activeReader = reader
          else if (peer.activeReader === reader) peer.activeReader = undefined
        },
        onChunkSent: async (chunk) => {
          queuedBytes += chunk.byteLength
          if (streamedHashState) await appendHashData(streamedHashState, chunk)
        },
      })

      if (
        completed &&
        isCurrentOperation() &&
        !isPeerPaused(peer) &&
        queuedBytes >= activeFile.size &&
        peer.dc.readyState === "open"
      ) {
        if (verifyActiveTransfer) {
          if (streamedHashState && !version.verificationManifest) {
            const hashes = await finishHashData(streamedHashState)
            version.verificationManifest = { blockSize: verificationBlockSize, hashes }
          }
          const verification = await getVerificationManifest(version)
          if (!isCurrentOperation() || isPeerPaused(peer) || peer.dc.readyState !== "open") return
          if (!(await sendVerificationManifest(peer, verification, isCurrentOperation))) return
          transitionPeer(peer, { kind: "verifying" })
          peer.status = "Waiting for receiver to verify..."
        } else {
          sendData(peer.dc, { type: "done" })
          peer.status = "Waiting for receiver to finish..."
        }
      }
    } catch (error) {
      if (!isCurrentOperation()) return
      const err = error instanceof Error ? error : new Error(String(error))
      sendData(peer.dc, { type: "error", message: err.message })
      callbacks.onError(err)
    } finally {
      if (isCurrentOperation()) {
        if (isPeerSending(peer)) transitionPeer(peer, { kind: "idle" })
        syncWakeLock()
        emitPeers()
      }
    }
  }

  async function resendBlocksToPeer(peer: SenderPeerState, indices: number[]) {
    if (!peer.isPairAuthorized || peer.dc.readyState !== "open" || !isPeerVerifying(peer)) return
    const version = peer.activeVersion
    if (!version?.verifyTransfer || !version.verificationManifest) return
    const { file: activeFile } = version
    const validIndices = verificationHashIndices(version.verificationManifest, indices)
    if (validIndices.length === 0) return
    if (peer.repairAttempts >= maxVerificationRepairAttempts) {
      sendData(peer.dc, { type: "error", message: "P2P verification repair limit reached." })
      return
    }
    peer.repairAttempts += 1
    const operationGeneration = invalidateSenderPeerOperation(peer)
    const isCurrentOperation = () => peer.operationGeneration === operationGeneration && peers.get(peer.peerId) === peer
    peer.status = `Resending ${validIndices.length} verification block${validIndices.length === 1 ? "" : "s"}...`
    transitionPeer(peer, { kind: "repairing" })
    syncWakeLock()
    emitPeers()

    try {
      for (const index of validIndices) {
        if (!isCurrentOperation()) return
        if (peer.dc.readyState !== "open") return
        const start = index * verificationBlockSize
        const end = Math.min(start + verificationBlockSize, activeFile.size)
        sendData(peer.dc, { type: "repair-start", index, size: end - start })
        const completed = await streamBlobToDataChannel({
          blob: activeFile.slice(start, end),
          channel: peer.dc,
          chunkSize: transferChunkSize(peer),
          shouldContinue: isCurrentOperation,
          onReaderChange: (reader, active) => {
            if (active) peer.activeReader = reader
            else if (peer.activeReader === reader) peer.activeReader = undefined
          },
        })
        if (!completed || !isCurrentOperation()) return
        sendData(peer.dc, { type: "repair-end", index })
        emitPeers()
      }
      if (!isCurrentOperation()) return
      transitionPeer(peer, { kind: "verifying" })
      peer.status = "Waiting for receiver to verify..."
      syncWakeLock()
      emitPeers()
    } catch (error) {
      if (!isCurrentOperation()) return
      transitionPeer(peer, { kind: "idle" })
      syncWakeLock()
      const err = error instanceof Error ? error : new Error(String(error))
      sendData(peer.dc, { type: "error", message: err.message })
      callbacks.onError(err)
    }
  }

  const signalingTransport: P2PSignalingTransport = createP2PSignalingTransport({
    url: wsUrl(config, response.name, "sender", { token: response.senderToken }),
    shouldReconnect: () => !isClosed,
    onOpen: (isReconnect) => {
      callbacks.onStatus(isReconnect ? "P2P signaling reconnected. Synchronizing..." : "Waiting for receiver...")
    },
    onSocketError: () => {
      isSignalingReady = false
      deferPeerRecoveryUntilSignaling()
      emitReceiverStatus()
    },
    onClose: () => {
      isSignalingReady = false
      deferPeerRecoveryUntilSignaling()
      emitPeers()
      emitReceiverStatus()
    },
    onReconnectExhausted: () => {
      const hasRetainedTransfer = [...peers.values()].some(
        (peer) =>
          isPeerTransportUsable(peer) ||
          peer.recoveryState === "recovering" ||
          peer.isWaitingForResume ||
          isPeerComplete(peer) ||
          peer.progress !== undefined,
      )
      if (hasRetainedTransfer) {
        callbacks.onStatus(
          [...peers.values()].some(isPeerTransportUsable)
            ? "P2P signaling is still unavailable. Existing transfers continue while retrying."
            : "P2P signaling is still unavailable. Retrying to preserve resumable transfers...",
        )
        probeRoomBeforeRetry()
        return
      }
      finishSenderRuntime()
      callbacks.onStatus("Unable to restore P2P signaling. Share session closed.")
    },
    onImmediateMessage: (message) => {
      if (message.type === "transfer-limit-complete") {
        markTransferLimitReached()
        return true
      }
      if (message.type === "room-options-updated") {
        callbacks.onStatus(
          message.joinable
            ? "P2P settings updated. Waiting for receivers..."
            : "No new receivers can join. Existing receivers can continue.",
        )
        return true
      }
      return false
    },
    onMessage: async (message, isCurrentSocket) => {
      if (message.type === "ready") {
        isSignalingReady = true
        signalingTransport.resetReconnect()
        if ("iceServers" in message) {
          iceServers = message.iceServers
          callbacks.onIceServersChange?.(iceServers)
        }
        const connectedReceiverIds = new Set(message.peers.receivers.map((receiver) => receiver.peerId))
        for (const peer of peers.values()) {
          if (!connectedReceiverIds.has(peer.peerId)) markPeerSignalingDisconnected(peer)
        }
        for (const receiver of message.peers.receivers) {
          if (!isCurrentSocket()) return
          await reconcileSignalingPeer(receiver.peerId, receiver.userAgent, receiver.connectionId, isCurrentSocket)
        }
        for (const peer of peers.values()) {
          if (!isCurrentSocket()) return
          if (isPeerComplete(peer) && !connectedReceiverIds.has(peer.peerId)) reportTransferComplete(peer, true)
          if (peer.recoveryState === "recovering" && peer.isSignalingConnected) {
            schedulePeerRecovery(peer.peerId, true)
          }
        }
        for (const peerId of peerVersionRefs.keys()) {
          if (!connectedReceiverIds.has(peerId) && !peers.has(peerId)) {
            schedulePeerVersionCleanup(peerId)
          }
        }
        emitPeers()
        emitReceiverStatus()
      }
      if (message.type === "peer-joined" && message.role === "receiver" && message.peerId) {
        if ("iceServers" in message) {
          iceServers = message.iceServers
          callbacks.onIceServersChange?.(iceServers)
        }
        await reconcileSignalingPeer(message.peerId, message.userAgent, message.connectionId, isCurrentSocket)
      }
      if (message.type === "peer-signaling-disconnected" && message.role === "receiver" && message.peerId) {
        const peer = peers.get(message.peerId)
        if (peer) {
          if (
            message.connectionId &&
            peer.signalingConnectionId &&
            message.connectionId !== peer.signalingConnectionId
          ) {
            return
          }
          markPeerSignalingDisconnected(peer)
          deferPeerRecoveryUntilSignaling(message.peerId)
          emitPeers()
          emitReceiverStatus()
        }
      }
      if (message.type === "peer-reconnect-request" && message.peerId && isCurrentSocket()) {
        const peer = peers.get(message.peerId)
        if (!peer) return
        if (message.retryToken !== undefined) {
          if (message.retryToken !== peer.recoveryRetryToken) return
          schedulePeerRecovery(message.peerId, true, true)
          return
        }
        if (peer.recoveryState !== "blocked") schedulePeerRecovery(message.peerId, true)
      }
      if (message.type === "answer") {
        const peer = peers.get(message.peerId)
        if (!peer || !isCurrentSocket() || (message.negotiationId && message.negotiationId !== peer.negotiationId))
          return
        await peer.pc.setRemoteDescription(message.sdp)
        if (!isCurrentSocket() || peers.get(message.peerId) !== peer) return
        await flushCandidates(peer, isCurrentSocket)
      }
      if (message.type === "candidate" && isCurrentSocket()) {
        const peer = peers.get(message.peerId)
        if (peer && (!message.negotiationId || message.negotiationId === peer.negotiationId)) {
          await addCandidate(message.peerId, message.candidate)
        }
      }
      if (message.type === "receiver-pair-result") {
        const peer = peers.get(message.peerId)
        if (!peer) return
        if (!message.accepted) {
          cancelPeerVersionCleanup(message.peerId)
          disconnectPeer(message.peerId, false, true)
          return
        }
        peer.isPairAuthorized = true
        peer.status = isPeerPaused(peer)
          ? "Paused by receiver."
          : peer.recoveryState === "recovering"
            ? "Reconnecting to receiver..."
            : "Receiver connected."
        sendPeerMeta(peer)
        emitPeers()
        emitReceiverStatus()
      }
      if (message.type === "peer-left" && message.role === "receiver" && message.peerId) {
        if (message.resumable) {
          cancelPeerVersionCleanup(message.peerId)
          disconnectPeer(message.peerId, true, false, true)
        } else {
          disconnectPeer(message.peerId, true)
          schedulePeerVersionCleanup(message.peerId)
        }
      }
    },
    onError: callbacks.onError,
  })

  signal?.throwIfAborted()
  signal?.addEventListener("abort", close, { once: true })
  signalingTransport.connect()

  return {
    response,
    get currentFile() {
      return senderFileInfo(currentVersion)
    },
    updateRoomOptions,
    updateFile,
    close,
  }
}
