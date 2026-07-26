import { jsonResponse, timingSafeEqual } from "../common.js"
import {
  P2P_HEARTBEAT_INTERVAL_MS,
  P2P_HEARTBEAT_TIMEOUT_MS,
  P2P_SIGNAL_RECONNECT_GRACE_MS,
} from "../../shared/constants.js"
import { isUuid } from "../../shared/verify.js"
import type { P2PIceServer, P2PUpdateResponse } from "../../shared/interfaces.js"
import { isP2PIceServer, isP2PSignalMessage, type P2PSignalMessage } from "../../shared/p2pSignal.js"
import {
  getTurnIceServers,
  handleTurnCredentialCacheRequest,
  MIN_TURN_CREDENTIALS_REMAINING_MS,
} from "./turnCredentials.js"
import {
  canAddReceiverFromStorage,
  CREATED_AT_KEY,
  EXPIRES_AT_KEY,
  ICE_SERVERS_EXPIRES_AT_KEY,
  ICE_SERVERS_KEY,
  MAX_TRANSFERS_KEY,
  PAIRED_RECEIVER_IDS_KEY,
  RECEIVER_CLEANUP_AT_KEY,
  RESUMABLE_RECEIVER_IDS_KEY,
  ROOM_TTL_MS,
  SENDER_TOKEN_KEY,
  storedReceiverDeadlines,
  storedRoomExpiresAt,
  storedStringIds,
  SUCCESSFUL_RECEIVER_IDS_KEY,
  P2PRoomMembershipStore,
  type P2PRoomInit,
  type P2PRoomStatus,
  type P2PRoomUpdate,
} from "./roomState.js"

const MAX_P2P_SIGNAL_BYTES = 256 * 1024
const RECEIVER_RECONNECT_GRACE_MS = P2P_SIGNAL_RECONNECT_GRACE_MS
type P2PRole = "sender" | "receiver"

function isUuidValue(value: unknown): value is string {
  return isUuid(typeof value === "string" ? value : null)
}

function isValidP2PClientSignalMessage(value: unknown): value is P2PSignalMessage {
  if (!isP2PSignalMessage(value)) return false

  if ("negotiationId" in value && value.negotiationId !== undefined && !isUuidValue(value.negotiationId)) {
    return false
  }
  if ("retryToken" in value && value.retryToken !== undefined && !isUuidValue(value.retryToken)) {
    return false
  }

  if (value.type === "ping" || value.type === "pong") return true
  if (
    value.type === "transfer-checkpoint" ||
    value.type === "transfer-checkpoint-clear" ||
    value.type === "transfer-abandon" ||
    value.type === "sender-leave"
  ) {
    return true
  }
  if (value.type === "peer-reconnect-request") {
    return value.peerId === undefined || isUuidValue(value.peerId)
  }

  if (!("peerId" in value) || !isUuidValue(value.peerId)) return false
  return (
    value.type === "offer" ||
    value.type === "answer" ||
    value.type === "candidate" ||
    value.type === "receiver-paired" ||
    value.type === "transfer-complete" ||
    value.type === "peer-reconnect-failed"
  )
}

interface P2PReceiver {
  socket: WebSocket
  userAgent: string
  connectionId?: string
  connectedAt: number
}

interface P2PWebSocketAttachment {
  role: P2PRole
  peerId?: string
  userAgent?: string
  connectionId?: string
  connectedAt?: number
  lastPingAt?: number
  lastPongAt?: number
}

