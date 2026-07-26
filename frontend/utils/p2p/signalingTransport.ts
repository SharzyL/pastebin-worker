import type { PublicEnv } from "../../../shared/interfaces.js"
import { P2P_SIGNAL_BACKGROUND_REFRESH_MS, P2P_SIGNAL_RECONNECT_WINDOW_MS } from "../../../shared/constants.js"
import { parseP2PSignalMessage, type SignalMessage } from "./protocol.js"

const reconnectBaseDelayMs = 1000
const reconnectMaxDelayMs = 10_000
const roomAvailabilityProbeTimeoutMs = 10_000
export const reconnectWindowMs = P2P_SIGNAL_RECONNECT_WINDOW_MS

function reconnectDelayMs(attempt: number): number {
  return Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** Math.min(attempt, 4))
}

export class P2PReconnectPolicy {
  private attempts = 0
  private deadlineAt?: number

  constructor(private readonly windowMs = reconnectWindowMs) {}

  nextDelay(now = Date.now()): number | null {
    this.deadlineAt ??= now + this.windowMs
    const delay = reconnectDelayMs(this.attempts)
    if (now + delay > this.deadlineAt) return null
    this.attempts += 1
    return delay
  }

  reset(): void {
    this.attempts = 0
    this.deadlineAt = undefined
  }
}

export function wsUrl(
  config: PublicEnv,
  name: string,
  role: "sender" | "receiver",
  options: { peerId?: string; token?: string } = {},
): string {
  const url = new URL(`/p2p/ws/${name}`, config.DEPLOY_URL)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("role", role)
  if (options.peerId) url.searchParams.set("peerId", options.peerId)
  if (options.token) url.searchParams.set("token", options.token)
  return url.toString()
}

export async function probeP2PRoomAvailability(
  config: PublicEnv,
  name: string,
): Promise<"available" | "unavailable" | "unknown"> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), roomAvailabilityProbeTimeoutMs)
  try {
    const statusUrl = new URL(`/p/${encodeURIComponent(name)}`, config.DEPLOY_URL)
    const response = await fetch(statusUrl, { method: "HEAD", cache: "no-store", signal: controller.signal })
    if (response.status === 404 || response.status === 410) return "unavailable"
    return response.ok ? "available" : "unknown"
  } catch {
    return "unknown"
  } finally {
    clearTimeout(timeout)
  }
}

function sendSignal(ws: WebSocket, message: SignalMessage): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false
  ws.send(JSON.stringify(message))
  return true
}

export interface P2PSignalingTransport {
  readonly socket: WebSocket | undefined
  connect: () => void
  send: (message: SignalMessage) => boolean
  resetReconnect: () => void
  restartReconnect: () => void
  close: () => void
}

interface P2PSignalingTransportOptions {
  url: string | (() => string)
  reconnectWindowMs?: number
  shouldReconnect: () => boolean
  onOpen: (isReconnect: boolean) => void
  onMessage: (message: SignalMessage, isCurrent: () => boolean) => Promise<void>
  onImmediateMessage?: (message: SignalMessage, send: (message: SignalMessage) => boolean) => boolean
  onError: (error: Error) => void
  onSocketError: () => void
  onClose: () => void
  onReconnectExhausted: () => void
}

