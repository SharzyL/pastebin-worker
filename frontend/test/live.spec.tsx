import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"

import type { LiveKeys, LiveMessage, LivePost } from "../utils/live.js"
import {
  appendMessage,
  decodePost,
  deriveLiveKeys,
  encodePost,
  genLiveSecret,
  genNickname,
  LIVE_MAX_PAGE_BYTES,
} from "../utils/live.js"
import { LIVE_PEER_TIMEOUT_MS, LiveSession } from "../utils/liveSession.js"
import { liveSocketUrl, useLiveRoom } from "../utils/useLiveRoom.js"
import { LivePaste } from "../pages/LivePaste.js"
import { LivePostCard } from "../components/LivePostCard.js"
import { stubBrowerFunctions } from "./testUtils.js"
import type { LiveControlFrame } from "../../shared/live.js"
import { LIVE_PING } from "../../shared/live.js"

function msg(id: string, ts: number, body = "x"): LiveMessage {
  return { id, ts, author: "a", kind: "text", body: new TextEncoder().encode(body) }
}

function textPost(author: string, text: string): LivePost {
  return { author, kind: "text", lang: "js", body: new TextEncoder().encode(text) }
}

// Uint8Arrays from different realms (jsdom vs node) never compare strictly equal
function plain(m: LiveMessage | null) {
  return m && { ...m, body: Array.from(m.body) }
}

function bodies(msgs: LiveMessage[]): string[] {
  return msgs.map((m) => new TextDecoder().decode(m.body))
}

interface Endpoint {
  session: LiveSession
  inbox: LiveMessage[]
}

async function endpoint(keys: LiveKeys): Promise<Endpoint> {
  return { session: await LiveSession.create(keys), inbox: [] }
}

// Delivers frames like the relay does, to everyone but the sender, together
// with every reply they cause, until nothing is left to deliver
async function broadcast(peers: Endpoint[], from: Endpoint, frame: Uint8Array | null, now?: number) {
  const queue: [Endpoint, Uint8Array][] = frame ? [[from, frame]] : []
  while (queue.length > 0) {
    const [sender, data] = queue.shift()!
    for (const peer of peers) {
      if (peer === sender) continue
      const { replies, message } = await peer.session.receive(data, now)
      if (message) peer.inbox.push(message)
      for (const reply of replies) queue.push([peer, reply])
    }
  }
}

async function join(peers: Endpoint[], newcomer: Endpoint) {
  peers.push(newcomer)
  await broadcast(peers, newcomer, await newcomer.session.hello())
}