export class P2PRoom {
  private sender?: WebSocket
  private senderConnectedAt = 0
  private latestConnectionAt = 0
  private receivers = new Map<string, P2PReceiver>()
  private storageMutationQueue: Promise<void> = Promise.resolve()
  private readonly membership: P2PRoomMembershipStore

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.membership = new P2PRoomMembershipStore(state.storage)
    for (const socket of state.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue
      const attachment = this.webSocketAttachment(socket)
      if (!attachment) {
        socket.close(1008, "invalid socket attachment")
      } else if (attachment.role === "sender") {
        const connectedAt = attachment.connectedAt ?? 0
        this.latestConnectionAt = Math.max(this.latestConnectionAt, connectedAt)
        if (!this.sender) {
          this.sender = socket
          this.senderConnectedAt = connectedAt
        } else if (connectedAt > this.senderConnectedAt) {
          const stale = this.sender
          this.sender = socket
          this.senderConnectedAt = connectedAt
          stale.close(1001, "sender reconnected")
        } else {
          socket.close(1008, "duplicate sender")
        }
      } else if (attachment.peerId) {
        const connectedAt = attachment.connectedAt ?? 0
        this.latestConnectionAt = Math.max(this.latestConnectionAt, connectedAt)
        const existing = this.receivers.get(attachment.peerId)
        if (!existing || connectedAt > existing.connectedAt) {
          this.receivers.set(attachment.peerId, {
            socket,
            userAgent: attachment.userAgent ?? "",
            connectionId: attachment.connectionId,
            connectedAt,
          })
          existing?.socket.close(1001, "peer reconnected")
        } else {
          socket.close(1008, "duplicate receiver")
        }
      }
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    this.sendHeartbeat(now)
    const receiverCleanupAt = await this.cleanupExpiredReceivers(now)
    const stored = await this.state.storage.get([EXPIRES_AT_KEY, CREATED_AT_KEY])
    const expiresAt = storedRoomExpiresAt(stored)
    if (!this.sender && now >= expiresAt) {
      await this.closeRoomAfterSenderLeft()
      return
    }

    const roomAlarmAt = !this.sender ? expiresAt : undefined
    const heartbeatAt = this.hasOpenSockets() ? now + P2P_HEARTBEAT_INTERVAL_MS : undefined
    const scheduledAlarmAt = [roomAlarmAt, receiverCleanupAt, heartbeatAt]
      .filter((value): value is number => value !== undefined)
      .reduce<number | undefined>(
        (earliest, value) => (earliest === undefined ? value : Math.min(earliest, value)),
        undefined,
      )
    if (scheduledAlarmAt !== undefined && scheduledAlarmAt > now) await this.state.storage.setAlarm(scheduledAlarmAt)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/turn-cache") {
      return await handleTurnCredentialCacheRequest(this.state, request)
    }
    if (url.pathname === "/init" && request.method === "POST") {
      const init = await this.readInit(request)
      await this.initRoom(init)
      return jsonResponse({ ok: true })
    }
    if (url.pathname === "/update" && request.method === "POST") {
      return await this.updateRoom(request)
    }
    if (url.pathname === "/status") {
      return jsonResponse(await this.status())
    }
    if (url.pathname === "/ws" || /^\/p2p\/ws\/[^/]+$/.test(url.pathname)) {
      return await this.handleWebSocket(request, url)
    }
    return new Response("not found", { status: 404 })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return
    const attachment = this.webSocketAttachment(socket)
    if (!attachment) return
    if (attachment.role === "sender" && this.sender !== socket) return
    if (
      attachment.role === "receiver" &&
      (!attachment.peerId || this.receivers.get(attachment.peerId)?.socket !== socket)
    ) {
      return
    }
    await this.forward(socket, attachment.role, message, attachment.peerId)
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.disconnect(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.disconnect(socket)
  }

  private async readInit(request: Request): Promise<P2PRoomInit> {
    try {
      const init: unknown = await request.json()
      if (typeof init !== "object" || init === null) return {}
      const iceServers = (init as P2PRoomInit).iceServers
      const iceServersExpiresAt = (init as P2PRoomInit).iceServersExpiresAt
      const senderToken = (init as P2PRoomInit).senderToken
      const expiresAt = (init as P2PRoomInit).expiresAt
      const maxTransfers = (init as P2PRoomInit).maxTransfers
      return {
        ...(Array.isArray(iceServers) && iceServers.every(isP2PIceServer) ? { iceServers } : {}),
        ...(typeof iceServersExpiresAt === "number" && Number.isFinite(iceServersExpiresAt)
          ? { iceServersExpiresAt }
          : {}),
        ...(typeof senderToken === "string" && senderToken.length > 0 ? { senderToken } : {}),
        ...(typeof expiresAt === "number" && Number.isFinite(expiresAt) ? { expiresAt } : {}),
        ...(typeof maxTransfers === "number" && Number.isSafeInteger(maxTransfers) && maxTransfers >= 0
          ? { maxTransfers }
          : {}),
      }
    } catch {
      return {}
    }
  }

