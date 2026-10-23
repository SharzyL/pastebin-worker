import { DurableObject } from "cloudflare:workers"

import { WorkerError } from "./common.js"
import { verifyAuth } from "./pages/auth.js"
import type { LiveControlFrame } from "../shared/live.js"
import {
  LIVE_MAX_FRAME_BYTES,
  LIVE_MAX_PEERS,
  LIVE_PING,
  LIVE_PONG,
  LIVE_CHANNEL_ID_REGEX,
  LIVE_WS_PATH_PREFIX,
} from "../shared/live.js"

const MiB = 1024 * 1024

// Frames are charged by size, with a floor so floods of tiny frames are
// limited too. Each connection has its own budget, and the channel has a shared
// one so many connections cannot add up to an unbounded relay rate.
const MIN_FRAME_COST = 1024
const CONN_BURST_BYTES = 24 * MiB
const CONN_BYTES_PER_SEC = 1 * MiB
const CHANNEL_BURST_BYTES = 48 * MiB
const CHANNEL_BYTES_PER_SEC = 4 * MiB

// Token bucket kept in memory only, so it refills when the object
// hibernates; that is good enough for a best-effort flood guard.
class Bucket {
  private tokens: number
  private updatedAt = Date.now()

  constructor(
    private burst: number,
    private perSec: number,
  ) {
    this.tokens = burst
  }

  private refill() {
    const now = Date.now()
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.updatedAt) / 1000) * this.perSec)
    this.updatedAt = now
  }

  canTake(cost: number): boolean {
    this.refill()
    return this.tokens >= cost
  }

  take(cost: number) {
    this.tokens -= cost
  }
}

// WebSocket.OPEN, which the DOM and Workers type definitions name differently
const WS_OPEN = 1

// Sockets still listed while closing must not count as peers or receive posts
function isOpen(ws: WebSocket): boolean {
  return ws.readyState === WS_OPEN
}

export async function handleLiveSocket(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const channelId = url.pathname.slice(LIVE_WS_PATH_PREFIX.length)
  if (!LIVE_CHANNEL_ID_REGEX.test(channelId)) {
    throw new WorkerError(400, `illegal live channel id '${channelId}'`)
  }
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new WorkerError(426, "expected a WebSocket upgrade request")
  }

  const authResponse = verifyAuth(request, env)
  if (authResponse !== null) {
    return authResponse
  }

  const stub = env.LIVE_CHANNEL.get(env.LIVE_CHANNEL.idFromName(channelId))
  return await stub.fetch(request)
}

// A live channel is a pure relay: every binary frame is forwarded to the other
// connected peers and then forgotten.
export class LiveChannel extends DurableObject<Env> {
  private connBuckets = new WeakMap<WebSocket, Bucket>()
  private channelBucket = new Bucket(CHANNEL_BURST_BYTES, CHANNEL_BYTES_PER_SEC)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG))
  }

  fetch(_request: Request): Response {
    if (this.ctx.getWebSockets().filter(isOpen).length >= LIVE_MAX_PEERS) {
      return new Response(`Error 503: live channel is full (max ${LIVE_MAX_PEERS} peers)\n`, { status: 503 })
    }

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    this.announcePeers()

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const size = typeof message === "string" ? message.length : message.byteLength
    if (size > LIVE_MAX_FRAME_BYTES) {
      ws.close(1009, `frame exceeds ${LIVE_MAX_FRAME_BYTES} bytes`)
      return
    }

    if (!this.takeTokens(ws, Math.max(size, MIN_FRAME_COST))) {
      send(ws, { t: "error", msg: "rate limited, frame dropped" })
      return
    }

    if (typeof message === "string") {
      send(ws, { t: "error", msg: "expected a binary frame, frame dropped" })
      return
    }

    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== ws && isOpen(peer)) send(peer, message)
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      // complete the closing handshake; throws on reserved codes like 1005/1006
      ws.close(code, reason)
    } catch {
      ws.close()
    }
    this.announcePeers(ws)
  }

  webSocketError(ws: WebSocket) {
    this.announcePeers(ws)
  }

  // Tell everyone how many peers are in the channel, not counting `leaving`
  private announcePeers(leaving?: WebSocket) {
    const peers = this.ctx.getWebSockets().filter((ws) => ws !== leaving && isOpen(ws))
    for (const ws of peers) {
      send(ws, { t: "peers", n: peers.length })
    }
  }

  private takeTokens(ws: WebSocket, cost: number): boolean {
    let connBucket = this.connBuckets.get(ws)
    if (connBucket === undefined) {
      connBucket = new Bucket(CONN_BURST_BYTES, CONN_BYTES_PER_SEC)
      this.connBuckets.set(ws, connBucket)
    }
    if (!connBucket.canTake(cost) || !this.channelBucket.canTake(cost)) return false
    connBucket.take(cost)
    this.channelBucket.take(cost)
    return true
  }
}

function send(ws: WebSocket, frame: LiveControlFrame | ArrayBuffer) {
  try {
    ws.send(frame instanceof ArrayBuffer ? frame : JSON.stringify(frame))
  } catch {
    // the peer is closing; its close handler will announce the new count
  }
}
