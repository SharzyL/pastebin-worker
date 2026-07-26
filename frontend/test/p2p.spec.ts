import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startP2PReceiver } from "../utils/p2pReceiver.js"
import { startP2PSender } from "../utils/p2pSender.js"
import type { P2PFileMeta, P2PProgress, P2PSenderPeerInfo } from "../utils/p2pCommon.js"
import type { P2PCreateResponse, PublicEnv } from "../../shared/interfaces.js"
import { sha1Hex, verificationBlockSize } from "../utils/p2pCommon.js"
import {
  readP2PResumeCheckpoint,
  readP2PSessionPeerId,
  removeP2PResumeCheckpoint,
  writeP2PResumeCheckpoint,
} from "../utils/p2pReceiveStore.js"

class MockDataChannel extends EventTarget {
  readonly label = "file"
  readyState: RTCDataChannelState = "open"
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  binaryType: BinaryType = "arraybuffer"
  sent: (string | ArrayBuffer | ArrayBufferView)[] = []
  onopen: ((this: RTCDataChannel, ev: Event) => unknown) | null = null
  onmessage: ((this: RTCDataChannel, ev: MessageEvent) => unknown) | null = null

  send(data: string | ArrayBuffer | ArrayBufferView) {
    this.sent.push(data)
  }

  close() {
    this.readyState = "closed"
    this.dispatchEvent(new Event("close"))
  }

  open() {
    this.onopen?.call(this as unknown as RTCDataChannel, new Event("open"))
  }

  receive(message: object) {
    this.receiveData(JSON.stringify(message))
  }

  receiveData(data: unknown) {
    this.onmessage?.call(this as unknown as RTCDataChannel, new MessageEvent("message", { data }))
  }
}

class MockPeerConnection {
  static instances: MockPeerConnection[] = []

  readonly dataChannel = new MockDataChannel()
  connectionState: RTCPeerConnectionState = "new"
  remoteDescription: RTCSessionDescription | null = null
  onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => unknown) | null = null
  onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null
  ondatachannel: ((this: RTCPeerConnection, ev: RTCDataChannelEvent) => unknown) | null = null

  constructor(readonly configuration?: RTCConfiguration) {
    MockPeerConnection.instances.push(this)
  }

  createDataChannel() {
    return this.dataChannel as unknown as RTCDataChannel
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: "offer", sdp: "offer" })
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: "answer", sdp: "answer" })
  }

  setLocalDescription() {
    return Promise.resolve()
  }

  setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description as RTCSessionDescription
    return Promise.resolve()
  }

  addIceCandidate() {
    return Promise.resolve()
  }

  close() {
    this.connectionState = "closed"
  }

  receiveDataChannel(channel = this.dataChannel) {
    this.ondatachannel?.call(
      this as unknown as RTCPeerConnection,
      { channel: channel as unknown as RTCDataChannel } as RTCDataChannelEvent,
    )
  }
}

class MockWebSocket {
  static readonly OPEN = 1
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.OPEN
  sent: string[] = []
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }

  receive(message: object) {
    this.onmessage?.call(this as unknown as WebSocket, new MessageEvent("message", { data: JSON.stringify(message) }))
  }
}

interface ReadResult {
  done: boolean
  value?: Uint8Array<ArrayBuffer>
}

class ControlledReader {
  private pending: ((result: ReadResult) => void)[] = []
  cancel = vi.fn(() => Promise.resolve())

  read(): Promise<ReadResult> {
    return new Promise((resolve) => this.pending.push(resolve))
  }

  releaseLock() {
    // Mock reader locks do not require cleanup.
  }

  resolveNext(result: ReadResult) {
    const resolve = this.pending.shift()
    if (!resolve) throw new Error("No pending read")
    resolve(result)
  }

  get pendingReads() {
    return this.pending.length
  }
}

class MockMessagePort {
  peer?: MockMessagePort
  onmessage: ((event: MessageEvent) => void) | null = null

  postMessage() {
    queueMicrotask(() => this.peer?.onmessage?.(new MessageEvent("message")))
  }

  close() {
    // The production scheduler keeps its shared ports open for the page lifetime.
  }
}

class CountingMessageChannel {
  static instances = 0
  readonly port1 = new MockMessagePort()
  readonly port2 = new MockMessagePort()

  constructor() {
    CountingMessageChannel.instances += 1
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

class MockStorageWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(
    message: { id: number; type: string; checkpointBytes?: number; tailOffset?: number },
    transfer: Transferable[] = [],
  ) {
    const request = transfer.length > 0 ? structuredClone(message, { transfer }) : message
    queueMicrotask(() => {
      const tailLength = Math.max(0, (request.checkpointBytes ?? 0) - (request.tailOffset ?? 0))
      this.onmessage?.(
        new MessageEvent("message", {
          data: {
            id: request.id,
            ok: true,
            value: request.type === "open" ? { tail: new ArrayBuffer(tailLength) } : undefined,
          },
        }),
      )
    })
  }

  terminate() {
    // No worker resources are held by this test double.
  }
}

interface BufferedStorageRequest {
  id: number
  type: "open" | "write" | "flush" | "close" | "discard"
  peerId?: string
  checkpointBytes?: number
  tailOffset?: number
  position?: number
  parts?: ArrayBuffer[]
}

class BufferedStorageWorker {
  static files = new Map<string, Uint8Array<ArrayBuffer>>()

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private filename?: string

  postMessage(message: BufferedStorageRequest, transfer: Transferable[] = []) {
    const request = transfer.length > 0 ? structuredClone(message, { transfer }) : message
    queueMicrotask(() => {
      let value: unknown
      if (request.type === "open") {
        this.filename = `p2p-${request.peerId}.tmp`
        const checkpointBytes = request.checkpointBytes ?? 0
        const tailOffset = request.tailOffset ?? 0
        let stored = BufferedStorageWorker.files.get(this.filename) ?? new Uint8Array(0)
        if (stored.byteLength !== checkpointBytes) stored = stored.slice(0, checkpointBytes)
        BufferedStorageWorker.files.set(this.filename, stored)
        value = { tail: stored.slice(tailOffset, checkpointBytes).buffer }
      } else if (request.type === "write") {
        if (!this.filename) throw new Error("Storage worker was not opened")
        const parts = request.parts ?? []
        const position = request.position ?? 0
        const writtenBytes = parts.reduce((sum, part) => sum + part.byteLength, 0)
        const existing = BufferedStorageWorker.files.get(this.filename) ?? new Uint8Array(0)
        const stored = new Uint8Array(Math.max(existing.byteLength, position + writtenBytes))
        stored.set(existing)
        let writePosition = position
        for (const part of parts) {
          stored.set(new Uint8Array(part), writePosition)
          writePosition += part.byteLength
        }
        BufferedStorageWorker.files.set(this.filename, stored)
      } else if (request.type === "discard" && this.filename) {
        BufferedStorageWorker.files.delete(this.filename)
      }
      this.onmessage?.(new MessageEvent("message", { data: { id: request.id, ok: true, value } }))
    })
  }