describe("live crypto", () => {
  it("derives deterministic room keys from a secret", async () => {
    const secret = genLiveSecret()
    const a = await deriveLiveKeys(secret)
    const b = await deriveLiveKeys(secret)
    expect(a.roomId).toMatch(/^[0-9a-f]{32}$/)
    expect(a.roomId).toStrictEqual(b.roomId)
    expect(Array.from(a.psk)).toStrictEqual(Array.from(b.psk))
    expect(a.psk.length).toStrictEqual(32)
    expect(a.roomId).not.toStrictEqual((await deriveLiveKeys(genLiveSecret())).roomId)
    await expect(deriveLiveKeys(genLiveSecret().slice(0, 20))).rejects.toThrow("copied in full")
  })

  it("encodes and decodes posts", () => {
    const file: LiveMessage = {
      id: "m2",
      ts: 2,
      author: "a",
      kind: "file",
      filename: "a.bin",
      mime: "application/octet-stream",
      body: new Uint8Array([0, 1, 2, 255]),
    }
    expect(plain(decodePost(encodePost(file)))).toStrictEqual(plain(file))
    expect(plain(decodePost(encodePost(msg("m1", 1, "hello"))))).toStrictEqual(plain(msg("m1", 1, "hello")))
    expect(decodePost(new Uint8Array([0, 0, 0, 9, 1]))).toBeNull()
  })

  it("exchanges keys and delivers posts to confirmed peers", async () => {
    const keys = await deriveLiveKeys(genLiveSecret())
    const [alice, bob, carol] = await Promise.all([endpoint(keys), endpoint(keys), endpoint(keys)])
    const room: Endpoint[] = []
    await join(room, alice)
    expect(alice.session.confirmedCount).toStrictEqual(0)
    expect(await alice.session.encryptPost(msg("m0", 0))).toBeNull()

    await join(room, bob)
    await join(room, carol)
    for (const peer of room) expect(peer.session.confirmedCount).toStrictEqual(2)

    const frame = (await alice.session.encryptPost(msg("m1", 1, "secret text")))!
    expect(new TextDecoder().decode(frame)).not.toContain("secret text")
    await broadcast(room, alice, frame)
    expect(bob.inbox.map(plain)).toStrictEqual([plain(msg("m1", 1, "secret text"))])
    expect(carol.inbox.map(plain)).toStrictEqual([plain(msg("m1", 1, "secret text"))])
  })

  it("does not let the room link alone decrypt recorded posts", async () => {
    const keys = await deriveLiveKeys(genLiveSecret())
    const room: Endpoint[] = []
    const [alice, bob] = await Promise.all([endpoint(keys), endpoint(keys)])
    await join(room, alice)
    await join(room, bob)
    const recorded = (await alice.session.encryptPost(msg("m1", 1, "old post")))!

    // a later page with the same link, even fed the recorded frame, cannot read it
    const eve = await endpoint(keys)
    expect(await eve.session.receive(recorded)).toStrictEqual({ replies: [] })
    await join(room, eve)
    expect(await eve.session.receive(recorded)).toStrictEqual({ replies: [] })
    // nor can a page in another room
    const mallory = await endpoint(await deriveLiveKeys(genLiveSecret()))
    expect(await mallory.session.receive(recorded)).toStrictEqual({ replies: [] })
  })

  it("does not confirm a replayed hello", async () => {
    const keys = await deriveLiveKeys(genLiveSecret())
    const bob = await endpoint(keys)
    const recordedHello = await bob.session.hello()
    const carol = await endpoint(keys)
    // bob is gone: carol answers the replayed hello but nobody can prove to be bob
    const { replies } = await carol.session.receive(recordedHello)
    expect(replies.length).toStrictEqual(1)
    expect(carol.session.confirmedCount).toStrictEqual(0)
    expect(await carol.session.encryptPost(msg("m1", 1))).toBeNull()
  })

  it("rejects tampered posts and posts sent before joining", async () => {
    const keys = await deriveLiveKeys(genLiveSecret())
    const room: Endpoint[] = []
    const [alice, bob] = await Promise.all([endpoint(keys), endpoint(keys)])
    await join(room, alice)
    await join(room, bob)
    const frame = (await alice.session.encryptPost(msg("m1", 1, "hello")))!
    const tampered = frame.slice()
    tampered[tampered.length - 1] ^= 1
    expect(await bob.session.receive(tampered)).toStrictEqual({ replies: [] })

    const carol = await endpoint(keys)
    await join(room, carol)
    expect(await carol.session.receive(frame)).toStrictEqual({ replies: [] })
    expect((await bob.session.receive(frame)).message).toBeDefined()
  })

  it("forgets peers that leave or go silent", async () => {
    const keys = await deriveLiveKeys(genLiveSecret())
    const room: Endpoint[] = []
    const [alice, bob, carol] = await Promise.all([endpoint(keys), endpoint(keys), endpoint(keys)])
    await join(room, alice)
    await join(room, bob)
    await join(room, carol)

    await broadcast(room, carol, await carol.session.bye())
    expect(alice.session.confirmedCount).toStrictEqual(1)

    // an alive keeps bob around, a replayed one does not
    const later = Date.now() + LIVE_PEER_TIMEOUT_MS - 1000
    const alive = await bob.session.alive()
    expect(await alice.session.receive(alive, later)).toStrictEqual({ replies: [] })
    alice.session.prune(later + 2000)
    expect(alice.session.confirmedCount).toStrictEqual(1)
    await alice.session.receive(alive, later + LIVE_PEER_TIMEOUT_MS)
    alice.session.prune(later + LIVE_PEER_TIMEOUT_MS + 2000)
    expect(alice.session.confirmedCount).toStrictEqual(0)
  })

  it("builds socket URLs", () => {
    expect(liveSocketUrl("https://example.com", "ab")).toStrictEqual("wss://example.com/live/ws/ab")
    expect(liveSocketUrl("http://localhost:8787", "ab")).toStrictEqual("ws://localhost:8787/live/ws/ab")
  })
})

describe("live page memory", () => {
  it("drops the oldest messages beyond the byte budget", () => {
    const big = (id: string): LiveMessage => ({ ...msg(id, 0), body: new Uint8Array(LIVE_MAX_PAGE_BYTES / 2) })
    let msgs: LiveMessage[] = []
    for (const id of ["a", "b", "c"]) msgs = appendMessage(msgs, big(id))
    expect(msgs.map((m) => m.id)).toStrictEqual(["b", "c"])
  })

  it("ignores a replayed message", () => {
    const msgs = appendMessage([], msg("a", 1))
    expect(appendMessage(msgs, msg("a", 1))).toBe(msgs)
  })
})