export function createP2PSignalingTransport(options: P2PSignalingTransportOptions): P2PSignalingTransport {
  let socket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let isClosed = false
  let hasStarted = false
  let lifecycleListenersAttached = false
  let backgroundedAt: number | undefined
  let lastActivityAt = Date.now()
  const reconnectPolicy = new P2PReconnectPolicy(options.reconnectWindowMs ?? reconnectWindowMs)
  let messageQueue = Promise.resolve()

  const send = (message: SignalMessage) => {
    if (!socket) return false
    return sendSignal(socket, message)
  }

  const dispose = (currentSocket: WebSocket, closeSocket: boolean) => {
    currentSocket.onopen = null
    currentSocket.onerror = null
    currentSocket.onclose = null
    currentSocket.onmessage = null
    if (socket === currentSocket) socket = undefined
    if (closeSocket) currentSocket.close()
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer === undefined) return
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  const scheduleReconnect = () => {
    if (isClosed || !options.shouldReconnect() || reconnectTimer !== undefined) return
    const delay = reconnectPolicy.nextDelay()
    if (delay === null) {
      options.onReconnectExhausted()
      return
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (!isClosed && options.shouldReconnect()) connect(true)
    }, delay)
  }

  const connect = (reconnect = false) => {
    if (isClosed || !hasStarted || !options.shouldReconnect() || socket) return
    const currentSocket = new WebSocket(typeof options.url === "function" ? options.url() : options.url)
    socket = currentSocket
    const currentIsReconnect = reconnect
    lastActivityAt = Date.now()
    messageQueue = Promise.resolve()
    const isCurrent = () => !isClosed && socket === currentSocket

    currentSocket.onopen = () => {
      if (!isCurrent()) return
      lastActivityAt = Date.now()
      options.onOpen(currentIsReconnect)
    }
    currentSocket.onerror = () => {
      if (isCurrent()) options.onSocketError()
    }
    currentSocket.onclose = () => {
      if (!isCurrent()) return
      dispose(currentSocket, false)
      options.onClose()
      scheduleReconnect()
    }
    currentSocket.onmessage = (event) => {
      if (!isCurrent()) return
      lastActivityAt = Date.now()
      let message: SignalMessage | null
      try {
        message = parseP2PSignalMessage(event.data)
      } catch (error) {
        options.onError(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (!message) return
      if (message.type === "ping") {
        sendSignal(currentSocket, { type: "pong" })
        return
      }
      if (options.onImmediateMessage?.(message, (outgoing) => sendSignal(currentSocket, outgoing))) return
      messageQueue = messageQueue
        .then(() => options.onMessage(message, isCurrent))
        .catch((error: unknown) => {
          if (isCurrent()) options.onError(error instanceof Error ? error : new Error(String(error)))
        })
    }
  }

  const restartReconnect = () => {
    if (isClosed || !hasStarted || !options.shouldReconnect()) return
    reconnectPolicy.reset()
    clearReconnectTimer()
    const currentSocket = socket
    if (currentSocket) {
      dispose(currentSocket, true)
      options.onClose()
    }
    connect(true)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      backgroundedAt = Date.now()
      return
    }
    const now = Date.now()
    const backgroundDuration = backgroundedAt === undefined ? 0 : now - backgroundedAt
    backgroundedAt = undefined
    if (
      backgroundDuration >= P2P_SIGNAL_BACKGROUND_REFRESH_MS ||
      now - lastActivityAt >= P2P_SIGNAL_BACKGROUND_REFRESH_MS ||
      socket?.readyState !== WebSocket.OPEN
    ) {
      restartReconnect()
    }
  }

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) restartReconnect()
  }

  const onOnline = () => {
    restartReconnect()
  }

  const attachLifecycleListeners = () => {
    if (lifecycleListenersAttached) return
    lifecycleListenersAttached = true
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange)
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", onPageShow)
      window.addEventListener("online", onOnline)
    }
  }

  const detachLifecycleListeners = () => {
    if (!lifecycleListenersAttached) return
    lifecycleListenersAttached = false
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange)
    if (typeof window !== "undefined") {
      window.removeEventListener("pageshow", onPageShow)
      window.removeEventListener("online", onOnline)
    }
  }

  const start = () => {
    if (isClosed || hasStarted || !options.shouldReconnect()) return
    hasStarted = true
    attachLifecycleListeners()
    connect(false)
  }

  const close = () => {
    isClosed = true
    clearReconnectTimer()
    detachLifecycleListeners()
    if (socket) dispose(socket, true)
  }

  return {
    get socket() {
      return socket
    },
    connect: start,
    send,
    resetReconnect: () => reconnectPolicy.reset(),
    restartReconnect,
    close,
  }
}