  terminate() {
    // No worker resources are held by this test double.
  }
}

const config = {
  ...__WRANGLER_CONFIG__,
  DEPLOY_URL: "https://example.com",
} satisfies PublicEnv

const roomResponse: P2PCreateResponse = {
  name: "room",
  url: "https://example.com/p/room",
  displayUrl: "https://example.com/p/room",
  senderToken: "token",
  expireAt: new Date(Date.now() + 60_000).toISOString(),
  expirationSeconds: 60,
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("P2P transfer lifecycle", () => {
  beforeEach(() => {
    MockPeerConnection.instances = []
    MockWebSocket.instances = []
    BufferedStorageWorker.files.clear()
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection)
    vi.stubGlobal("WebSocket", MockWebSocket)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json(roomResponse))),
    )
  })

  afterEach(() => {
    removeP2PResumeCheckpoint("room")
    sessionStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("cleans up a disk-backed sender file when the session closes", async () => {
    const cleanup = vi.fn(() => Promise.resolve())
    const session = await startP2PSender(
      new File(["data"], "file.bin"),
      config,
      "1h",
      "1",
      false,
      {
        onStatus: vi.fn(),
        onPeersChange: vi.fn(),
        onError: vi.fn(),
      },
      undefined,
      undefined,
      cleanup,
    )

    session.close()

    expect(MockWebSocket.instances[0].sent).toContain(JSON.stringify({ type: "sender-leave" }))
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
  })

  it("uses WebSocket signaling as the sender ICE server source", async () => {
    const onIceServersChange = vi.fn()
    const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onIceServersChange,
      onError: vi.fn(),
    })
    const iceServers = [
      {
        urls: ["stun:stun.example.com:3478", "turn:turn.example.com:3478?transport=tcp"],
        username: "2000000000:p2p",
        credential: "temporary-credential",
      },
    ]

    MockWebSocket.instances[0].receive({
      type: "ready",
      role: "sender",
      iceServers,
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })

    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    expect(onIceServersChange).toHaveBeenCalledWith(iceServers)
    expect(MockPeerConnection.instances[0].configuration).toStrictEqual({ iceServers })
    session.close()
  })

  it("reuses a tab-scoped receiver ID across a refresh without requiring a checkpoint", () => {
    const callbacks = {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error: Error) => {
        throw error
      }),
    }
    const firstSession = startP2PReceiver("room", config, callbacks)
    const firstPeerId = new URL(MockWebSocket.instances[0].url).searchParams.get("peerId")
    expect(firstPeerId).toMatch(/^[0-9a-f-]{36}$/i)

    firstSession.close()
    const refreshedSession = startP2PReceiver("room", config, callbacks)
    const refreshedPeerId = new URL(MockWebSocket.instances[1].url).searchParams.get("peerId")

    expect(readP2PResumeCheckpoint("room")).toBeUndefined()
    expect(refreshedPeerId).toStrictEqual(firstPeerId)
    refreshedSession.close()
  })

  it("restores a persisted receiver ID at its durable offset and waits for resume", async () => {
    const peerId = "00000000-0000-4000-8000-000000000051"
    const meta: P2PFileMeta = {
      revision: "saved-revision",
      name: "saved.bin",
      size: 20,
      type: "application/octet-stream",
      lastModified: 1,
      verifyTransfer: false,
    }
    expect(
      writeP2PResumeCheckpoint({
        version: 1,
        roomName: "room",
        peerId,
        meta,
        receivedBytes: 10,
        completedHashes: [],
        updatedAt: Date.now(),
      }),
    ).toStrictEqual(true)

    const root = {
      async *entries() {
        // No stale files are present.
      },
    }
    vi.stubGlobal("Worker", MockStorageWorker)
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: vi.fn(() => Promise.resolve(root)),
        persist: vi.fn(() => Promise.resolve(true)),
      },
    })
    const onMeta = vi.fn<(value: P2PFileMeta) => void>()
    const onPausedChange = vi.fn<(isPaused: boolean) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta,
      onProgress: vi.fn(),
      onPausedChange,
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    const ws = MockWebSocket.instances[0]
    expect(new URL(ws.url).searchParams.get("peerId")).toStrictEqual(peerId)
    expect(onMeta).toHaveBeenCalledWith(meta)
    ws.receive({ type: "ready", role: "receiver", peers: { sender: true, receivers: [] } })
    await vi.waitFor(() =>
      expect(ws.sent.map((message) => JSON.parse(message) as { type?: string })).toContainEqual({
        type: "transfer-checkpoint",
      }),
    )
    ws.receive({ type: "offer", peerId, sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    const downloadMessages = () =>
      channel.sent
        .filter((part): part is string => typeof part === "string")
        .map((part) => JSON.parse(part) as { type?: string; offset?: number })
        .filter((message) => message.type === "download")
    expect(onPausedChange).toHaveBeenCalledWith(true)
    expect(downloadMessages()).toHaveLength(0)

    session.resume()
    await vi.waitFor(() => expect(downloadMessages().some((message) => message.offset === 10)).toStrictEqual(true))
    session.close()
  })

  it("reports every restored checkpoint as paused to the sender", async () => {
    const peerId = "00000000-0000-4000-8000-000000000053"
    const meta: P2PFileMeta = {
      revision: "paused-revision",
      name: "paused.bin",
      size: 20,
      type: "application/octet-stream",
      lastModified: 1,
      verifyTransfer: false,
    }
    expect(
      writeP2PResumeCheckpoint({
        version: 1,
        roomName: "room",
        peerId,
        meta,
        receivedBytes: 10,
        completedHashes: [],
        updatedAt: Date.now(),
      }),
    ).toStrictEqual(true)

    const root = {
      async *entries() {
        // No stale files are present.
      },
    }
    vi.stubGlobal("Worker", MockStorageWorker)
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn(() => Promise.resolve(root)) },
    })
    const onStatus = vi.fn<(status: string) => void>()
    const onPausedChange = vi.fn<(isPaused: boolean) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus,
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange,
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })

    await vi.waitFor(() => expect(onPausedChange).toHaveBeenCalledWith(true))
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "ready", role: "receiver", peers: { sender: true, receivers: [] } })
    ws.receive({ type: "offer", peerId, sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({ type: "meta", meta })

    const controlMessages = () =>
      channel.sent
        .filter((part): part is string => typeof part === "string")
        .map((part) => JSON.parse(part) as { type?: string; doneBytes?: number; offset?: number })
    await vi.waitFor(() => {
      expect(controlMessages()).toContainEqual({ type: "progress", doneBytes: 10, revision: meta.revision })
      expect(controlMessages()).toContainEqual({ type: "pause" })
    })
    expect(controlMessages().some((message) => message.type === "download")).toStrictEqual(false)
    expect(onStatus).toHaveBeenLastCalledWith("Paused.")

    session.resume()
    await vi.waitFor(() =>
      expect(controlMessages().some((message) => message.type === "download" && message.offset === 10)).toStrictEqual(
        true,
      ),
    )
    session.close()
  })

  it("does not open the same room in a second tab while the first receiver is ready", async () => {
    const heldLocks = new Set<string>()
    const requestLock = vi.fn(
      (lockName: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
        if (heldLocks.has(lockName)) return callback(null)
        heldLocks.add(lockName)
        const lock: Lock = { name: lockName, mode: "exclusive" }
        return callback(lock).finally(() => heldLocks.delete(lockName))
      },
    )
    vi.stubGlobal("navigator", {
      locks: {
        request: requestLock,
      },
      storage: {},
    })
    const firstStatus = vi.fn<(status: string) => void>()
    const firstSession = startP2PReceiver("room", config, {
      onStatus: firstStatus,
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    const firstPeerId = readP2PSessionPeerId("room")
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { name: "ready.bin", size: 20, type: "", lastModified: 0, verifyTransfer: false },
    })
    await vi.waitFor(() => expect(firstStatus).toHaveBeenLastCalledWith("File details received. Ready to receive."))

    sessionStorage.clear()
    const secondStatus = vi.fn<(status: string) => void>()
    const secondSession = startP2PReceiver("room", config, {
      onStatus: secondStatus,
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })

    expect(readP2PSessionPeerId("room")).not.toStrictEqual(firstPeerId)
    await vi.waitFor(() => expect(secondStatus).toHaveBeenCalledWith("This P2P room is already open in another tab."))
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(requestLock.mock.calls.map(([lockName]) => lockName)).toStrictEqual([
      "pastebin-worker:p2p-receiver-room:room",
      "pastebin-worker:p2p-receiver-room:room",
    ])

    secondSession.close()
    firstSession.close()
    await vi.waitFor(() => expect(heldLocks.size).toStrictEqual(0))
  })

  it("publishes a resumable receiver ID once while continuing to advance local checkpoints", async () => {
    const root = {
      async *entries() {
        // No stale files are present.
      },
    }
    const persist = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal("Worker", MockStorageWorker)
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: vi.fn(() => Promise.resolve(root)),
        persist,
      },
    })
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "sender", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    const size = 2 * 1024 * 1024 + 1
    channel.receive({
      type: "meta",
      meta: {
        revision: "checkpoint-revision",
        name: "checkpoint.bin",
        size,
        type: "application/octet-stream",
        lastModified: 1,
        verifyTransfer: false,
      },
    })
    await flushTasks()
    session.requestDownload()
    expect(persist).not.toHaveBeenCalled()
    channel.receiveData(new ArrayBuffer(1024 * 1024))

    await vi.waitFor(() => expect(readP2PResumeCheckpoint("room")?.receivedBytes).toStrictEqual(1024 * 1024))
    expect(
      ws.sent
        .map((message) => JSON.parse(message) as { type?: string })
        .some((message) => message.type === "transfer-checkpoint"),
    ).toStrictEqual(true)

    ws.receive({ type: "transfer-checkpoint-result", accepted: true })
    channel.receiveData(new ArrayBuffer(1024 * 1024))
    await vi.waitFor(() => expect(readP2PResumeCheckpoint("room")?.receivedBytes).toStrictEqual(2 * 1024 * 1024))
    expect(
      ws.sent
        .map((message) => JSON.parse(message) as { type?: string })
        .filter((message) => message.type === "transfer-checkpoint"),
    ).toHaveLength(1)

    session.close()
  })

  it("terminates a transfer without rebuilding signaling or WebRTC", async () => {
    const onProgress = vi.fn<(progress: P2PProgress | undefined) => void>()
    const onStatus = vi.fn<(status: string) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus,
      onMeta: vi.fn(),
      onProgress,
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "sender", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const peer = MockPeerConnection.instances[0]
    const channel = peer.dataChannel
    peer.receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: {
        revision: "reuse-revision",
        name: "reuse.bin",
        size: 4,
        type: "application/octet-stream",
        lastModified: 1,
        verifyTransfer: false,
      },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(new Uint8Array([1, 2]).buffer)
    await flushTasks()

    session.terminate()

    expect(onProgress).toHaveBeenLastCalledWith({ doneBytes: 0, totalBytes: 4, speedBytesPerSecond: 0 })
    expect(
      channel.sent.some((part) => typeof part === "string" && (JSON.parse(part) as { type?: string }).type === "stop"),
    ).toStrictEqual(true)
    expect(ws.sent.map((message) => JSON.parse(message) as { type?: string })).not.toContainEqual(
      expect.objectContaining({ type: "transfer-abandon" }),
    )

    channel.receive({ type: "stopped" })
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith("Transfer terminated. Receive the file again to start over."),
    )
    expect(onProgress).toHaveBeenLastCalledWith(undefined)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockPeerConnection.instances).toHaveLength(1)
    expect(ws.readyState).toStrictEqual(MockWebSocket.OPEN)
    expect(peer.connectionState).not.toStrictEqual("closed")
    expect(channel.readyState).toStrictEqual("open")

    session.requestDownload()
    await vi.waitFor(() =>
      expect(
        channel.sent
          .filter((part): part is string => typeof part === "string")
          .map((part) => JSON.parse(part) as { type?: string; offset?: number })
          .filter((message) => message.type === "download"),
      ).toHaveLength(2),
    )
    expect(
      channel.sent
        .filter((part): part is string => typeof part === "string")
        .map((part) => JSON.parse(part) as { type?: string; offset?: number })
        .filter((message) => message.type === "download")
        .slice(-1)[0],
    ).toMatchObject({ type: "download", offset: 0 })

    session.close()
  })

  it("retries termination on a rebuilt data channel when WebRTC fails before acknowledgement", async () => {
    const onStatus = vi.fn<(status: string) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus,
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "sender", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const firstPeer = MockPeerConnection.instances[0]
    const firstChannel = firstPeer.dataChannel
    firstPeer.receiveDataChannel(firstChannel)
    firstChannel.open()
    firstChannel.receive({
      type: "meta",
      meta: {
        revision: "recovery-revision",
        name: "recovery.bin",
        size: 4,
        type: "application/octet-stream",
        lastModified: 1,
        verifyTransfer: false,
      },
    })
    await flushTasks()
    session.requestDownload()
    firstPeer.connectionState = "failed"
    firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
    session.terminate()
    await vi.waitFor(() =>
      expect(
        ws.sent
          .map((message) => JSON.parse(message) as { type?: string })
          .some((message) => message.type === "peer-reconnect-request"),
      ).toStrictEqual(true),
    )

    ws.receive({
      type: "offer",
      peerId: "sender",
      negotiationId: "00000000-0000-4000-8000-000000000061",
      sdp: { type: "offer", sdp: "rebuilt-offer" },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(2))
    const rebuiltPeer = MockPeerConnection.instances[1]
    const rebuiltChannel = rebuiltPeer.dataChannel
    rebuiltPeer.receiveDataChannel(rebuiltChannel)
    rebuiltChannel.open()

    expect(
      rebuiltChannel.sent.some(
        (part) => typeof part === "string" && (JSON.parse(part) as { type?: string }).type === "stop",
      ),
    ).toStrictEqual(true)

    rebuiltChannel.receive({ type: "stopped" })
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith("Transfer terminated. Receive the file again to start over."),
    )
    expect(MockWebSocket.instances).toHaveLength(1)

    session.requestDownload()
    await vi.waitFor(() =>
      expect(
        rebuiltChannel.sent
          .filter((part): part is string => typeof part === "string")
          .map((part) => JSON.parse(part) as { type?: string; offset?: number })
          .some((message) => message.type === "download" && message.offset === 0),
      ).toStrictEqual(true),
    )
    session.close()
  })

  it("clears a durable checkpoint on termination without abandoning the receiver session", async () => {
    const root = {
      async *entries() {
        // No stale files are present.
      },
    }
    vi.stubGlobal("Worker", MockStorageWorker)
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: vi.fn(() => Promise.resolve(root)),
      },
    })
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "sender", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const peer = MockPeerConnection.instances[0]
    const channel = peer.dataChannel
    peer.receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: {
        revision: "durable-termination",
        name: "durable.bin",
        size: 2 * 1024 * 1024,
        type: "application/octet-stream",
        lastModified: 1,
        verifyTransfer: false,
      },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(new ArrayBuffer(1024 * 1024))
    await vi.waitFor(() => expect(readP2PResumeCheckpoint("room")?.receivedBytes).toStrictEqual(1024 * 1024))

    session.terminate()
    await vi.waitFor(() => expect(readP2PResumeCheckpoint("room")).toBeUndefined())
    channel.receive({ type: "stopped" })

    const signalTypes = ws.sent.map((message) => (JSON.parse(message) as { type?: string }).type)
    expect(signalTypes).toContain("transfer-checkpoint-clear")
    expect(signalTypes).not.toContain("transfer-abandon")
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockPeerConnection.instances).toHaveLength(1)
    expect(channel.readyState).toStrictEqual("open")
    session.close()
  })

  it("does not let a paused reader resume after a new download starts", async () => {
    const readers: ControlledReader[] = []
    const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
    const file = {
      name: "file.bin",
      size: 4,
      type: "application/octet-stream",
      lastModified: 0,
      slice: vi.fn(() => ({
        stream: () => {
          const reader = new ControlledReader()
          readers.push(reader)
          return { getReader: () => reader }
        },
      })),
    } as unknown as File

    const session = await startP2PSender(
      file,
      config,
      "1h",
      "1",
      false,
      {
        onStatus: vi.fn(),
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      },
      undefined,
      "typescript",
    )

    const ws = MockWebSocket.instances[0]
    ws.onopen?.call(ws as unknown as WebSocket, new Event("open"))
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))

    const dc = MockPeerConnection.instances[0].dataChannel
    dc.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
    await flushTasks()
    const metaMessage = dc.sent
      .filter((part): part is string => typeof part === "string")
      .map(
        (part) =>
          JSON.parse(part) as { type?: string; meta?: { verifyTransfer?: boolean; highlightLanguage?: string } },
      )
      .find((message) => message.type === "meta")
    expect(metaMessage?.meta?.verifyTransfer).toStrictEqual(false)
    expect(metaMessage?.meta?.highlightLanguage).toStrictEqual("typescript")

    dc.receive({ type: "download", offset: 0 })
    await vi.waitFor(() => expect(readers[0]?.pendingReads).toBe(1))
    dc.receive({ type: "pause" })
    expect(
      dc.sent.some((part) => typeof part === "string" && (JSON.parse(part) as { type?: unknown }).type === "paused"),
    ).toStrictEqual(true)
    dc.receive({ type: "download", offset: 0 })
    await vi.waitFor(() => expect(readers[1]?.pendingReads).toBe(1))

    readers[0].resolveNext({ done: false, value: new Uint8Array([9, 9, 9, 9]) })
    await flushTasks()
    expect(dc.sent.filter((part) => typeof part !== "string")).toHaveLength(0)

    readers[1].resolveNext({ done: false, value: new Uint8Array([1, 2, 3, 4]) })
    await vi.waitFor(() => expect(dc.sent.filter((part) => typeof part !== "string")).toHaveLength(1))
    await vi.waitFor(() => expect(readers[1].pendingReads).toBe(1))
    readers[1].resolveNext({ done: true })
    await flushTasks()

    expect(readers[0].cancel).toHaveBeenCalledTimes(1)
    expect(Array.from(dc.sent.find((part) => typeof part !== "string") as Uint8Array)).toStrictEqual([1, 2, 3, 4])
    expect(
      dc.sent.some((part) => typeof part === "string" && (JSON.parse(part) as { type?: unknown }).type === "done"),
    ).toStrictEqual(true)
    const latestPeerBeforeFeedback = onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]
    expect(latestPeerBeforeFeedback?.progress).toBeUndefined()

    dc.receive({ type: "progress", doneBytes: 4 })
    const latestPeerAfterFeedback = onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]
    expect(latestPeerAfterFeedback?.progress?.doneBytes).toStrictEqual(4)
    expect(ws.sent.map((message) => JSON.parse(message) as { type?: string })).not.toContainEqual(
      expect.objectContaining({ type: "transfer-complete" }),
    )
    dc.receive({ type: "received", revision: session.currentFile.revision })
    expect(ws.sent.map((message) => JSON.parse(message) as { type?: string })).toContainEqual(
      expect.objectContaining({ type: "transfer-complete", peerId: "receiver-1" }),
    )

    session.close()
  })

  it("rejects malformed and oversized receiver control messages before starting file I/O", async () => {
    const onError = vi.fn<(error: Error) => void>()
    const file = new File([new Uint8Array([1, 2, 3, 4])], "file.bin")
    const slice = vi.spyOn(file, "slice")
    const session = await startP2PSender(file, config, "1h", "1", false, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onError,
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-invalid" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const dc = MockPeerConnection.instances[0].dataChannel
    dc.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-invalid", accepted: true })
    await flushTasks()

    dc.receiveData(JSON.stringify({ type: "download", offset: "0" }))
    dc.receiveData("x".repeat(1024 * 1024 + 1))

    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls[0][0].message).toContain("download offset")
    expect(onError.mock.calls[1][0].message).toContain("too large")
    expect(slice).not.toHaveBeenCalled()
    session.close()
  })

  it("updates the shared file without changing the room or interrupting an active transfer", async () => {
    const oldReaders: ControlledReader[] = []
    const newReaders: ControlledReader[] = []
    const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
    const controlledFile = (name: string, readers: ControlledReader[]) =>
      ({
        name,
        size: 3,
        type: "application/octet-stream",
        lastModified: 0,
        slice: vi.fn(() => ({
          stream: () => {
            const reader = new ControlledReader()
            readers.push(reader)
            return { getReader: () => reader }
          },
        })),
      }) as unknown as File

    const session = await startP2PSender(controlledFile("old.bin", oldReaders), config, "1h", "1", false, {
      onStatus: vi.fn(),
      onPeersChange,
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const dc = MockPeerConnection.instances[0].dataChannel
    dc.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
    await flushTasks()
    const initialMeta = dc.sent
      .filter((part): part is string => typeof part === "string")
      .map((part) => JSON.parse(part) as { type?: string; meta?: { revision?: string } })
      .find((message) => message.type === "meta")
    expect(session.currentFile.revision).toStrictEqual(initialMeta?.meta?.revision)

    dc.receive({ type: "download", offset: 0 })
    await vi.waitFor(() => expect(oldReaders[0]?.pendingReads).toBe(1))

    const updatedFileInfo = session.updateFile(controlledFile("new.bin", newReaders), false, "json")
    const update = dc.sent
      .filter((part): part is string => typeof part === "string")
      .map(
        (part) =>
          JSON.parse(part) as {
            type?: string
            meta?: { name?: string; revision?: string; highlightLanguage?: string }
          },
      )
      .find((message) => message.type === "file-update")
    expect(update?.meta?.name).toStrictEqual("new.bin")
    expect(update?.meta?.revision).toBeTypeOf("string")
    expect(update?.meta?.highlightLanguage).toStrictEqual("json")
    expect(updatedFileInfo).toStrictEqual({ revision: update?.meta?.revision, name: "new.bin", order: 1 })
    let latestPeers = onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0] || []
    expect(latestPeers.find((peer) => peer.peerId === "receiver-1")?.file.name).toStrictEqual("old.bin")

    ws.receive({ type: "peer-joined", role: "receiver", peerId: "receiver-2" })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(2))
    const newReceiverChannel = MockPeerConnection.instances[1].dataChannel
    newReceiverChannel.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-2", accepted: true })
    await flushTasks()
    latestPeers = onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0] || []
    expect(latestPeers.find((peer) => peer.peerId === "receiver-2")?.file.name).toStrictEqual("new.bin")

    oldReaders[0].resolveNext({ done: false, value: new Uint8Array([1, 2, 3]) })
    await vi.waitFor(() => expect(oldReaders[0].pendingReads).toBe(1))
    oldReaders[0].resolveNext({ done: true })
    await flushTasks()
    dc.receive({ type: "progress", revision: initialMeta?.meta?.revision, doneBytes: 3 })
    dc.receive({ type: "received", revision: initialMeta?.meta?.revision })

    dc.receive({ type: "download", revision: update?.meta?.revision, offset: 0 })
    await vi.waitFor(() => expect(newReaders[0]?.pendingReads).toBe(1))
    newReaders[0].resolveNext({ done: false, value: new Uint8Array([4, 5, 6]) })
    await vi.waitFor(() => expect(newReaders[0].pendingReads).toBe(1))
    newReaders[0].resolveNext({ done: true })
    await flushTasks()
    latestPeers = onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0] || []
    expect(
      latestPeers.some((peer) => peer.peerId === "receiver-1" && peer.file.name === "old.bin" && peer.isComplete),
    ).toStrictEqual(true)
    expect(latestPeers.some((peer) => peer.peerId === "receiver-1" && peer.file.name === "new.bin")).toStrictEqual(true)

    const payloads = dc.sent.filter((part) => typeof part !== "string") as Uint8Array[]
    expect(payloads.map((part) => Array.from(part))).toStrictEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
    expect(session.response).toStrictEqual(roomResponse)
    session.close()
  })

  it("updates expiration and receiver limits with the existing sender token", async () => {
    const updated = {
      expireAt: "2099-01-02T00:00:00.000Z",
      expirationSeconds: 7200,
      maxTransfers: 3,
      joinable: true,
      pairedReceivers: 1,
      successfulReceivers: 1,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      return Promise.resolve(Response.json(url.endsWith("/p2p/create") ? roomResponse : updated))
    })
    vi.stubGlobal("fetch", fetchMock)
    const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })

    const result = await session.updateRoomOptions("2h", "3")
    expect(result).toStrictEqual(updated)
    expect(session.response.expireAt).toStrictEqual(updated.expireAt)
    expect(session.response.expirationSeconds).toStrictEqual(updated.expirationSeconds)
    const updateCall = fetchMock.mock.calls[1]
    const updateUrl =
      typeof updateCall[0] === "string"
        ? updateCall[0]
        : updateCall[0] instanceof URL
          ? updateCall[0].toString()
          : updateCall[0].url
    expect(updateUrl).toStrictEqual(`${config.DEPLOY_URL}/p2p/update/${roomResponse.name}`)
    const init = updateCall[1]!
    if (typeof init.body !== "string") throw new Error("P2P update request body was not JSON")
    expect(JSON.parse(init.body)).toStrictEqual({
      senderToken: roomResponse.senderToken,
      expire: "2h",
      maxTransfers: "3",
    })
    session.close()
  })

  it("lets a receiver stop the old version and restart the updated file from zero", async () => {
    const onMeta = vi.fn<(meta: P2PFileMeta) => void>()
    const onUpdateAvailable = vi.fn<(meta: P2PFileMeta | undefined) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta,
      onUpdateAvailable,
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "old", name: "old.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(new Uint8Array([1, 2]).buffer)
    await flushTasks()

    channel.receive({
      type: "file-update",
      meta: { revision: "new", name: "new.bin", size: 3, type: "", lastModified: 0, verifyTransfer: false },
    })
    await vi.waitFor(() =>
      expect(onUpdateAvailable).toHaveBeenLastCalledWith(expect.objectContaining({ name: "new.bin" })),
    )
    session.acceptUpdate()
    expect(
      channel.sent.some((part) => typeof part === "string" && (JSON.parse(part) as { type?: string }).type === "stop"),
    ).toStrictEqual(true)

    channel.receive({ type: "stopped" })
    await vi.waitFor(() =>
      expect(
        channel.sent
          .filter((part): part is string => typeof part === "string")
          .map((part) => JSON.parse(part) as { type?: string; revision?: string; offset?: number })
          .some((message) => message.type === "download" && message.revision === "new" && message.offset === 0),
      ).toStrictEqual(true),
    )
    expect(onMeta).toHaveBeenLastCalledWith(expect.objectContaining({ name: "new.bin" }))
    expect(onUpdateAvailable).toHaveBeenLastCalledWith(undefined)
    session.close()
  })

  it("automatically replaces file details when a receiver has not started downloading", async () => {
    const onMeta = vi.fn<(meta: P2PFileMeta) => void>()
    const onUpdateAvailable = vi.fn<(meta: P2PFileMeta | undefined) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta,
      onUpdateAvailable,
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "old", name: "old.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    channel.receive({
      type: "file-update",
      meta: { revision: "new", name: "new.bin", size: 3, type: "", lastModified: 0, verifyTransfer: false },
    })
    await vi.waitFor(() => expect(onMeta).toHaveBeenLastCalledWith(expect.objectContaining({ name: "new.bin" })))
    expect(onUpdateAvailable).not.toHaveBeenCalled()

    session.requestDownload()
    await vi.waitFor(() =>
      expect(
        channel.sent
          .filter((part): part is string => typeof part === "string")
          .map((part) => JSON.parse(part) as { type?: string; revision?: string })
          .some((message) => message.type === "download" && message.revision === "new"),
      ).toStrictEqual(true),
    )
    session.close()
  })

  it("ignores queued binary data from a replaced receiver channel", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest")
    let resolveOldChunk: ((buffer: ArrayBuffer) => void) | undefined
    const oldChunk = new Blob([new Uint8Array([9, 9, 9, 9])])
    vi.spyOn(oldChunk, "arrayBuffer").mockImplementation(
      () => new Promise<ArrayBuffer>((resolve) => (resolveOldChunk = resolve)),
    )
    const onFile = vi.fn<(file: File) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError: vi.fn((error) => {
        throw error
      }),
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "first" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const firstChannel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(firstChannel)
    firstChannel.open()
    firstChannel.receive({
      type: "meta",
      meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    firstChannel.receiveData(oldChunk)
    await vi.waitFor(() => expect(resolveOldChunk).toBeTypeOf("function"))

    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "second" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(2))
    const secondChannel = MockPeerConnection.instances[1].dataChannel
    MockPeerConnection.instances[1].receiveDataChannel(secondChannel)
    secondChannel.open()
    secondChannel.receive({
      type: "meta",
      meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()

    resolveOldChunk!(new Uint8Array([9, 9, 9, 9]).buffer)
    secondChannel.receiveData(new Uint8Array([1, 2, 3, 4]).buffer)
    secondChannel.receive({ type: "done" })
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))

    const received = onFile.mock.calls[0][0]
    expect(Array.from(new Uint8Array(await received.arrayBuffer()))).toStrictEqual([1, 2, 3, 4])
    expect(digest).not.toHaveBeenCalled()
    session.close()
  })

  it("ignores receiver binary data sent before file metadata", async () => {
    const onFile = vi.fn<(file: File) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError: vi.fn((error) => {
        throw error
      }),
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()

    channel.receiveData(new Uint8Array([9, 9, 9, 9]).buffer)
    channel.receive({
      type: "meta",
      meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(new Uint8Array([1, 2, 3, 4]).buffer)
    channel.receive({ type: "done" })
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))

    const received = onFile.mock.calls[0][0]
    expect(Array.from(new Uint8Array(await received.arrayBuffer()))).toStrictEqual([1, 2, 3, 4])
    session.close()
  })

  it("requests a missing tail instead of completing a truncated file", async () => {
    const onFile = vi.fn<(file: File) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError: vi.fn((error) => {
        throw error
      }),
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "revision", name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(new Uint8Array([1, 2, 3]).buffer)
    channel.receive({ type: "done" })

    await vi.waitFor(() =>
      expect(
        channel.sent
          .filter((part): part is string => typeof part === "string")
          .map((part) => JSON.parse(part) as { type?: string; offset?: number })
          .some((message) => message.type === "download" && message.offset === 3),
      ).toStrictEqual(true),
    )
    expect(onFile).not.toHaveBeenCalled()

    channel.receiveData(new Uint8Array([4]).buffer)
    channel.receive({ type: "done" })
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledOnce())
    expect(Array.from(new Uint8Array(await onFile.mock.calls[0][0].arrayBuffer()))).toStrictEqual([1, 2, 3, 4])
    session.close()
  })

  it("waits for a real receive sample before publishing the first transfer speed", async () => {
    let now = 10_000
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const onProgress = vi.fn<(progress: P2PProgress | undefined) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress,
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "revision", name: "file.bin", size: 3, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledTimes(1))
    expect(onProgress.mock.calls[0][0]?.speedBytesPerSecond).toStrictEqual(0)

    channel.receiveData(new Uint8Array([1]).buffer)
    await flushTasks()
    expect(onProgress).toHaveBeenCalledTimes(1)

    now += 500
    channel.receiveData(new Uint8Array([2]).buffer)
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledTimes(2))
    expect(onProgress.mock.calls[1][0]?.speedBytesPerSecond).toStrictEqual(4)
    session.close()
  })

  it("rejects receiver binary data until a download is requested", async () => {
    const onError = vi.fn<(error: Error) => void>()
    const onFile = vi.fn<(file: File) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError,
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()

    channel.receiveData(new Uint8Array([9, 9, 9, 9]).buffer)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0][0].message).toContain("Unexpected P2P binary data")

    session.requestDownload()
    channel.receiveData(new Uint8Array([1, 2, 3, 4]).buffer)
    channel.receive({ type: "done" })
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))

    const received = onFile.mock.calls[0][0]
    expect(Array.from(new Uint8Array(await received.arrayBuffer()))).toStrictEqual([1, 2, 3, 4])
    expect(onError).toHaveBeenCalledTimes(1)
    session.close()
  })

  it("streams a 64 MiB receiver file through OPFS and returns a File", async () => {
    const write = vi.fn(() => Promise.resolve())
    const closeWritable = vi.fn(() => Promise.resolve())
    const abortWritable = vi.fn(() => Promise.resolve())
    const removeEntry = vi.fn((_filename: string) => Promise.resolve())
    const storedBytes = new Uint8Array(64 * 1024 * 1024)
    storedBytes[0] = 115
    const getFile = vi.fn(() => Promise.resolve(new File([storedBytes], "temporary-file")))
    const createWritable = vi.fn(() =>
      Promise.resolve({
        write,
        close: closeWritable,
        abort: abortWritable,
      } as unknown as FileSystemWritableFileStream),
    )
    const getFileHandle = vi.fn((_filename: string) =>
      Promise.resolve({ createWritable, getFile } as unknown as FileSystemFileHandle),
    )
    const getDirectory = vi.fn(() =>
      Promise.resolve({ getFileHandle, removeEntry } as unknown as FileSystemDirectoryHandle),
    )
    vi.stubGlobal("navigator", {
      userAgent: "Test browser",
      storage: {
        estimate: () => Promise.resolve({ quota: 128 * 1024 * 1024, usage: 0 }),
        getDirectory,
      },
    })

    const onFile = vi.fn<(file: File) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: {
        name: "large.txt",
        size: 64 * 1024 * 1024,
        type: "text/plain",
        lastModified: 123,
        verifyTransfer: false,
      },
    })
    await flushTasks()
    session.requestDownload()
    await vi.waitFor(() => expect(getDirectory).toHaveBeenCalledTimes(1))

    const chunk = new ArrayBuffer(4 * 1024 * 1024)
    for (let index = 0; index < 16; index += 1) channel.receiveData(chunk)
    channel.receive({ type: "done" })
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))

    expect(write).toHaveBeenCalledTimes(16)
    expect(closeWritable).toHaveBeenCalledTimes(1)
    expect(getFile).toHaveBeenCalledTimes(1)
    expect(onFile.mock.calls[0][0]).toMatchObject({
      name: "large.txt",
      type: "text/plain",
      lastModified: 123,
    })
    expect(onFile.mock.calls[0][0].size).toStrictEqual(64 * 1024 * 1024)
    expect(new Uint8Array(await onFile.mock.calls[0][0].slice(0, 1).arrayBuffer())[0]).toStrictEqual(115)
    expect(removeEntry).not.toHaveBeenCalled()

    const temporaryFilename = getFileHandle.mock.calls[0][0]
    session.close()
    expect(localStorage.getItem(`pastebin-worker:opfs-delete:${temporaryFilename}`)).toStrictEqual("1")
    await flushTasks()
    expect(removeEntry).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(`pastebin-worker:opfs-delete:${temporaryFilename}`)).toBeNull()
    expect(abortWritable).not.toHaveBeenCalled()
  })

  it("retains completed persistent files under distinct entries until the session closes", async () => {
    const openedFilenames: string[] = []
    const removeEntry = vi.fn((_filename: string) => Promise.resolve())
    const root = {
      async *entries() {
        // No stale files are present.
      },
      getFileHandle: vi.fn((filename: string) => {
        openedFilenames.push(filename)
        return Promise.resolve({
          getFile: () => Promise.resolve(new File([new Uint8Array(1)], filename)),
        } as unknown as FileSystemFileHandle)
      }),
      removeEntry,
    }
    vi.stubGlobal("Worker", MockStorageWorker)
    vi.stubGlobal("navigator", {
      userAgent: "Test browser",
      storage: { getDirectory: () => Promise.resolve(root) },
    })

    const receivedFiles: File[] = []
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onUpdateAvailable: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: (file) => receivedFiles.push(file),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "old", name: "old.bin", size: 1, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(new ArrayBuffer(1))
    channel.receive({ type: "done" })
    await vi.waitFor(() => expect(receivedFiles).toHaveLength(1))

    channel.receive({
      type: "file-update",
      meta: { revision: "new", name: "new.bin", size: 1, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.acceptUpdate()
    await vi.waitFor(() =>
      expect(
        channel.sent
          .filter((part): part is string => typeof part === "string")
          .map((part) => JSON.parse(part) as { type?: string; revision?: string })
          .some((message) => message.type === "download" && message.revision === "new"),
      ).toStrictEqual(true),
    )
    channel.receiveData(new ArrayBuffer(1))
    channel.receive({ type: "done" })
    await vi.waitFor(() => expect(receivedFiles).toHaveLength(2))

    expect(openedFilenames).toHaveLength(2)
    expect(new Set(openedFilenames).size).toStrictEqual(2)
    expect(removeEntry).not.toHaveBeenCalled()

    session.close()
    await vi.waitFor(() => expect(removeEntry).toHaveBeenCalledTimes(2))
    expect(removeEntry.mock.calls.map(([filename]) => filename).sort()).toStrictEqual(openedFilenames.sort())
  })

  it("keeps every byte of a 3 MiB file when storage worker writes detach receive buffers", async () => {
    const root = {
      async *entries() {
        // No stale files are present.
      },
      getFileHandle: (filename: string) =>
        Promise.resolve({
          getFile: () =>
            Promise.resolve(new File([BufferedStorageWorker.files.get(filename) ?? new Uint8Array(0)], filename)),
        } as unknown as FileSystemFileHandle),
      removeEntry: (filename: string) => {
        BufferedStorageWorker.files.delete(filename)
        return Promise.resolve()
      },
    }
    vi.stubGlobal("Worker", BufferedStorageWorker)
    vi.stubGlobal("navigator", {
      userAgent: "Test browser",
      storage: { getDirectory: () => Promise.resolve(root) },
    })

    const fileSize = 3 * 1024 * 1024
    const source = new Uint8Array(fileSize)
    for (let index = 0; index < source.byteLength; index += 1) source[index] = index % 251
    const onFile = vi.fn<(file: File) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "three-mib", name: "3m.bin", size: fileSize, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    const receiveChunkBytes = 64 * 1024
    for (let offset = 0; offset < source.byteLength; offset += receiveChunkBytes) {
      channel.receiveData(source.slice(offset, offset + receiveChunkBytes).buffer)
    }
    channel.receive({ type: "done" })
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledOnce(), { timeout: 5000 })

    const received = new Uint8Array(await onFile.mock.calls[0][0].arrayBuffer())
    expect(received.byteLength).toStrictEqual(source.byteLength)
    expect(await sha1Hex([received.buffer])).toStrictEqual(await sha1Hex([source.buffer]))
    session.close()
  })

  it("rejects a completed P2P file when its persisted size does not match metadata", async () => {
    const removeEntry = vi.fn((filename: string) => {
      BufferedStorageWorker.files.delete(filename)
      return Promise.resolve()
    })
    const root = {
      async *entries() {
        // No stale files are present.
      },
      getFileHandle: (filename: string) =>
        Promise.resolve({
          getFile: () => {
            const stored = BufferedStorageWorker.files.get(filename) ?? new Uint8Array(0)
            return Promise.resolve(new File([stored.slice(0, Math.max(0, stored.byteLength - 1))], filename))
          },
        } as unknown as FileSystemFileHandle),
      removeEntry,
    }
    vi.stubGlobal("Worker", BufferedStorageWorker)
    vi.stubGlobal("navigator", {
      userAgent: "Test browser",
      storage: { getDirectory: () => Promise.resolve(root) },
    })

    const onFile = vi.fn<(file: File) => void>()
    const onError = vi.fn<(error: Error) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError,
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "truncated", name: "truncated.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(new Uint8Array([1, 2, 3, 4]).buffer)
    channel.receive({ type: "done" })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(onError.mock.calls[0][0].message).toStrictEqual(
      "Stored P2P file size mismatch: expected 4 bytes, got 3 bytes.",
    )
    expect(onFile).not.toHaveBeenCalled()
    expect(
      channel.sent
        .filter((part): part is string => typeof part === "string")
        .map((part) => JSON.parse(part) as { type?: string })
        .some((message) => message.type === "received"),
    ).toStrictEqual(false)
    await vi.waitFor(() => expect(removeEntry).toHaveBeenCalledOnce())
    session.close()
  })

  it("falls back to memory when OPFS does not have enough available space", async () => {
    const getDirectory = vi.fn()
    vi.stubGlobal("navigator", {
      userAgent: "Test browser",
      storage: {
        estimate: () => Promise.resolve({ quota: 32 * 1024 * 1024, usage: 0 }),
        getDirectory,
      },
    })
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: {
        name: "large.bin",
        size: 64 * 1024 * 1024,
        type: "application/octet-stream",
        lastModified: 0,
        verifyTransfer: false,
      },
    })
    await flushTasks()
    session.requestDownload()
    await vi.waitFor(() =>
      expect(
        channel.sent.some(
          (part) => typeof part === "string" && (JSON.parse(part) as { type?: unknown }).type === "download",
        ),
      ).toStrictEqual(true),
    )

    expect(getDirectory).toHaveBeenCalledOnce()
    session.close()
  })

  it("reuses one MessageChannel while time-slicing a long send", async () => {
    CountingMessageChannel.instances = 0
    vi.stubGlobal("MessageChannel", CountingMessageChannel)
    let elapsed = 0
    vi.spyOn(performance, "now").mockImplementation(() => (elapsed += 3))
    const bytes = new Uint8Array(600 * 1024)
    const file = {
      name: "large.bin",
      size: bytes.byteLength,
      type: "application/octet-stream",
      lastModified: 0,
      slice: vi.fn(() => {
        const results: ReadResult[] = [{ done: false, value: bytes }, { done: true }]
        return {
          stream: () => ({
            getReader: () => ({
              read: () => Promise.resolve(results.shift()!),
              cancel: () => Promise.resolve(),
              releaseLock: () => undefined,
            }),
          }),
        }
      }),
    } as unknown as File

    const session = await startP2PSender(file, config, "1h", "1", false, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.onopen?.call(ws as unknown as WebSocket, new Event("open"))
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const dc = MockPeerConnection.instances[0].dataChannel
    dc.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
    await flushTasks()

    dc.receive({ type: "download", offset: 0 })
    await vi.waitFor(() =>
      expect(
        dc.sent.some((part) => typeof part === "string" && (JSON.parse(part) as { type?: unknown }).type === "done"),
      ).toStrictEqual(true),
    )
    expect(CountingMessageChannel.instances).toBeLessThanOrEqual(1)
    session.close()
  })

  it("builds the verification manifest from the file stream being sent", async () => {
    const bytes = new Uint8Array(verificationBlockSize + 17)
    bytes.fill(0x5a, 0, verificationBlockSize)
    bytes.fill(0xa5, verificationBlockSize)
    const expectedHashes = await Promise.all([
      sha1Hex([bytes.buffer.slice(0, verificationBlockSize)]),
      sha1Hex([bytes.buffer.slice(verificationBlockSize)]),
    ])
    const arrayBuffer = vi.fn((part: Uint8Array<ArrayBuffer>) =>
      Promise.resolve(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)),
    )
    const sliceFile = (start = 0, end = bytes.byteLength) => {
      const part = bytes.slice(start, end)
      return {
        arrayBuffer: () => arrayBuffer(part),
        stream: () =>
          new ReadableStream<Uint8Array<ArrayBuffer>>({
            start(controller) {
              controller.enqueue(part)
              controller.close()
            },
          }),
      }
    }
    const slice = vi.fn(sliceFile)
    const file = {
      name: "verified.bin",
      size: bytes.byteLength,
      type: "application/octet-stream",
      lastModified: 0,
      slice,
    } as unknown as File
    const onError = vi.fn()

    const session = await startP2PSender(file, config, "1h", "1", true, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onError,
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const dc = MockPeerConnection.instances[0].dataChannel
    dc.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
    await flushTasks()

    dc.receive({ type: "download", offset: 0 })
    await vi.waitFor(() =>
      expect(
        dc.sent.some((part) => typeof part === "string" && (JSON.parse(part) as { type?: string }).type === "done"),
      ).toStrictEqual(true),
    )

    const verificationMessages = dc.sent
      .filter((part): part is string => typeof part === "string")
      .map((part) => JSON.parse(part) as Record<string, unknown>)
      .filter((message) => ["verification-start", "verification-chunk", "done"].includes(message.type as string))
    expect(verificationMessages).toStrictEqual([
      {
        type: "done",
        verification: {
          blockSize: verificationBlockSize,
          hashes: expectedHashes,
        },
      },
    ])

    expect(slice).toHaveBeenCalledOnce()
    expect(slice).toHaveBeenCalledWith(0)
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    session.close()
  })

  it("stops fallback hashing a resumed file version when the sender session closes", async () => {
    let resolveFirstBlock!: (value: ArrayBuffer) => void
    const firstBlock = new Promise<ArrayBuffer>((resolve) => {
      resolveFirstBlock = resolve
    })
    const fileSize = verificationBlockSize * 2
    const verificationSlices: [number, number][] = []
    const sliceFile = (start = 0, end?: number) => {
      if (end !== undefined) {
        verificationSlices.push([start, end])
        return { arrayBuffer: () => firstBlock }
      }
      return {
        stream: () =>
          new ReadableStream<Uint8Array<ArrayBuffer>>({
            start(controller) {
              controller.enqueue(new Uint8Array(fileSize - start))
              controller.close()
            },
          }),
      }
    }
    const file = {
      name: "large-verified.bin",
      size: fileSize,
      type: "application/octet-stream",
      lastModified: 0,
      slice: vi.fn(sliceFile),
    } as unknown as File
    const onError = vi.fn()
    const session = await startP2PSender(file, config, "1h", "1", true, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onError,
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    channel.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
    await flushTasks()

    channel.receive({ type: "download", offset: fileSize - 1 })
    await vi.waitFor(() => expect(verificationSlices).toHaveLength(1))
    session.close()
    resolveFirstBlock(new ArrayBuffer(verificationBlockSize))
    await flushTasks()

    expect(verificationSlices).toStrictEqual([[0, verificationBlockSize]])
    expect(onError).not.toHaveBeenCalled()
  })

  it("deduplicates, bounds, serializes, and limits verification repair requests", async () => {
    const bytes = new TextEncoder().encode("data")
    const file = {
      name: "verified.bin",
      size: bytes.byteLength,
      type: "application/octet-stream",
      lastModified: 0,
      slice: (start = 0, end = bytes.byteLength) => {
        const part = bytes.slice(start, end)
        return {
          arrayBuffer: () => Promise.resolve(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)),
          stream: () =>
            new ReadableStream<Uint8Array<ArrayBuffer>>({
              start(controller) {
                controller.enqueue(part)
                controller.close()
              },
            }),
        }
      },
    } as unknown as File
    const session = await startP2PSender(file, config, "1h", "1", true, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    channel.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
    await flushTasks()

    const controlMessages = () =>
      channel.sent
        .filter((part): part is string => typeof part === "string")
        .map((part) => JSON.parse(part) as { type: string; index?: number; size?: number; message?: string })

    channel.receive({ type: "repair-request", indices: [0] })
    await flushTasks()
    expect(controlMessages().filter((message) => message.type === "repair-start")).toHaveLength(0)

    channel.receive({ type: "download", offset: 0 })
    await vi.waitFor(() => expect(controlMessages().some((message) => message.type === "done")).toStrictEqual(true))
    await flushTasks()

    channel.receive({ type: "repair-request", indices: [0, 0, 99] })
    channel.receive({ type: "repair-request", indices: [0] })
    await vi.waitFor(() => expect(controlMessages().filter((message) => message.type === "repair-end")).toHaveLength(1))
    expect(controlMessages().filter((message) => message.type === "repair-start")).toStrictEqual([
      { type: "repair-start", index: 0, size: file.size },
    ])

    for (let attempt = 2; attempt <= 3; attempt += 1) {
      channel.receive({ type: "repair-request", indices: [0] })
      await vi.waitFor(() =>
        expect(controlMessages().filter((message) => message.type === "repair-end")).toHaveLength(attempt),
      )
    }
    channel.receive({ type: "repair-request", indices: [0] })
    await flushTasks()

    expect(controlMessages().filter((message) => message.type === "repair-start")).toHaveLength(3)
    expect(controlMessages()).toContainEqual({ type: "error", message: "P2P verification repair limit reached." })
    session.close()
  })

  it("assembles verification chunks before completing a received file", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const hash = await sha1Hex([bytes.buffer])
    const onFile = vi.fn<(file: File) => void>()
    const onError = vi.fn<(error: Error) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile,
      onError,
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { name: "verified.bin", size: bytes.byteLength, type: "", lastModified: 0, verifyTransfer: true },
    })
    await flushTasks()
    session.requestDownload()
    channel.receiveData(bytes.buffer)
    channel.receive({ type: "verification-start", blockSize: verificationBlockSize, hashCount: 1 })
    channel.receive({ type: "verification-chunk", startIndex: 0, hashes: [hash] })
    channel.receive({ type: "done" })

    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))
    const sentTypes = channel.sent
      .filter((part): part is string => typeof part === "string")
      .map((part) => (JSON.parse(part) as { type: string }).type)
    expect(sentTypes).toContain("verified")
    expect(sentTypes).toContain("received")
    expect(onError).not.toHaveBeenCalled()
    session.close()
  })

  it("rejects out-of-order verification chunks", async () => {
    const onError = vi.fn<(error: Error) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError,
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { name: "verified.bin", size: 4, type: "", lastModified: 0, verifyTransfer: true },
    })
    await flushTasks()
    session.requestDownload()
    channel.receive({ type: "verification-start", blockSize: verificationBlockSize, hashCount: 1 })
    channel.receive({ type: "verification-chunk", startIndex: 1, hashes: ["a".repeat(40)] })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0][0].message).toContain("out of order")
    session.close()
  })

  it("detaches sender signaling and peer handlers when closed", async () => {
    const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
      onStatus: vi.fn(),
      onPeersChange: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const peer = MockPeerConnection.instances[0]

    session.close()

    expect(ws.onopen).toBeNull()
    expect(ws.onerror).toBeNull()
    expect(ws.onclose).toBeNull()
    expect(ws.onmessage).toBeNull()
    expect(peer.onicecandidate).toBeNull()
    expect(peer.onconnectionstatechange).toBeNull()
    expect(peer.dataChannel.onopen).toBeNull()
    expect(peer.dataChannel.onmessage).toBeNull()
    ws.receive({ type: "peer-joined", role: "receiver", peerId: "receiver-2" })
    await flushTasks()
    expect(MockPeerConnection.instances).toHaveLength(1)
  })

  it("detaches receiver signaling and peer handlers when closed", async () => {
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const peer = MockPeerConnection.instances[0]
    peer.receiveDataChannel()

    session.close()

    expect(ws.onopen).toBeNull()
    expect(ws.onerror).toBeNull()
    expect(ws.onclose).toBeNull()
    expect(ws.onmessage).toBeNull()
    expect(peer.onicecandidate).toBeNull()
    expect(peer.onconnectionstatechange).toBeNull()
    expect(peer.ondatachannel).toBeNull()
    expect(peer.dataChannel.onopen).toBeNull()
    expect(peer.dataChannel.onmessage).toBeNull()
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "late" } })
    await flushTasks()
    expect(MockPeerConnection.instances).toHaveLength(1)
  })

  it("notifies the receiver when the transfer limit is reached", () => {
    const onTransferLimitReached = vi.fn()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onTransferLimitReached,
      onError: vi.fn((error) => {
        throw error
      }),
    })

    MockWebSocket.instances[0].receive({ type: "transfer-limit-complete" })

    expect(onTransferLimitReached).toHaveBeenCalledTimes(1)
    session.close()
  })

  it("notifies the receiver when updated room settings reopen the link", () => {
    const onRoomAvailabilityChange = vi.fn()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onRoomAvailabilityChange,
      onError: vi.fn((error) => {
        throw error
      }),
    })

    MockWebSocket.instances[0].receive({
      type: "room-options-updated",
      expireAt: new Date(Date.now() + 60_000).toISOString(),
      maxTransfers: 2,
      joinable: true,
    })

    expect(onRoomAvailabilityChange).toHaveBeenCalledWith(true)
    session.close()
  })

  it("keeps the sender session open after the receiver limit is reached", async () => {
    const onLimitReached = vi.fn()
    const onStatus = vi.fn()
    const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
      onStatus,
      onPeersChange: vi.fn(),
      onLimitReached,
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "transfer-limit-complete" })

    expect(onLimitReached).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenLastCalledWith("Receiver limit reached. Existing receivers can continue.")
    expect(ws.readyState).toStrictEqual(MockWebSocket.OPEN)

    ws.receive({ type: "peer-joined", role: "receiver", peerId: "receiver-after-limit" })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    session.close()
  })

  it("pauses locally, commits in-flight data through acknowledgement, and resumes at the final offset", async () => {
    const onPausedChange = vi.fn()
    const onPausePendingChange = vi.fn()
    const onStatus = vi.fn()
    const session = startP2PReceiver("room", config, {
      onStatus,
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange,
      onPausePendingChange,
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    MockPeerConnection.instances[0].receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()

    const downloadMessages = () =>
      channel.sent
        .filter((part): part is string => typeof part === "string")
        .map((part) => JSON.parse(part) as { type?: string; offset?: number })
        .filter((message) => message.type === "download")

    session.requestDownload()
    await vi.waitFor(() => expect(downloadMessages()).toHaveLength(1))
    session.pause()

    expect(onStatus).toHaveBeenLastCalledWith("Pausing...")
    expect(onPausePendingChange).toHaveBeenLastCalledWith(true)
    expect(onPausedChange).not.toHaveBeenCalledWith(true)
    session.resume()
    await flushTasks()
    expect(downloadMessages()).toHaveLength(1)

    channel.receiveData(new Uint8Array([1, 2]).buffer)
    channel.receive({ type: "paused" })
    await vi.waitFor(() => expect(onPausedChange).toHaveBeenLastCalledWith(true))
    expect(onPausePendingChange).toHaveBeenLastCalledWith(false)
    expect(onStatus).toHaveBeenLastCalledWith("Paused.")
    expect(
      channel.sent
        .filter((part): part is string => typeof part === "string")
        .map((part) => JSON.parse(part) as { type?: string; doneBytes?: number })
        .filter((message) => message.type === "progress"),
    ).toContainEqual({ type: "progress", doneBytes: 2 })

    session.resume()
    await vi.waitFor(() => expect(downloadMessages()).toHaveLength(2))
    expect(downloadMessages()[1]?.offset).toStrictEqual(2)
    session.close()
  })

  it("pauses locally while disconnected and synchronizes the pause on the rebuilt channel", async () => {
    const onPausedChange = vi.fn()
    const onPausePendingChange = vi.fn()
    const session = startP2PReceiver("room", config, {
      onStatus: vi.fn(),
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange,
      onPausePendingChange,
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const socket = MockWebSocket.instances[0]
    socket.receive({ type: "offer", peerId: "sender", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const firstPeer = MockPeerConnection.instances[0]
    const firstChannel = firstPeer.dataChannel
    firstPeer.receiveDataChannel(firstChannel)
    firstChannel.open()
    firstChannel.receive({
      type: "meta",
      meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()

    firstPeer.connectionState = "failed"
    firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
    session.pause()

    expect(onPausePendingChange).toHaveBeenLastCalledWith(false)
    expect(onPausedChange).toHaveBeenLastCalledWith(true)
    socket.receive({
      type: "offer",
      peerId: "sender",
      negotiationId: "00000000-0000-4000-8000-000000000062",
      sdp: { type: "offer", sdp: "rebuilt-offer" },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(2))
    const rebuiltPeer = MockPeerConnection.instances[1]
    const rebuiltChannel = rebuiltPeer.dataChannel
    rebuiltPeer.receiveDataChannel(rebuiltChannel)
    rebuiltChannel.open()
    rebuiltChannel.receive({
      type: "meta",
      meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()

    expect(
      rebuiltChannel.sent.some(
        (message) => typeof message === "string" && (JSON.parse(message) as { type?: string }).type === "pause",
      ),
    ).toStrictEqual(true)
    session.close()
  })

  it("stops receiver reconnect attempts after the absolute deadline", async () => {
    vi.useFakeTimers()
    try {
      const onStatus = vi.fn()
      const session = startP2PReceiver("room", config, {
        onStatus,
        onMeta: vi.fn(),
        onProgress: vi.fn(),
        onPausedChange: vi.fn(),
        onFile: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })

      for (const delay of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]) {
        const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        socket.onclose?.call(socket as unknown as WebSocket, new CloseEvent("close"))
        await vi.advanceTimersByTimeAsync(delay)
      }
      const finalSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      finalSocket.onclose?.call(finalSocket as unknown as WebSocket, new CloseEvent("close"))

      expect(MockWebSocket.instances).toHaveLength(8)
      expect(onStatus).toHaveBeenLastCalledWith("Unable to reconnect to the sender. Transfer session closed.")
      expect(finalSocket.onmessage).toBeNull()
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops retained receiver retries after a room availability probe confirms a terminal response", async () => {
    const peerId = "00000000-0000-4000-8000-000000000054"
    writeP2PResumeCheckpoint({
      version: 1,
      roomName: "room",
      peerId,
      meta: {
        revision: "saved-revision",
        name: "saved.bin",
        size: 20,
        type: "application/octet-stream",
        lastModified: 1,
        verifyTransfer: false,
      },
      receivedBytes: 10,
      completedHashes: [],
      updatedAt: Date.now(),
    })
    vi.stubGlobal("Worker", MockStorageWorker)
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () =>
          Promise.resolve({
            async *entries() {
              yield* await Promise.resolve([] as [string, FileSystemHandle][])
            },
          }),
      },
    })
    const probe = vi.fn(() => Promise.resolve(new Response(null, { status: 410 })))
    vi.stubGlobal("fetch", probe)
    const onStatus = vi.fn<(status: string) => void>()
    const onPausedChange = vi.fn<(paused: boolean) => void>()
    const session = startP2PReceiver("room", config, {
      onStatus,
      onMeta: vi.fn(),
      onProgress: vi.fn(),
      onPausedChange,
      onFile: vi.fn(),
      onError: vi.fn(),
    })
    await vi.waitFor(() => expect(onPausedChange).toHaveBeenCalledWith(true))

    vi.useFakeTimers()
    try {
      for (const delay of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]) {
        const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        socket.onclose?.call(socket as unknown as WebSocket, new CloseEvent("close"))
        await vi.advanceTimersByTimeAsync(delay)
      }
      const finalSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      finalSocket.onclose?.call(finalSocket as unknown as WebSocket, new CloseEvent("close"))
      await vi.advanceTimersByTimeAsync(0)

      expect(probe).toHaveBeenCalledWith(
        new URL("https://example.com/p/room"),
        expect.objectContaining({ method: "HEAD", cache: "no-store" }),
      )
      expect(onStatus).toHaveBeenLastCalledWith(
        "P2P room is no longer available. The saved partial transfer has been retained.",
      )
      expect(MockWebSocket.instances).toHaveLength(8)
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("requests a peer rebuild after WebRTC failure and pauses when recovery is exhausted", async () => {
    vi.useFakeTimers()
    try {
      const onStatus = vi.fn<(status: string) => void>()
      const onPausedChange = vi.fn<(isPaused: boolean) => void>()
      const onReconnectingChange = vi.fn<(isReconnecting: boolean) => void>()
      const session = startP2PReceiver("room", config, {
        onStatus,
        onMeta: vi.fn(),
        onProgress: vi.fn(),
        onPausedChange,
        onReconnectingChange,
        onFile: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const ws = MockWebSocket.instances[0]
      ws.receive({ type: "offer", peerId: "sender", sdp: { type: "offer", sdp: "offer" } })
      await vi.advanceTimersByTimeAsync(0)
      const peer = MockPeerConnection.instances[0]
      const channel = peer.dataChannel
      peer.receiveDataChannel(channel)
      channel.open()
      channel.receive({
        type: "meta",
        meta: {
          revision: "recovery-revision",
          name: "recovery.bin",
          size: 4,
          type: "application/octet-stream",
          lastModified: 1,
          verifyTransfer: false,
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      session.requestDownload()
      await vi.advanceTimersByTimeAsync(0)

      peer.connectionState = "failed"
      peer.onconnectionstatechange?.call(peer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(0)
      const recoveryRequests = () =>
        ws.sent
          .map((message) => JSON.parse(message) as { type?: string; retryToken?: string })
          .filter((message) => message.type === "peer-reconnect-request")
      expect(recoveryRequests()).toHaveLength(1)
      expect(onReconnectingChange).toHaveBeenLastCalledWith(true)

      const retryToken = "00000000-0000-4000-8000-000000000091"
      ws.receive({ type: "peer-reconnect-failed", peerId: "receiver", retryToken })
      await vi.advanceTimersByTimeAsync(0)
      expect(onReconnectingChange).toHaveBeenLastCalledWith(false)
      expect(onPausedChange).toHaveBeenLastCalledWith(true)
      expect(onStatus).toHaveBeenLastCalledWith("Connection recovery failed. Resume to retry.")

      session.resume()
      await vi.advanceTimersByTimeAsync(0)
      expect(recoveryRequests()).toHaveLength(2)
      expect(recoveryRequests()[1]).toMatchObject({ retryToken })
      expect(onPausedChange).toHaveBeenLastCalledWith(false)
      expect(onReconnectingChange).toHaveBeenLastCalledWith(true)
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("starts a fresh sender reconnect window after signaling becomes ready again", async () => {
    vi.useFakeTimers()
    try {
      const onStatus = vi.fn()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus,
        onPeersChange: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })

      const firstSocket = MockWebSocket.instances[0]
      firstSocket.onclose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"))
      await vi.advanceTimersByTimeAsync(1_000)
      expect(MockWebSocket.instances).toHaveLength(2)

      const reconnectedSocket = MockWebSocket.instances[1]
      reconnectedSocket.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [] },
      })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(31_000)

      reconnectedSocket.onclose?.call(reconnectedSocket as unknown as WebSocket, new CloseEvent("close"))
      await vi.advanceTimersByTimeAsync(1_000)

      expect(MockWebSocket.instances).toHaveLength(3)
      expect(onStatus).not.toHaveBeenLastCalledWith("Unable to restore P2P signaling. Share session closed.")
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("refreshes a possibly half-open signaling socket after a long background suspension", async () => {
    vi.useFakeTimers()
    let visibilityState: DocumentVisibilityState = "visible"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState)
    try {
      const onStatus = vi.fn()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus,
        onPeersChange: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const firstSocket = MockWebSocket.instances[0]

      visibilityState = "hidden"
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(60_000)
      visibilityState = "visible"
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(0)

      expect(firstSocket.readyState).toStrictEqual(3)
      expect(MockWebSocket.instances).toHaveLength(2)
      const replacementSocket = MockWebSocket.instances[1]
      replacementSocket.onopen?.call(replacementSocket as unknown as WebSocket, new Event("open"))
      expect(onStatus).toHaveBeenLastCalledWith("P2P signaling reconnected. Synchronizing...")
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("rebuilds a failed sender peer once while preserving its visible progress", async () => {
    vi.useFakeTimers()
    try {
      const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const ws = MockWebSocket.instances[0]
      ws.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      const firstPeer = MockPeerConnection.instances[0]
      firstPeer.dataChannel.open()
      ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)
      firstPeer.dataChannel.receive({ type: "progress", revision: session.currentFile.revision, doneBytes: 2 })

      firstPeer.connectionState = "disconnected"
      firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        progress: { doneBytes: 2, totalBytes: 4, speedBytesPerSecond: 0 },
        transferStatus: "RECONNECTING",
      })
      await vi.advanceTimersByTimeAsync(2_999)
      expect(MockPeerConnection.instances).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(MockPeerConnection.instances).toHaveLength(2)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        progress: { doneBytes: 2, totalBytes: 4 },
        transferStatus: "RECONNECTING",
      })

      const rebuiltPeer = MockPeerConnection.instances[1]
      rebuiltPeer.dataChannel.open()
      ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        progress: { doneBytes: 2, totalBytes: 4 },
        transferStatus: "READY",
        isConnected: true,
      })
      rebuiltPeer.dataChannel.receive({ type: "pause" })
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        progress: { doneBytes: 2, totalBytes: 4 },
        transferStatus: "PAUSED",
      })
      await vi.advanceTimersByTimeAsync(12_000)
      expect(MockPeerConnection.instances).toHaveLength(2)
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("distinguishes an initial pairing retry from reconnecting an established peer", async () => {
    vi.useFakeTimers()
    try {
      const onStatus = vi.fn<(status: string) => void>()
      const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus,
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const ws = MockWebSocket.instances[0]
      ws.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      const firstPeer = MockPeerConnection.instances[0]

      firstPeer.connectionState = "connected"
      firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(0)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        connectionPhase: "pairing",
        transferStatus: "READY",
        isConnected: false,
        progress: undefined,
      })
      expect(onStatus).toHaveBeenLastCalledWith("Receiver found. Start WebRTC pairing...")

      firstPeer.connectionState = "failed"
      firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(0)

      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        connectionPhase: "pairing-retry",
        transferStatus: "READY",
        status: "WebRTC pairing failed. Retrying...",
        progress: undefined,
      })
      expect(onStatus).toHaveBeenLastCalledWith("WebRTC pairing failed. Retrying...")

      await vi.advanceTimersByTimeAsync(30_000)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        connectionPhase: "pairing-failed",
        transferStatus: "PAUSED",
        status: "Unable to establish a WebRTC connection. Waiting for receiver to retry.",
        progress: undefined,
      })
      expect(onStatus).toHaveBeenLastCalledWith(
        "Unable to establish a WebRTC connection. Waiting for receiver to retry.",
      )

      const attemptsAfterFailure = MockPeerConnection.instances.length
      ws.receive({ type: "peer-reconnect-request", peerId: "receiver-1" })
      ws.receive({
        type: "peer-signaling-disconnected",
        role: "receiver",
        peerId: "receiver-1",
      })
      await vi.advanceTimersByTimeAsync(10_000)

      expect(MockPeerConnection.instances).toHaveLength(attemptsAfterFailure)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        connectionPhase: "pairing-failed",
        status: "Unable to establish a WebRTC connection. Waiting for receiver to retry.",
      })
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("pauses an exhausted peer recovery loop until the receiver explicitly retries", async () => {
    vi.useFakeTimers()
    try {
      const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const ws = MockWebSocket.instances[0]
      ws.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      const firstPeer = MockPeerConnection.instances[0]
      firstPeer.dataChannel.open()
      ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)

      firstPeer.connectionState = "failed"
      firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        connectionPhase: "reconnect-failed",
        transferStatus: "PAUSED",
        status: "Connection recovery failed. Waiting for receiver to retry.",
      })
      const failureMessage = ws.sent
        .map((message) => JSON.parse(message) as { type?: string; peerId?: string; retryToken?: string })
        .find((message) => message.type === "peer-reconnect-failed" && message.peerId === "receiver-1")
      expect(failureMessage?.retryToken).toBeTypeOf("string")

      const attemptsAfterFailure = MockPeerConnection.instances.length
      const failedPeer = MockPeerConnection.instances[attemptsAfterFailure - 1]
      failedPeer.connectionState = "failed"
      failedPeer.onconnectionstatechange?.call(failedPeer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(MockPeerConnection.instances).toHaveLength(attemptsAfterFailure)

      ws.receive({ type: "peer-reconnect-request", peerId: "receiver-1" })
      ws.receive({
        type: "peer-signaling-disconnected",
        role: "receiver",
        peerId: "receiver-1",
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(attemptsAfterFailure)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        connectionPhase: "reconnect-failed",
      })

      ws.receive({ type: "peer-joined", role: "receiver", peerId: "receiver-1" })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(attemptsAfterFailure)

      ws.receive({
        type: "peer-reconnect-request",
        peerId: "receiver-1",
        retryToken: failureMessage?.retryToken,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(attemptsAfterFailure + 1)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        connectionPhase: "reconnecting",
        transferStatus: "RECONNECTING",
        status: "Reconnecting to receiver...",
      })
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("starts a fresh recovery window when a blocked receiver rejoins with a new signaling connection", async () => {
    vi.useFakeTimers()
    try {
      const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const socket = MockWebSocket.instances[0]
      socket.receive({
        type: "ready",
        role: "sender",
        peers: {
          sender: true,
          receivers: [
            {
              peerId: "receiver-1",
              connectionId: "00000000-0000-4000-8000-000000000083",
            },
          ],
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      const firstPeer = MockPeerConnection.instances[0]
      firstPeer.dataChannel.open()
      socket.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)

      firstPeer.connectionState = "failed"
      firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(30_000)
      const attemptsAfterFailure = MockPeerConnection.instances.length
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        transferStatus: "PAUSED",
        status: "Connection recovery failed. Waiting for receiver to retry.",
      })

      socket.receive({
        type: "peer-joined",
        role: "receiver",
        peerId: "receiver-1",
        connectionId: "00000000-0000-4000-8000-000000000084",
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(MockPeerConnection.instances).toHaveLength(attemptsAfterFailure + 1)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        transferStatus: "RECONNECTING",
        isPaused: false,
      })
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a healthy sender data channel alive while signaling reconnects and reconciles it in place", async () => {
    vi.useFakeTimers()
    try {
      const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const firstSocket = MockWebSocket.instances[0]
      firstSocket.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      const peer = MockPeerConnection.instances[0]
      peer.dataChannel.open()
      firstSocket.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)

      firstSocket.onclose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"))
      peer.dataChannel.receive({ type: "progress", revision: session.currentFile.revision, doneBytes: 2 })
      expect(peer.connectionState).not.toStrictEqual("closed")
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        isConnected: true,
        progress: { doneBytes: 2, totalBytes: 4 },
      })

      await vi.advanceTimersByTimeAsync(1_000)
      const reconnectedSocket = MockWebSocket.instances[1]
      reconnectedSocket.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(MockPeerConnection.instances).toHaveLength(1)
      expect(
        reconnectedSocket.sent
          .map((message) => JSON.parse(message) as { type?: string; peerId?: string })
          .some((message) => message.type === "receiver-paired" && message.peerId === "receiver-1"),
      ).toStrictEqual(true)
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a healthy receiver data channel alive while signaling reconnects", async () => {
    vi.useFakeTimers()
    try {
      const onProgress = vi.fn<(progress: { doneBytes: number } | undefined) => void>()
      const onStatus = vi.fn<(status: string) => void>()
      const session = startP2PReceiver("room", config, {
        onStatus,
        onMeta: vi.fn(),
        onProgress,
        onPausedChange: vi.fn(),
        onFile: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const firstSocket = MockWebSocket.instances[0]
      firstSocket.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
      await vi.advanceTimersByTimeAsync(0)
      const peer = MockPeerConnection.instances[0]
      const channel = peer.dataChannel
      peer.receiveDataChannel(channel)
      channel.open()
      channel.receive({
        type: "meta",
        meta: { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
      })
      await vi.advanceTimersByTimeAsync(0)
      session.requestDownload()
      await vi.advanceTimersByTimeAsync(0)

      firstSocket.onclose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"))
      await vi.advanceTimersByTimeAsync(500)
      channel.receiveData(new Uint8Array([1, 2]).buffer)
      await vi.advanceTimersByTimeAsync(0)
      expect(peer.connectionState).not.toStrictEqual("closed")
      expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ doneBytes: 2 }))

      await vi.advanceTimersByTimeAsync(1_000)
      const reconnectedSocket = MockWebSocket.instances[1]
      reconnectedSocket.receive({ type: "ready", role: "receiver", peers: { sender: true, receivers: [] } })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(1)
      expect(onStatus).toHaveBeenLastCalledWith("Signaling restored. Transfer continues.")
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("defers sender WebRTC recovery until signaling is ready again", async () => {
    vi.useFakeTimers()
    try {
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const firstSocket = MockWebSocket.instances[0]
      firstSocket.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      const peer = MockPeerConnection.instances[0]
      peer.dataChannel.open()
      firstSocket.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)

      firstSocket.onclose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"))
      peer.connectionState = "failed"
      peer.onconnectionstatechange?.call(peer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(MockPeerConnection.instances).toHaveLength(1)

      const reconnectedSocket = MockWebSocket.instances[1]
      reconnectedSocket.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(2)
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(["sender", "receiver"] as const)(
    "starts a fresh sender WebRTC recovery window when %s signaling drops during recovery",
    async (disconnectedRole) => {
      vi.useFakeTimers()
      try {
        const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
        const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
          onStatus: vi.fn(),
          onPeersChange,
          onError: vi.fn((error) => {
            throw error
          }),
        })
        const firstSocket = MockWebSocket.instances[0]
        firstSocket.receive({
          type: "ready",
          role: "sender",
          peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
        })
        await vi.advanceTimersByTimeAsync(0)
        const firstPeer = MockPeerConnection.instances[0]
        firstPeer.dataChannel.open()
        firstSocket.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
        await vi.advanceTimersByTimeAsync(0)

        firstPeer.connectionState = "failed"
        firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
        await vi.advanceTimersByTimeAsync(0)
        expect(MockPeerConnection.instances).toHaveLength(2)

        if (disconnectedRole === "sender") {
          firstSocket.onclose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"))
        } else {
          firstSocket.receive({
            type: "peer-signaling-disconnected",
            role: "receiver",
            peerId: "receiver-1",
          })
        }
        await vi.advanceTimersByTimeAsync(31_000)
        expect(MockPeerConnection.instances).toHaveLength(2)

        const reconnectedSocket = disconnectedRole === "sender" ? MockWebSocket.instances[1] : firstSocket
        reconnectedSocket.receive(
          disconnectedRole === "sender"
            ? {
                type: "ready",
                role: "sender",
                peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
              }
            : { type: "peer-joined", role: "receiver", peerId: "receiver-1" },
        )
        await vi.advanceTimersByTimeAsync(0)
        expect(MockPeerConnection.instances).toHaveLength(3)
        expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
          transferStatus: "RECONNECTING",
          isPaused: false,
        })

        await vi.advanceTimersByTimeAsync(1_000)
        expect(MockPeerConnection.instances).toHaveLength(4)
        expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
          transferStatus: "RECONNECTING",
          isPaused: false,
        })
        session.close()
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it("ignores a stale receiver disconnect after the same peer has rejoined", async () => {
    vi.useFakeTimers()
    try {
      const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const socket = MockWebSocket.instances[0]
      const firstConnectionId = "00000000-0000-4000-8000-000000000081"
      const replacementConnectionId = "00000000-0000-4000-8000-000000000082"
      socket.receive({
        type: "ready",
        role: "sender",
        peers: {
          sender: true,
          receivers: [{ peerId: "receiver-1", connectionId: firstConnectionId }],
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      const firstPeer = MockPeerConnection.instances[0]
      firstPeer.dataChannel.open()
      socket.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)

      firstPeer.connectionState = "failed"
      firstPeer.onconnectionstatechange?.call(firstPeer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(2)

      socket.receive({
        type: "peer-joined",
        role: "receiver",
        peerId: "receiver-1",
        connectionId: replacementConnectionId,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(3)

      socket.receive({
        type: "peer-signaling-disconnected",
        role: "receiver",
        peerId: "receiver-1",
        connectionId: firstConnectionId,
      })
      await vi.advanceTimersByTimeAsync(1_000)

      expect(MockPeerConnection.instances).toHaveLength(4)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        transferStatus: "RECONNECTING",
        isPaused: false,
      })
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("defers a receiver recovery request until both signaling endpoints are available", async () => {
    vi.useFakeTimers()
    try {
      const session = startP2PReceiver("room", config, {
        onStatus: vi.fn(),
        onMeta: vi.fn(),
        onProgress: vi.fn(),
        onPausedChange: vi.fn(),
        onFile: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const firstSocket = MockWebSocket.instances[0]
      firstSocket.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
      await vi.advanceTimersByTimeAsync(0)
      const peer = MockPeerConnection.instances[0]
      peer.receiveDataChannel()
      peer.dataChannel.open()

      firstSocket.onclose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"))
      peer.connectionState = "failed"
      peer.onconnectionstatechange?.call(peer as unknown as RTCPeerConnection, new Event("statechange"))
      await vi.advanceTimersByTimeAsync(1_000)
      const reconnectedSocket = MockWebSocket.instances[1]
      expect(
        reconnectedSocket.sent.some(
          (message) => (JSON.parse(message) as { type?: string }).type === "peer-reconnect-request",
        ),
      ).toStrictEqual(false)

      reconnectedSocket.receive({ type: "ready", role: "receiver", peers: { sender: true, receivers: [] } })
      await vi.advanceTimersByTimeAsync(0)
      expect(
        reconnectedSocket.sent.some(
          (message) => (JSON.parse(message) as { type?: string }).type === "peer-reconnect-request",
        ),
      ).toStrictEqual(true)
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a completed sender transfer connected across a transient signaling disconnect", async () => {
    const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
    const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
      onStatus: vi.fn(),
      onPeersChange,
      onError: vi.fn((error) => {
        throw error
      }),
    })

    const ws = MockWebSocket.instances[0]
    ws.receive({
      type: "ready",
      role: "sender",
      peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
    })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const channel = MockPeerConnection.instances[0].dataChannel
    channel.open()
    ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
    await flushTasks()

    channel.receive({ type: "progress", revision: session.currentFile.revision, doneBytes: 4 })
    channel.receive({ type: "received", revision: session.currentFile.revision })
    expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
      peerId: "receiver-1",
      transferStatus: "DONE",
      isComplete: true,
    })

    ws.onclose?.call(ws as unknown as WebSocket, new CloseEvent("close"))
    expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
      peerId: "receiver-1",
      transferStatus: "DONE",
      isComplete: true,
      isConnected: true,
    })
    expect(MockPeerConnection.instances[0].connectionState).not.toStrictEqual("closed")
    session.close()
  })

  it("keeps a resumable receiver visible while disconnected and restores its progress on reconnect", async () => {
    vi.useFakeTimers()
    try {
      const onPeersChange = vi.fn<(peers: P2PSenderPeerInfo[]) => void>()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange,
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const ws = MockWebSocket.instances[0]
      ws.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      const channel = MockPeerConnection.instances[0].dataChannel
      channel.open()
      ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)
      channel.receive({ type: "progress", revision: session.currentFile.revision, doneBytes: 2 })

      ws.receive({ type: "peer-left", role: "receiver", peerId: "receiver-1", resumable: true })
      await vi.advanceTimersByTimeAsync(61_000)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        peerId: "receiver-1",
        progress: { doneBytes: 2, totalBytes: 4, speedBytesPerSecond: 0 },
        transferStatus: "WAITING",
        isConnected: false,
        isWaitingForResume: true,
      })

      ws.onclose?.call(ws as unknown as WebSocket, new CloseEvent("close"))
      await vi.advanceTimersByTimeAsync(1_000)
      const reconnectedSocket = MockWebSocket.instances[1]
      reconnectedSocket.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [] },
      })
      await vi.advanceTimersByTimeAsync(31_000)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        peerId: "receiver-1",
        transferStatus: "WAITING",
        isWaitingForResume: true,
      })

      reconnectedSocket.receive({ type: "peer-joined", role: "receiver", peerId: "receiver-1" })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(2)
      expect(onPeersChange.mock.calls[onPeersChange.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
        peerId: "receiver-1",
        progress: { doneBytes: 2, totalBytes: 4 },
        isWaitingForResume: false,
      })
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("prunes superseded file versions after the in-flight request grace period", async () => {
    vi.useFakeTimers()
    try {
      const session = await startP2PSender(new File(["old"], "old.bin"), config, "1h", "1", false, {
        onStatus: vi.fn(),
        onPeersChange: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })
      const ws = MockWebSocket.instances[0]
      ws.receive({
        type: "ready",
        role: "sender",
        peers: { sender: true, receivers: [{ peerId: "receiver-1" }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(MockPeerConnection.instances).toHaveLength(1)
      const channel = MockPeerConnection.instances[0].dataChannel
      channel.open()
      ws.receive({ type: "receiver-pair-result", peerId: "receiver-1", accepted: true })
      await vi.advanceTimersByTimeAsync(0)

      const supersededFile = new File(["middle"], "middle.bin")
      const supersededSlice = vi.spyOn(supersededFile, "slice")
      const superseded = session.updateFile(supersededFile, false)
      session.updateFile(new File(["latest"], "latest.bin"), false)
      await vi.advanceTimersByTimeAsync(30_000)
      channel.receive({ type: "download", revision: superseded.revision, offset: 0 })

      expect(supersededSlice).not.toHaveBeenCalled()
      expect(
        channel.sent
          .filter((part): part is string => typeof part === "string")
          .map((part) => JSON.parse(part) as { type?: string; message?: string })
          .some(
            (message) =>
              message.type === "error" && message.message === "The requested file version is no longer available.",
          ),
      ).toStrictEqual(true)
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("releases receiver resources when the sender definitively leaves", async () => {
    const sentinel = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(function (this: { released: boolean }) {
        this.released = true
        return Promise.resolve()
      }),
    })
    const requestWakeLock = vi.fn(() => Promise.resolve(sentinel))
    vi.stubGlobal("navigator", {
      userAgent: "Test browser",
      storage: undefined,
      wakeLock: { request: requestWakeLock },
    })
    const onStatus = vi.fn()
    const onProgress = vi.fn()
    const onUpdateAvailable = vi.fn()
    const session = startP2PReceiver("room", config, {
      onStatus,
      onMeta: vi.fn(),
      onUpdateAvailable,
      onProgress,
      onPausedChange: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn((error) => {
        throw error
      }),
    })
    const ws = MockWebSocket.instances[0]
    ws.receive({ type: "offer", peerId: "receiver-1", sdp: { type: "offer", sdp: "offer" } })
    await vi.waitFor(() => expect(MockPeerConnection.instances).toHaveLength(1))
    const peer = MockPeerConnection.instances[0]
    const channel = peer.dataChannel
    peer.receiveDataChannel(channel)
    channel.open()
    channel.receive({
      type: "meta",
      meta: { revision: "old", name: "old.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false },
    })
    await flushTasks()
    session.requestDownload()
    await vi.waitFor(() => expect(requestWakeLock).toHaveBeenCalledOnce())
    channel.receiveData(new Uint8Array([1, 2]).buffer)
    await flushTasks()

    ws.receive({ type: "peer-left", role: "sender" })
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("Sender left. Transfer session closed."))
    await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalledOnce())

    expect(peer.connectionState).toStrictEqual("closed")
    expect(channel.readyState).toStrictEqual("closed")
    expect(onProgress).toHaveBeenLastCalledWith(undefined)
    expect(onUpdateAvailable).toHaveBeenLastCalledWith(undefined)
    const sentCount = channel.sent.length
    session.requestDownload()
    expect(channel.sent).toHaveLength(sentCount)
    session.close()
  })

  it("stops sender reconnect attempts after the absolute deadline", async () => {
    vi.useFakeTimers()
    try {
      const onStatus = vi.fn()
      const session = await startP2PSender(new File(["data"], "file.bin"), config, "1h", "1", false, {
        onStatus,
        onPeersChange: vi.fn(),
        onError: vi.fn((error) => {
          throw error
        }),
      })

      for (const delay of [1_000, 2_000, 4_000, 8_000, 10_000]) {
        const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        socket.onclose?.call(socket as unknown as WebSocket, new CloseEvent("close"))
        await vi.advanceTimersByTimeAsync(delay)
      }
      const finalSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      finalSocket.onclose?.call(finalSocket as unknown as WebSocket, new CloseEvent("close"))

      expect(MockWebSocket.instances).toHaveLength(6)
      expect(onStatus).toHaveBeenLastCalledWith("Unable to restore P2P signaling. Share session closed.")
      expect(finalSocket.onmessage).toBeNull()
      session.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
