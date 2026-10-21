import { useCallback, useEffect, useRef, useState } from "react"

import { LIVE_PING, LIVE_WS_PATH_PREFIX, parseControlFrame } from "../../shared/live.js"
import type { LiveKeys, LiveMessage, LivePost } from "./live.js"
import { appendMessage, deriveLiveKeys, genMessageId } from "./live.js"
import { LiveSession } from "./liveSession.js"

export type LiveStatus = "connecting" | "open" | "reconnecting" | "error"

export interface LiveEntry extends LiveMessage {
  // posted from this page; local only, never sent
  isOwn: boolean
}

export interface LiveRoomState {
  status: LiveStatus
  error?: string
  // derived from the secret, undefined until derived; the server sees it too
  roomId?: string
  // this page plus the peers that completed the key exchange
  peerCount: number
  messages: LiveEntry[]
  send: (post: LivePost) => Promise<void>
  // removes the posts from this page only
  clear: () => void
}

// Also the interval of alive frames, which must be shorter than LIVE_PEER_TIMEOUT_MS
const PING_INTERVAL_MS = 30_000
// The server answers every ping, so this long a silence means the connection is dead
const SILENCE_TIMEOUT_MS = 2.5 * PING_INTERVAL_MS
const MAX_RETRY_DELAY_MS = 30_000
// A connection that stays up this long resets the reconnect backoff
const STABLE_CONNECTION_MS = 10_000
// Frames arriving while this much is still waiting to be decrypted are dropped
const MAX_PENDING_DECRYPT_BYTES = 32 * 1024 * 1024