describe("live nickname", () => {
  it("generates a prefix followed by a number", () => {
    for (let i = 0; i < 100; i++) {
      expect(genNickname()).toMatch(/^[ァ-ヴA-Z]+[0-9]+$/)
    }
  })
})

// In-memory stand-in for the LiveRoom Durable Object
class FakeRelay {
  sockets = new Set<FakeWebSocket>()

  announcePeers() {
    for (const ws of this.sockets)
      ws.deliver(JSON.stringify({ t: "peers", n: this.sockets.size } satisfies LiveControlFrame))
  }

  join(ws: FakeWebSocket) {
    this.sockets.add(ws)
    this.announcePeers()
  }

  leave(ws: FakeWebSocket) {
    this.sockets.delete(ws)
    this.announcePeers()
  }

  relay(from: FakeWebSocket, data: string | Uint8Array) {
    if (data === LIVE_PING || typeof data === "string") return
    for (const peer of this.sockets) {
      if (peer !== from) peer.deliver(data.slice().buffer)
    }
  }
}

let relay: FakeRelay

class FakeWebSocket {
  static readonly OPEN = 1
  readyState = 0
  binaryType = "blob"
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null
  onclose: (() => void) | null = null

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN
      this.onopen?.()
      relay.join(this)
    })
  }

  deliver(data: string | ArrayBuffer) {
    setTimeout(() => this.onmessage?.({ data }))
  }

  send(data: string | Uint8Array) {
    relay.relay(this, data)
  }

  close() {
    if (this.readyState !== FakeWebSocket.OPEN) return
    this.readyState = 3
    relay.leave(this)
    setTimeout(() => this.onclose?.())
  }
}