  private async status(): Promise<P2PRoomStatus> {
    const stored = await this.state.storage.get([
      CREATED_AT_KEY,
      EXPIRES_AT_KEY,
      MAX_TRANSFERS_KEY,
      PAIRED_RECEIVER_IDS_KEY,
      RESUMABLE_RECEIVER_IDS_KEY,
      SUCCESSFUL_RECEIVER_IDS_KEY,
      RECEIVER_CLEANUP_AT_KEY,
    ])
    const expiresAt = storedRoomExpiresAt(stored)
    const createdAt = stored.get(CREATED_AT_KEY)
    const unexpired = typeof createdAt === "number" && Date.now() < expiresAt
    const joinable = unexpired && canAddReceiverFromStorage(stored)
    const hasSender = this.sender !== undefined
    const hasReceiver =
      this.receivers.size > 0 || Object.keys(storedReceiverDeadlines(stored.get(RECEIVER_CLEANUP_AT_KEY))).length > 0
    return {
      active: unexpired || hasSender || hasReceiver,
      joinable,
      hasSender,
      hasReceiver,
    }
  }

  private async handleWebSocket(request: Request, url: URL): Promise<Response> {
    const role = url.searchParams.get("role") as P2PRole | null
    if (role !== "sender" && role !== "receiver") {
      return new Response("role must be sender or receiver", { status: 400 })
    }
    const peerId = role === "receiver" ? url.searchParams.get("peerId") : null
    if (role === "receiver" && !isUuid(peerId)) {
      return new Response("receiver peerId must be a UUID", { status: 400 })
    }
    if (role === "sender" && !(await this.isValidSenderToken(url.searchParams.get("token")))) {
      return new Response("invalid sender token", { status: 403 })
    }
    const receiverAdmission =
      role === "receiver"
        ? await this.state.storage.get([
            CREATED_AT_KEY,
            EXPIRES_AT_KEY,
            MAX_TRANSFERS_KEY,
            PAIRED_RECEIVER_IDS_KEY,
            RESUMABLE_RECEIVER_IDS_KEY,
            SUCCESSFUL_RECEIVER_IDS_KEY,
            RECEIVER_CLEANUP_AT_KEY,
          ])
        : undefined
    const isCompletedReceiver =
      role === "receiver" &&
      peerId !== null &&
      storedStringIds(receiverAdmission?.get(SUCCESSFUL_RECEIVER_IDS_KEY)).includes(peerId)
    if (isCompletedReceiver) {
      return new Response("P2P receiver transfer already completed", { status: 429 })
    }
    const isReceiverReconnect =
      role === "receiver" &&
      peerId !== null &&
      (this.receivers.has(peerId) ||
        (storedReceiverDeadlines(receiverAdmission?.get(RECEIVER_CLEANUP_AT_KEY))[peerId] ?? 0) > Date.now() ||
        storedStringIds(receiverAdmission?.get(RESUMABLE_RECEIVER_IDS_KEY)).includes(peerId))
    if (
      role === "receiver" &&
      !isReceiverReconnect &&
      receiverAdmission &&
      Date.now() >= storedRoomExpiresAt(receiverAdmission)
    ) {
      return new Response("P2P link expired", { status: 410 })
    }
    if (
      role === "receiver" &&
      !isReceiverReconnect &&
      receiverAdmission &&
      !canAddReceiverFromStorage(receiverAdmission, peerId ?? undefined)
    ) {
      return new Response("P2P receiver limit reached", { status: 429 })
    }
    const staleReceiverSocket = role === "receiver" && peerId ? this.receivers.get(peerId)?.socket : undefined
    const staleSenderSocket = role === "sender" ? this.sender : undefined

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const userAgent = request.headers.get("User-Agent") || ""
    const connectedAt = Math.max(Date.now(), this.latestConnectionAt + 1)
    this.latestConnectionAt = connectedAt
    const connectionId = role === "receiver" ? crypto.randomUUID() : undefined
    server.serializeAttachment({
      role,
      peerId: peerId ?? undefined,
      userAgent: role === "receiver" ? userAgent : undefined,
      connectionId,
      connectedAt,
      lastPongAt: connectedAt,
    } satisfies P2PWebSocketAttachment)
    this.state.acceptWebSocket(server)

    if (role === "sender") {
      this.sender = server
      this.senderConnectedAt = connectedAt
      staleSenderSocket?.close(1001, "sender reconnected")
    } else {
      this.receivers.set(peerId!, {
        socket: server,
        userAgent,
        connectionId,
        connectedAt,
      })
      staleReceiverSocket?.close(1001, "peer reconnected")
      await this.cancelReceiverCleanup(peerId!)
    }

    const iceServers = await this.currentIceServers()
    const signalIceServers = iceServers ?? []
    const receiverPeers =
      role === "sender"
        ? Array.from(this.receivers.entries()).map(([peerId, receiver]) => ({
            peerId,
            userAgent: receiver.userAgent,
            connectionId: receiver.connectionId,
          }))
        : []
    this.send(server, {
      type: "ready",
      role,
      peerId: peerId ?? undefined,
      iceServers: signalIceServers,
      peers: {
        sender: this.sender !== undefined,
        receivers: receiverPeers,
      },
    })
    if (role === "receiver") {
      this.send(this.sender, {
        type: "peer-joined",
        role,
        peerId: peerId ?? undefined,
        connectionId,
        iceServers: signalIceServers,
        userAgent,
      })
    } else {
      for (const [id, receiver] of this.receivers.entries()) {
        this.send(receiver.socket, {
          type: "ready",
          role: "receiver",
          peerId: id,
          iceServers: signalIceServers,
          peers: {
            sender: true,
            receivers: [],
          },
        })
      }
    }

    await this.rescheduleRoomAlarm()

    return new Response(null, { status: 101, webSocket: client })
  }