export function liveSocketUrl(deployUrl: string, roomId: string): string {
  const url = new URL(deployUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = LIVE_WS_PATH_PREFIX + roomId
  return url.toString()
}

// Connects to the live room derived from `secret`, reconnecting when the
// connection drops. Only messages received while connected are shown. Every
// connection uses a fresh LiveSession, so its keys are dropped with it.
export function useLiveRoom(deployUrl: string, secret: string): LiveRoomState {
  const [status, setStatus] = useState<LiveStatus>("connecting")
  const [error, setError] = useState<string | undefined>(undefined)
  const [roomId, setRoomId] = useState<string | undefined>(undefined)
  const [peerCount, setPeerCount] = useState(0)
  const [messages, setMessages] = useState<LiveEntry[]>([])

  const connRef = useRef<{ ws: WebSocket; session: LiveSession } | null>(null)

  const addMessage = useCallback((entry: LiveEntry) => {
    setMessages((msgs) => appendMessage(msgs, entry))
  }, [])

  useEffect(() => {
    setMessages([])
    setStatus("connecting")
    setError(undefined)
    setPeerCount(0)
    setRoomId(undefined)

    // set by the cleanup; work left over from this room must not touch state
    // that now belongs to the next one
    let disposed = false
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined
    let currentWs: WebSocket | undefined
    let currentSession: LiveSession | undefined

    const connect = async (keys: LiveKeys) => {
      const session = await LiveSession.create(keys)
      if (disposed) return
      const ws = new WebSocket(liveSocketUrl(deployUrl, keys.roomId))
      ws.binaryType = "arraybuffer"
      currentWs = ws
      currentSession = session
      let openedAt: number | undefined
      let lastHeardAt = Date.now()
      // handle one frame at a time, in arrival order: a proof must be handled
      // before the posts that follow it
      let processing = Promise.resolve()
      let pendingBytes = 0

      const sendIfOpen = (frame: Uint8Array) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame)
      }
      const updatePeers = () => {
        if (!disposed && connRef.current?.ws === ws) setPeerCount(session.confirmedCount + 1)
      }
      const enqueue = (bytes: number, task: () => Promise<void>) => {
        pendingBytes += bytes
        processing = processing
          .then(task)
          .catch(console.error)
          .finally(() => {
            pendingBytes -= bytes
          })
      }

      ws.onopen = () => {
        if (disposed) return
        openedAt = Date.now()
        lastHeardAt = openedAt
        connRef.current = { ws, session }
        setStatus("open")
        updatePeers()
        enqueue(0, async () => sendIfOpen(await session.hello()))
        pingTimer = setInterval(() => {
          if (Date.now() - lastHeardAt > SILENCE_TIMEOUT_MS) {
            ws.close()
            return
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(LIVE_PING)
          enqueue(0, async () => {
            session.prune()
            updatePeers()
            sendIfOpen(await session.alive())
          })
        }, PING_INTERVAL_MS)
      }
      ws.onmessage = (ev: MessageEvent) => {
        if (disposed) return
        lastHeardAt = Date.now()
        if (ev.data instanceof ArrayBuffer) {
          const data = new Uint8Array(ev.data)
          if (pendingBytes + data.length > MAX_PENDING_DECRYPT_BYTES) {
            console.warn("live room: too many frames waiting to be decrypted, frame dropped")
            return
          }
          enqueue(data.length, async () => {
            const { replies, message } = await session.receive(data)
            if (disposed) return
            for (const reply of replies) sendIfOpen(reply)
            updatePeers()
            if (message) addMessage({ ...message, isOwn: false })
          })
        } else if (typeof ev.data === "string") {
          // the peer count from the server includes peers still exchanging
          // keys, so the count of confirmed peers is shown instead
          const frame = parseControlFrame(ev.data)
          if (frame?.t === "error") {
            console.warn("live room:", frame.msg)
          }
        }
      }
      ws.onclose = () => {
        if (connRef.current?.ws === ws) connRef.current = null
        if (currentSession === session) currentSession = undefined
        clearInterval(pingTimer)
        if (disposed) return
        // a server that accepts and then drops connections must not cause a reconnect loop
        if (openedAt !== undefined && Date.now() - openedAt > STABLE_CONNECTION_MS) retries = 0
        setStatus("reconnecting")
        setPeerCount(0)
        const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** retries)
        retries += 1
        retryTimer = setTimeout(() => void connect(keys).catch(onFatal), delay)
      }
    }

    const onFatal = (e: Error) => {
      if (disposed) return
      setStatus("error")
      setError(e.message)
    }

    // Say goodbye so peers stop wrapping keys for this connection, then close
    // it, which drops its keys. A page restored from the back/forward cache
    // reconnects with new keys.
    const leave = () => {
      const ws = currentWs
      const session = currentSession
      if (ws === undefined) return
      if (session !== undefined && ws.readyState === WebSocket.OPEN) {
        session
          .bye()
          .then((frame) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(frame)
          })
          .catch(console.error)
          .finally(() => ws.close())
      } else {
        ws.close()
      }
    }

    deriveLiveKeys(secret)
      .then((keys) => {
        if (disposed) return
        setRoomId(keys.roomId)
        return connect(keys)
      })
      .catch(onFatal)
    window.addEventListener("pagehide", leave)

    return () => {
      disposed = true
      window.removeEventListener("pagehide", leave)
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      leave()
      connRef.current = null
    }
  }, [deployUrl, secret, addMessage])

  const send = useCallback(
    async (post: LivePost) => {
      const conn = connRef.current
      if (conn === null) throw new Error("Not connected to the live room")
      const msg: LiveMessage = { ...post, id: genMessageId(), ts: Date.now() }
      // null when nobody else has joined: the post is only shown here
      const frame = await conn.session.encryptPost(msg)
      // the connection may have dropped while encrypting; sending on a closed
      // socket silently discards the data
      if (connRef.current?.ws !== conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
        throw new Error("Connection lost before the post was sent, please post again")
      }
      if (frame !== null) conn.ws.send(frame)
      addMessage({ ...msg, isOwn: true })
    },
    [addMessage],
  )

  const clear = useCallback(() => setMessages([]), [])

  return { status, error, roomId, peerCount, messages, send, clear }
}
