import { describe, expect, it } from "vitest"
import { createExecutionContext } from "cloudflare:test"

import { BASE_URL, workerFetch } from "./testUtils.js"
import type { LiveControlFrame } from "../../shared/live.js"
import { LIVE_MAX_BODY_BYTES, LIVE_MAX_FRAME_BYTES, parseControlFrame } from "../../shared/live.js"

// received binary frames are decoded as text to compare them easily
type Frame = LiveControlFrame | { bin: string }

function bin(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

const CHANNEL_ID = "0123456789abcdef0123456789abcdef"

interface Peer {
  ws: WebSocket
  next: () => Promise<Frame>
  closed: Promise<CloseEvent>
}

async function connect(ctx: ExecutionContext, channelId: string = CHANNEL_ID): Promise<Peer> {
  const resp = await workerFetch(
    ctx,
    new Request(`${BASE_URL}/live/ws/${channelId}`, { headers: { Upgrade: "websocket" } }),
  )
  expect(resp.status).toStrictEqual(101)
  const ws = resp.webSocket!

  const queue: Frame[] = []
  const waiters: ((f: Frame) => void)[] = []
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve))
  ws.addEventListener("message", (ev) => {
    const frame: Frame =
      ev.data instanceof ArrayBuffer
        ? { bin: new TextDecoder().decode(ev.data) }
        : parseControlFrame(ev.data as string)!
    const waiter = waiters.shift()
    if (waiter) waiter(frame)
    else queue.push(frame)
  })
  ws.accept()

  const next = () =>
    new Promise<Frame>((resolve) => {
      const frame = queue.shift()
      if (frame) resolve(frame)
      else waiters.push(resolve)
    })
  return { ws, next, closed }
}

describe("live channel", () => {
  const ctx = createExecutionContext()

  it("serves the live page", async () => {
    const resp = await workerFetch(ctx, `${BASE_URL}/live`)
    expect(resp.status).toStrictEqual(200)
    expect(resp.headers.get("Content-Type")).toStrictEqual("text/html;charset=UTF-8")
    expect(await resp.text()).toContain('<div id="root">')
  })

  it("rejects illegal channel ids and non-upgrade requests", async () => {
    for (const path of [
      "/live/ws/",
      "/live/ws/xyz",
      `/live/ws/${CHANNEL_ID}0`,
      `/live/ws/${CHANNEL_ID.toUpperCase()}`,
    ]) {
      const resp = await workerFetch(ctx, new Request(`${BASE_URL}${path}`, { headers: { Upgrade: "websocket" } }))
      expect(resp.status, `visiting ${path}`).toStrictEqual(400)
    }
    const resp = await workerFetch(ctx, `${BASE_URL}/live/ws/${CHANNEL_ID}`)
    expect(resp.status).toStrictEqual(426)
  })

  it("relays frames to other peers and announces peer counts", async () => {
    const channelId = "11111111111111111111111111111111"
    const alice = await connect(ctx, channelId)
    expect(await alice.next()).toStrictEqual({ t: "peers", n: 1 })

    const bob = await connect(ctx, channelId)
    expect(await alice.next()).toStrictEqual({ t: "peers", n: 2 })
    expect(await bob.next()).toStrictEqual({ t: "peers", n: 2 })

    const carol = await connect(ctx, channelId)
    for (const peer of [alice, bob, carol]) {
      expect(await peer.next()).toStrictEqual({ t: "peers", n: 3 })
    }

    // a frame reaches everyone but the sender
    alice.ws.send(bin("ciphertext-1"))
    expect(await bob.next()).toStrictEqual({ bin: "ciphertext-1" })
    expect(await carol.next()).toStrictEqual({ bin: "ciphertext-1" })
    bob.ws.send(bin("ciphertext-2"))
    expect(await alice.next()).toStrictEqual({ bin: "ciphertext-2" })
    expect(await carol.next()).toStrictEqual({ bin: "ciphertext-2" })

    carol.ws.close(1000, "bye")
    expect(await alice.next()).toStrictEqual({ t: "peers", n: 2 })
    expect(await bob.next()).toStrictEqual({ t: "peers", n: 2 })

    alice.ws.close(1000)
    bob.ws.close(1000)
  })

  it("isolates channels", async () => {
    const alice = await connect(ctx, "22222222222222222222222222222222")
    const bob = await connect(ctx, "33333333333333333333333333333333")
    expect(await alice.next()).toStrictEqual({ t: "peers", n: 1 })
    expect(await bob.next()).toStrictEqual({ t: "peers", n: 1 })

    bob.ws.send(bin("for-channel-3"))
    // the error frame is the next thing alice receives, so nothing leaked from channel 3
    alice.ws.send("not binary")
    expect(await alice.next()).toStrictEqual({ t: "error", msg: "expected a binary frame, frame dropped" })

    alice.ws.close(1000)
    bob.ws.close(1000)
  })

  it("rate limits by bytes per connection", async () => {
    const alice = await connect(ctx, "55555555555555555555555555555555")
    expect(await alice.next()).toStrictEqual({ t: "peers", n: 1 })
    // the per-connection budget fits two maximum-size posts in a burst
    for (let i = 0; i < 3; i++) {
      alice.ws.send(new Uint8Array(LIVE_MAX_BODY_BYTES))
    }
    expect(await alice.next()).toStrictEqual({ t: "error", msg: "rate limited, frame dropped" })
    alice.ws.close(1000)
  })

  it("rate limits text frames too", async () => {
    const alice = await connect(ctx, "66666666666666666666666666666666")
    expect(await alice.next()).toStrictEqual({ t: "peers", n: 1 })
    const text = "x".repeat(1024 * 1024)
    for (let i = 0; i < 30; i++) alice.ws.send(text)
    const rateLimited = { t: "error", msg: "rate limited, frame dropped" }
    let frame = await alice.next()
    while (JSON.stringify(frame) !== JSON.stringify(rateLimited)) frame = await alice.next()
    alice.ws.close(1000)
  })

  it("rate limits by bytes per channel", async () => {
    const channelId = "77777777777777777777777777777777"
    const peers = [await connect(ctx, channelId), await connect(ctx, channelId), await connect(ctx, channelId)]
    // the channel budget fits fewer than six maximum-size posts in a burst
    for (const peer of peers) {
      peer.ws.send(new Uint8Array(LIVE_MAX_BODY_BYTES))
      peer.ws.send(new Uint8Array(LIVE_MAX_BODY_BYTES))
    }
    const last = peers[2]
    let frame = await last.next()
    while (!("t" in frame) || frame.t !== "error") frame = await last.next()
    expect(frame).toStrictEqual({ t: "error", msg: "rate limited, frame dropped" })
    for (const peer of peers) peer.ws.close(1000)
  })

  it("closes connections sending oversized frames", async () => {
    const alice = await connect(ctx, "44444444444444444444444444444444")
    alice.ws.send(new Uint8Array(LIVE_MAX_FRAME_BYTES + 1))
    const ev = await alice.closed
    expect(ev.code).toStrictEqual(1009)
  })
})