  private async initRoom(init: P2PRoomInit): Promise<void> {
    const now = Date.now()
    const expiresAt = init.expiresAt ?? now + ROOM_TTL_MS
    const roomState: Record<string, unknown> = {
      [CREATED_AT_KEY]: now,
      [EXPIRES_AT_KEY]: expiresAt,
      [PAIRED_RECEIVER_IDS_KEY]: [],
      [RESUMABLE_RECEIVER_IDS_KEY]: [],
      [SUCCESSFUL_RECEIVER_IDS_KEY]: [],
    }
    if (init.iceServers !== undefined) roomState[ICE_SERVERS_KEY] = init.iceServers
    if (init.iceServersExpiresAt !== undefined) roomState[ICE_SERVERS_EXPIRES_AT_KEY] = init.iceServersExpiresAt
    if (init.maxTransfers !== undefined) roomState[MAX_TRANSFERS_KEY] = init.maxTransfers
    if (init.senderToken !== undefined) roomState[SENDER_TOKEN_KEY] = init.senderToken

    await this.state.storage.put(roomState)
    await this.state.storage.setAlarm(expiresAt)
  }

  private async updateRoom(request: Request): Promise<Response> {
    let update: P2PRoomUpdate
    try {
      update = await request.json()
    } catch {
      return new Response("invalid P2P update request", { status: 400 })
    }
    if (!(await this.isValidSenderToken(update.senderToken))) {
      return new Response("invalid sender token", { status: 403 })
    }
    if (
      !Number.isFinite(update.expiresAt) ||
      !Number.isSafeInteger(update.expirationSeconds) ||
      update.expirationSeconds < 0 ||
      !Number.isSafeInteger(update.maxTransfers) ||
      update.maxTransfers < 0
    ) {
      return new Response("invalid P2P update options", { status: 400 })
    }

    const result = await this.enqueueStorageMutation(async () => {
      const stored = await this.state.storage.get([PAIRED_RECEIVER_IDS_KEY, SUCCESSFUL_RECEIVER_IDS_KEY])
      const pairedReceiverIds = storedStringIds(stored.get(PAIRED_RECEIVER_IDS_KEY))
      const successfulReceiverIds = storedStringIds(stored.get(SUCCESSFUL_RECEIVER_IDS_KEY))
      await this.state.storage.put({
        [EXPIRES_AT_KEY]: update.expiresAt,
        [MAX_TRANSFERS_KEY]: update.maxTransfers,
        [PAIRED_RECEIVER_IDS_KEY]: pairedReceiverIds,
      })
      const joinable =
        Date.now() < update.expiresAt && (update.maxTransfers === 0 || pairedReceiverIds.length < update.maxTransfers)
      return {
        expireAt: new Date(update.expiresAt).toISOString(),
        expirationSeconds: update.expirationSeconds,
        maxTransfers: update.maxTransfers,
        joinable,
        pairedReceivers: pairedReceiverIds.length,
        successfulReceivers: successfulReceiverIds.length,
      } satisfies P2PUpdateResponse
    })

    const message: P2PSignalMessage = {
      type: "room-options-updated",
      expireAt: result.expireAt,
      maxTransfers: result.maxTransfers,
      joinable: result.joinable,
    }
    this.send(this.sender, message)
    for (const receiver of this.receivers.values()) this.send(receiver.socket, message)
    await this.rescheduleRoomAlarm()
    return jsonResponse(result)
  }