describe("useLiveRoom", () => {
  beforeEach(() => {
    relay = new FakeRelay()
    vi.stubGlobal("WebSocket", FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("delivers posts to peers online at the time", async () => {
    const secret = genLiveSecret()
    const { roomId } = await deriveLiveKeys(secret)
    const alice = renderHook(() => useLiveRoom("https://example.com", secret))
    const bob = renderHook(() => useLiveRoom("https://example.com", secret))
    await waitFor(() => expect(alice.result.current.peerCount).toStrictEqual(2))
    await waitFor(() => expect(bob.result.current.peerCount).toStrictEqual(2))
    expect([...relay.sockets][0].url).toStrictEqual(`wss://example.com/live/ws/${roomId}`)

    await act(() => alice.result.current.send(textPost("alice", "first post")))
    await act(() => bob.result.current.send(textPost("bob", "second post")))
    await waitFor(() => expect(bob.result.current.messages.length).toStrictEqual(2))
    await waitFor(() => expect(alice.result.current.messages.length).toStrictEqual(2))
    expect(bodies(alice.result.current.messages)).toStrictEqual(["first post", "second post"])
    expect(alice.result.current.messages[1]).toMatchObject({ author: "bob", kind: "text", lang: "js" })
    expect(alice.result.current.messages.map((m) => m.isOwn)).toStrictEqual([true, false])

    // a newcomer only sees what is posted after joining
    const carol = renderHook(() => useLiveRoom("https://example.com", secret))
    await waitFor(() => expect(carol.result.current.peerCount).toStrictEqual(3))
    await waitFor(() => expect(bob.result.current.peerCount).toStrictEqual(3))
    expect(carol.result.current.messages).toStrictEqual([])
    await act(() => bob.result.current.send(textPost("bob", "third post")))
    await waitFor(() => expect(bodies(carol.result.current.messages)).toStrictEqual(["third post"]))

    alice.unmount()
    await waitFor(() => expect(bob.result.current.peerCount).toStrictEqual(2))

    bob.unmount()
    carol.unmount()
  })

  it("fails a send when the connection drops while encrypting", async () => {
    const secret = genLiveSecret()
    const alice = renderHook(() => useLiveRoom("https://example.com", secret))
    await waitFor(() => expect(alice.result.current.status).toStrictEqual("open"))
    const socket = [...relay.sockets][0]
    const sending = alice.result.current.send(textPost("alice", "lost"))
    socket.close()
    await expect(sending).rejects.toThrow("Connection lost")
    expect(alice.result.current.messages).toStrictEqual([])
    alice.unmount()
  })
})

describe("LivePaste", () => {
  beforeEach(() => {
    relay = new FakeRelay()
    stubBrowerFunctions()
    vi.stubGlobal("WebSocket", FakeWebSocket)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("warns when nobody else is in the room", async () => {
    render(<LivePaste config={__WRANGLER_CONFIG__} />)
    expect(await screen.findByText("· nobody will see your post!")).toBeInTheDocument()
  })

  it("shows the room id in the title", async () => {
    render(<LivePaste config={__WRANGLER_CONFIG__} />)
    const { roomId } = await deriveLiveKeys(location.hash.slice(1))
    await waitFor(() =>
      expect(document.title).toStrictEqual(
        `${__WRANGLER_CONFIG__.INDEX_PAGE_TITLE} / Live (Room ${roomId.slice(0, 8)})`,
      ),
    )
  })

  it("rolls a new nickname", async () => {
    render(<LivePaste config={__WRANGLER_CONFIG__} />)
    const input = screen.getByLabelText<HTMLInputElement>("Nickname")
    const before = input.value
    expect(before).not.toStrictEqual("")

    // retry in case the roll happens to produce the same name
    for (let i = 0; i < 5 && input.value === before; i++) {
      await userEvent.click(screen.getByRole("button", { name: "Roll a new nickname" }))
    }
    expect(input.value).not.toStrictEqual(before)
  })

  it("posts text and files from the editor", async () => {
    render(<LivePaste config={__WRANGLER_CONFIG__} />)
    const postButton = screen.getByRole("button", { name: "Post" })

    await userEvent.type(screen.getByLabelText("Paste editor"), "hello live")
    await waitFor(() => expect(postButton).toBeEnabled())
    await userEvent.click(postButton)
    const textPost = await screen.findByRole("article")
    expect(textPost.textContent).toContain("hello live")
    expect(screen.getByLabelText<HTMLTextAreaElement>("Paste editor").value).toStrictEqual("")

    const fileInput = document.querySelector<HTMLInputElement>("input[type=file]")!
    await userEvent.upload(fileInput, new File(["binary"], "data.bin", { type: "application/octet-stream" }))
    await userEvent.click(postButton)
    expect(await screen.findByText("Download data.bin")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Clear posts" }))
    expect(screen.queryByText("Download data.bin")).toBeNull()
    expect(screen.getByText(/No posts yet/)).toBeInTheDocument()
  })
})

describe("LivePostCard", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders markdown and toggles to raw", async () => {
    const md: LiveMessage = {
      ...msg("m1", 1, "# Title\n\n[in page](#x) <script>alert(1)</script>"),
      lang: "markdown",
    }
    render(<LivePostCard msg={md} isOwn={false} />)
    const heading = await screen.findByRole("heading", { name: "Title" })
    expect(heading.id).toStrictEqual("")
    expect(document.querySelector("script")).toBeNull()

    // in-page links must not replace the room key in the URL fragment
    const hashBefore = location.hash
    await userEvent.click(screen.getByText("in page"))
    expect(location.hash).toStrictEqual(hashBefore)

    await userEvent.click(screen.getByRole("button", { name: "Raw" }))
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.getByRole("article").textContent).toContain("# Title")
    await userEvent.click(screen.getByRole("button", { name: "Rendered" }))
    expect(await screen.findByRole("heading", { name: "Title" })).toBeInTheDocument()
  })

  it("only offers large text for download", () => {
    render(<LivePostCard msg={msg("m1", 1, "x".repeat(600 * 1024))} isOwn={false} />)
    expect(screen.queryByRole("article")).toBeNull()
    expect(screen.getByText(/Too large to display/)).toBeInTheDocument()
  })

  it("previews raster images but not SVG", () => {
    const file = (mime: string): LiveMessage => ({ ...msg("m1", 1), kind: "file", filename: "a", mime })
    render(<LivePostCard msg={file("image/png")} isOwn={false} />)
    expect(screen.getByRole("img")).toBeInTheDocument()
    cleanup()
    render(<LivePostCard msg={file("image/svg+xml")} isOwn={false} />)
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByText("Download a")).toBeInTheDocument()
  })

  it("shows plain text posts as code", () => {
    render(<LivePostCard msg={msg("m1", 1, "# not a heading")} isOwn={false} />)
    expect(screen.queryByRole("button", { name: "Raw" })).toBeNull()
    expect(screen.getByRole("article").textContent).toContain("# not a heading")
  })
})