  private async resumableReceiverIds(): Promise<string[]> {
    return (await this.membership.load()).resumableReceiverIds
  }

  private enqueueStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageMutationQueue.then(operation, operation)
    this.storageMutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private recordPairedReceiver(peerId: string | undefined): Promise<boolean> {
    return this.enqueueStorageMutation(async () => {
      if (!peerId) return false
      const { successfulReceiverIds, maxTransfers, pairedReceiverIds } = await this.membership.load()
      if (successfulReceiverIds.includes(peerId)) return false
      if (pairedReceiverIds.includes(peerId)) return true
      if (maxTransfers > 0 && pairedReceiverIds.length >= maxTransfers) return false
      pairedReceiverIds.push(peerId)
      await this.membership.save({ pairedReceiverIds })
      return true
    })
  }

  private recordSuccessfulTransfer(peerId: string | undefined): Promise<{ accepted: boolean; limitReached: boolean }> {
    return this.enqueueStorageMutation(async () => {
      if (!peerId) return { accepted: false, limitReached: false }
      const { maxTransfers, pairedReceiverIds, successfulReceiverIds, resumableReceiverIds } =
        await this.membership.load()
      if (successfulReceiverIds.includes(peerId)) {
        return { accepted: true, limitReached: maxTransfers > 0 && pairedReceiverIds.length >= maxTransfers }
      }
      if (!pairedReceiverIds.includes(peerId)) {
        if (!this.receivers.has(peerId)) return { accepted: false, limitReached: false }
        if (maxTransfers > 0 && pairedReceiverIds.length >= maxTransfers) {
          return { accepted: false, limitReached: true }
        }
        pairedReceiverIds.push(peerId)
      }
      successfulReceiverIds.push(peerId)
      await this.membership.save({
        pairedReceiverIds,
        successfulReceiverIds,
        resumableReceiverIds: resumableReceiverIds.filter((id) => id !== peerId),
      })
      const limitReached = maxTransfers > 0 && pairedReceiverIds.length >= maxTransfers
      if (limitReached) {
        this.send(this.sender, { type: "transfer-limit-complete" })
      }
      return { accepted: true, limitReached }
    })
  }

  private recordResumableReceiver(peerId: string | undefined): Promise<boolean> {
    return this.enqueueStorageMutation(async () => {
      if (!peerId || !this.receivers.has(peerId)) return false
      const { successfulReceiverIds, pairedReceiverIds, resumableReceiverIds } = await this.membership.load()
      if (successfulReceiverIds.includes(peerId)) return false
      if (!pairedReceiverIds.includes(peerId)) return false
      if (!resumableReceiverIds.includes(peerId)) {
        resumableReceiverIds.push(peerId)
        await this.membership.save({ resumableReceiverIds })
      }
      return true
    })
  }

  private clearResumableReceiver(peerId: string): Promise<void> {
    return this.enqueueStorageMutation(async () => {
      const resumableReceiverIds = await this.resumableReceiverIds()
      if (!resumableReceiverIds.includes(peerId)) return
      await this.membership.save({ resumableReceiverIds: resumableReceiverIds.filter((id) => id !== peerId) })
    })
  }

  private async releaseReceiverState(peerId: string, force = false): Promise<boolean> {
    const { successfulReceiverIds, resumableReceiverIds, pairedReceiverIds } = await this.membership.load()
    if (successfulReceiverIds.includes(peerId)) return false
    if (!force && resumableReceiverIds.includes(peerId)) return true
    await this.membership.save({
      pairedReceiverIds: pairedReceiverIds.filter((id) => id !== peerId),
      resumableReceiverIds: resumableReceiverIds.filter((id) => id !== peerId),
    })
    return false
  }

  private releaseReceiver(peerId: string, force = false): Promise<boolean> {
    return this.enqueueStorageMutation(() => this.releaseReceiverState(peerId, force))
  }

  private async currentIceServers(): Promise<P2PIceServer[] | undefined> {
    const stored = await this.state.storage.get([ICE_SERVERS_KEY, ICE_SERVERS_EXPIRES_AT_KEY])
    const storedIceServers = stored.get(ICE_SERVERS_KEY) as P2PIceServer[] | undefined
    const iceServersExpiresAt = stored.get(ICE_SERVERS_EXPIRES_AT_KEY) as number | undefined
    if (storedIceServers !== undefined && iceServersExpiresAt === undefined) return storedIceServers
    if (
      storedIceServers !== undefined &&
      typeof iceServersExpiresAt === "number" &&
      iceServersExpiresAt - Date.now() > MIN_TURN_CREDENTIALS_REMAINING_MS
    ) {
      return storedIceServers
    }

    const refreshed = await getTurnIceServers(this.env)
    if (refreshed.iceServers !== undefined) {
      await this.state.storage.put(ICE_SERVERS_KEY, refreshed.iceServers)
    } else {
      await this.state.storage.delete(ICE_SERVERS_KEY)
    }

    if (refreshed.expiresAt !== undefined) {
      await this.state.storage.put(ICE_SERVERS_EXPIRES_AT_KEY, refreshed.expiresAt)
    } else {
      await this.state.storage.delete(ICE_SERVERS_EXPIRES_AT_KEY)
    }

    return refreshed.iceServers
  }

  private async roomExpiresAt(): Promise<number> {
    const expiresAt = await this.state.storage.get<number>(EXPIRES_AT_KEY)
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) return expiresAt
    const createdAt = (await this.state.storage.get<number>(CREATED_AT_KEY)) ?? 0
    return createdAt + ROOM_TTL_MS
  }

  private async isValidSenderToken(token: string | null): Promise<boolean> {
    const expected = await this.state.storage.get<string>(SENDER_TOKEN_KEY)
    return typeof expected === "string" && timingSafeEqual(token, expected)
  }

  private async forward(socket: WebSocket, role: P2PRole, raw: string, receiverPeerId?: string): Promise<void> {
    if (raw.length > MAX_P2P_SIGNAL_BYTES) return
    let parsed: P2PSignalMessage
    try {
      const value: unknown = JSON.parse(raw)
      if (!isValidP2PClientSignalMessage(value)) return
      parsed = value
    } catch {
      return
    }

    if (parsed.type === "ping") {
      this.send(socket, { type: "pong" })
      return
    }

    if (parsed.type === "pong") {
      const attachment = this.webSocketAttachment(socket)
      if (attachment) {
        socket.serializeAttachment({ ...attachment, lastPongAt: Date.now(), lastPingAt: undefined })
      }
      return
    }

    if (role === "sender" && parsed.type === "sender-leave") {
      await this.closeRoomAfterSenderLeft()
      return
    }

    if (role === "receiver") {
      if (!receiverPeerId) return
      if (parsed.type === "transfer-checkpoint") {
        const accepted = await this.recordResumableReceiver(receiverPeerId)
        this.send(socket, { type: "transfer-checkpoint-result", accepted })
        return
      }
      if (parsed.type === "transfer-checkpoint-clear") {
        await this.clearResumableReceiver(receiverPeerId)
        return
      }
      if (parsed.type === "transfer-abandon") {
        await this.releaseReceiver(receiverPeerId, true)
        this.send(socket, { type: "transfer-abandoned" })
        this.receivers.delete(receiverPeerId)
        this.send(this.sender, { type: "peer-left", role: "receiver", peerId: receiverPeerId, resumable: false })
        socket.close(1000, "P2P transfer abandoned")
        return
      }
      if (parsed.type === "peer-reconnect-request") {
        this.send(this.sender, {
          type: "peer-reconnect-request",
          peerId: receiverPeerId,
          retryToken: parsed.retryToken,
        })
        return
      }
      if (parsed.type !== "answer" && parsed.type !== "candidate") return
      if (!this.sender) return
      this.send(this.sender, { ...parsed, peerId: receiverPeerId })
      return
    }

    const peerId = "peerId" in parsed && typeof parsed.peerId === "string" ? parsed.peerId : undefined
    if (!peerId || !this.receivers.has(peerId)) return
    if (parsed.type === "receiver-paired") {
      const accepted = await this.recordPairedReceiver(peerId)
      const pairResult = { type: "receiver-pair-result", peerId, accepted } satisfies P2PSignalMessage
      this.send(this.sender, pairResult)
      this.send(this.receivers.get(peerId)?.socket, pairResult)
      if (!accepted) this.rejectReceiverAtLimit(peerId)
      return
    }
    if (parsed.type === "transfer-complete") {
      const result = await this.recordSuccessfulTransfer(peerId)
      if (result.accepted && result.limitReached) {
        this.send(this.receivers.get(peerId)?.socket, { type: "transfer-limit-complete" })
      }
      return
    }
    this.send(this.receivers.get(peerId)?.socket, parsed)
  }

  private rejectReceiverAtLimit(peerId: string): void {
    const receiver = this.receivers.get(peerId)
    if (!receiver) return
    this.receivers.delete(peerId)
    this.send(receiver.socket, { type: "receiver-limit-reached" })
    this.send(this.sender, { type: "peer-left", role: "receiver", peerId })
    receiver.socket.close(1008, "P2P receiver limit reached")
  }

  private hasOpenSockets(): boolean {
    return this.state.getWebSockets().some((socket) => socket.readyState === WebSocket.OPEN)
  }

  private sendHeartbeat(now: number): void {
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue
      const attachment = this.webSocketAttachment(socket)
      if (!attachment) {
        socket.close(1008, "invalid socket attachment")
        continue
      }
      const lastPingAt = attachment.lastPingAt
      const lastPongAt = attachment.lastPongAt ?? now
      if (lastPingAt !== undefined && lastPongAt < lastPingAt) {
        if (now - lastPingAt >= P2P_HEARTBEAT_TIMEOUT_MS) {
          socket.close(1001, "P2P heartbeat timeout")
        }
        continue
      }
      socket.serializeAttachment({ ...attachment, lastPingAt: now, lastPongAt })
      this.send(socket, { type: "ping" })
    }
  }

  private async disconnect(socket: WebSocket): Promise<void> {
    const attachment = this.webSocketAttachment(socket)
    if (attachment?.role === "sender") {
      if (this.sender !== socket) return
      this.sender = undefined
      this.senderConnectedAt = 0
      for (const receiver of this.receivers.values()) {
        this.send(receiver.socket, { type: "peer-signaling-disconnected", role: "sender" })
      }
      await this.scheduleSenderCleanup()
      return
    }

    const peerId = attachment?.role === "receiver" ? attachment.peerId : undefined
    if (!peerId) return
    const receiver = this.receivers.get(peerId)
    if (receiver?.socket !== socket) return
    this.receivers.delete(peerId)
    await this.scheduleReceiverCleanup(peerId)
    this.send(this.sender, {
      type: "peer-signaling-disconnected",
      role: "receiver",
      peerId,
      connectionId: receiver.connectionId,
    })
  }

  private send(socket: WebSocket | undefined, message: P2PSignalMessage): void {
    if (socket?.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // The peer may close between the readyState check and send().
    }
  }

  private async scheduleSenderCleanup(): Promise<void> {
    const now = Date.now()
    const expiresAt = await this.roomExpiresAt()
    if (expiresAt <= now) {
      await this.closeRoomAfterSenderLeft()
      return
    }
    await this.rescheduleRoomAlarm()
  }

  private async rescheduleRoomAlarm(): Promise<void> {
    const now = Date.now()
    const stored = await this.state.storage.get([CREATED_AT_KEY, EXPIRES_AT_KEY, RECEIVER_CLEANUP_AT_KEY])
    const expiresAt = storedRoomExpiresAt(stored)
    const receiverDeadlines = Object.values(storedReceiverDeadlines(stored.get(RECEIVER_CLEANUP_AT_KEY)))
    const receiverCleanupAt = receiverDeadlines.length > 0 ? Math.min(...receiverDeadlines) : undefined
    const roomAlarmAt = this.sender ? (expiresAt > now ? expiresAt : undefined) : expiresAt
    const heartbeatAt = this.hasOpenSockets() ? now + P2P_HEARTBEAT_INTERVAL_MS : undefined
    const nextAlarmAt = [roomAlarmAt, receiverCleanupAt, heartbeatAt]
      .filter((value): value is number => value !== undefined)
      .reduce<number | undefined>(
        (earliest, value) => (earliest === undefined ? value : Math.min(earliest, value)),
        undefined,
      )
    if (nextAlarmAt === undefined) {
      await this.state.storage.deleteAlarm()
    } else if (nextAlarmAt <= now) {
      await this.closeRoomAfterSenderLeft()
    } else {
      await this.state.storage.setAlarm(nextAlarmAt)
    }
  }

  private async receiverCleanupDeadlines(): Promise<Record<string, number>> {
    const stored = await this.state.storage.get<Record<string, number>>(RECEIVER_CLEANUP_AT_KEY)
    return storedReceiverDeadlines(stored)
  }

  private async scheduleReceiverCleanup(peerId: string): Promise<void> {
    await this.enqueueStorageMutation(async () => {
      const deadlines = await this.receiverCleanupDeadlines()
      deadlines[peerId] = Date.now() + RECEIVER_RECONNECT_GRACE_MS
      await this.state.storage.put(RECEIVER_CLEANUP_AT_KEY, deadlines)
    })
    await this.rescheduleRoomAlarm()
  }

  private async cancelReceiverCleanup(peerId: string): Promise<void> {
    await this.enqueueStorageMutation(async () => {
      const deadlines = await this.receiverCleanupDeadlines()
      if (deadlines[peerId] === undefined) return
      delete deadlines[peerId]
      if (Object.keys(deadlines).length > 0) await this.state.storage.put(RECEIVER_CLEANUP_AT_KEY, deadlines)
      else await this.state.storage.delete(RECEIVER_CLEANUP_AT_KEY)
    })
  }

  private async nextReceiverCleanupAt(): Promise<number | undefined> {
    const deadlines = Object.values(await this.receiverCleanupDeadlines())
    return deadlines.length > 0 ? Math.min(...deadlines) : undefined
  }

  private async cleanupExpiredReceivers(now: number): Promise<number | undefined> {
    return await this.enqueueStorageMutation(async () => {
      const deadlines = await this.receiverCleanupDeadlines()
      let changed = false
      for (const [peerId, cleanupAt] of Object.entries(deadlines)) {
        if (this.receivers.has(peerId)) {
          delete deadlines[peerId]
          changed = true
          continue
        }
        if (cleanupAt > now) continue
        delete deadlines[peerId]
        changed = true
        const resumable = await this.releaseReceiverState(peerId)
        this.send(this.sender, { type: "peer-left", role: "receiver", peerId, resumable })
      }
      if (changed) {
        if (Object.keys(deadlines).length > 0) await this.state.storage.put(RECEIVER_CLEANUP_AT_KEY, deadlines)
        else await this.state.storage.delete(RECEIVER_CLEANUP_AT_KEY)
      }
      const remaining = Object.values(deadlines)
      return remaining.length > 0 ? Math.min(...remaining) : undefined
    })
  }

  private async closeRoomAfterSenderLeft(): Promise<void> {
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.webSocketAttachment(socket)
      if (attachment?.role === "receiver") this.send(socket, { type: "peer-left", role: "sender" })
      try {
        socket.close(1000, "sender left")
      } catch {
        // Continue closing the room even if one orphaned socket is already gone.
      }
    }
    this.sender = undefined
    this.senderConnectedAt = 0
    this.receivers.clear()
    await this.state.storage.deleteAll()
    await this.state.storage.deleteAlarm()
  }

  private webSocketAttachment(socket: WebSocket): P2PWebSocketAttachment | null {
    const attachment: unknown = socket.deserializeAttachment()
    if (typeof attachment !== "object" || attachment === null) return null
    const role = (attachment as P2PWebSocketAttachment).role
    const peerId = (attachment as P2PWebSocketAttachment).peerId
    const userAgent = (attachment as P2PWebSocketAttachment).userAgent
    const connectionId = (attachment as P2PWebSocketAttachment).connectionId
    const connectedAt = (attachment as P2PWebSocketAttachment).connectedAt
    const lastPingAt = (attachment as P2PWebSocketAttachment).lastPingAt
    const lastPongAt = (attachment as P2PWebSocketAttachment).lastPongAt
    if (role !== "sender" && role !== "receiver") return null
    if (role === "receiver" && (typeof peerId !== "string" || !isUuid(peerId))) return null
    if (userAgent !== undefined && typeof userAgent !== "string") return null
    if (connectionId !== undefined && (typeof connectionId !== "string" || !isUuid(connectionId))) return null
    if (connectedAt !== undefined && (!Number.isFinite(connectedAt) || connectedAt < 0)) return null
    if (lastPingAt !== undefined && (!Number.isFinite(lastPingAt) || lastPingAt < 0)) return null
    if (lastPongAt !== undefined && (!Number.isFinite(lastPongAt) || lastPongAt < 0)) return null
    return { role, peerId, userAgent, connectionId, connectedAt, lastPingAt, lastPongAt }
  }
}
