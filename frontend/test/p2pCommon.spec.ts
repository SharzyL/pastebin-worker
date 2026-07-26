import { afterEach, describe, expect, it, vi } from "vitest"
import {
  P2PIceCandidateBuffer,
  P2PReconnectPolicy,
  P2PWakeLock,
  appendHashData,
  closeP2PConnection,
  createP2PSignalingTransport,
  finishHashData,
  maxP2PControlMessageLength,
  parseP2PDataMessage,
  p2pControlMessageLengthLimit,
  selectedP2PConnectionRoute,
  sha1Hex,
  verificationBlockSize,
  verificationHashChunks,
  verificationManifestMessages,
  type BlockHashState,
} from "../utils/p2pCommon.js"
import { cleanupStaleOPFSTemporaryFiles } from "../utils/opfs.js"
import {
  P2PPersistentReceiveStore,
  cleanupStaleP2PResumeCheckpoints,
  cleanupStaleP2PSessionPeers,
  readP2PSessionPeerId,
  writeP2PSessionPeerId,
  writeP2PResumeCheckpoint,
} from "../utils/p2pReceiveStore.js"
import { isP2PIceCandidate, isP2PIceServer, isP2PSignalMessage, parseP2PSignalMessage } from "../../shared/p2pSignal.js"

class MockWakeLockSentinel extends EventTarget {
  released = false
  release = vi.fn(() => {
    if (this.released) return Promise.resolve()
    this.released = true
    this.dispatchEvent(new Event("release"))
    return Promise.resolve()
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

describe("P2P signaling validation", () => {
  it("parses a valid ready message with TURN configuration", () => {
    const message = {
      type: "ready",
      role: "receiver",
      peerId: "receiver-1",
      peers: { sender: true, receivers: [] },
      iceServers: [
        {
          urls: ["stun:stun.example.com", "turn:turn.example.com"],
          username: "receiver",
          credential: "secret",
        },
      ],
    }

    expect(isP2PSignalMessage(message)).toBe(true)
    expect(parseP2PSignalMessage(JSON.stringify(message))).toEqual(message)
  })

  it("rejects malformed candidates and ICE servers", () => {
    expect(isP2PIceCandidate({ candidate: 42 })).toBe(false)
    expect(isP2PIceCandidate({ candidate: "candidate", sdpMLineIndex: -1 })).toBe(false)
    expect(isP2PIceServer({ urls: [] })).toBe(false)
    expect(isP2PIceServer({ urls: "turn:turn.example.com", credentialType: "token" })).toBe(false)
  })

  it("rejects unknown, malformed, and oversized messages", () => {
    expect(() => parseP2PSignalMessage("{")).toThrow("Invalid P2P signaling message JSON.")
    expect(() => parseP2PSignalMessage('{"type":"unknown"}')).toThrow("Invalid P2P signaling message.")
    expect(() =>
      parseP2PSignalMessage(
        JSON.stringify({
          type: "candidate",
          peerId: "peer-1",
          candidate: { sdpMLineIndex: -1 },
        }),
      ),
    ).toThrow("Invalid P2P signaling message.")
    expect(() => parseP2PSignalMessage("x".repeat(256 * 1024 + 1))).toThrow("P2P signaling message is too large.")
    expect(parseP2PSignalMessage(new ArrayBuffer(0))).toBeNull()
  })
})

afterEach(() => {
  ResponsiveStorageWorker.instances = []
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("P2P wake lock", () => {
  it("releases a lock that resolves after stop", async () => {
    const pending = deferred<MockWakeLockSentinel>()
    const request = vi.fn(() => pending.promise)
    vi.stubGlobal("navigator", { wakeLock: { request } })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const wakeLock = new P2PWakeLock(vi.fn())
    const sentinel = new MockWakeLockSentinel()

    const starting = wakeLock.start()
    const stopping = wakeLock.stop()
    pending.resolve(sentinel)
    await Promise.all([starting, stopping])

    expect(request).toHaveBeenCalledTimes(1)
    expect(sentinel.release).toHaveBeenCalledTimes(1)
    expect(sentinel.released).toStrictEqual(true)
  })

  it("coalesces repeated acquire requests for the same active generation", async () => {
    const pending = deferred<MockWakeLockSentinel>()
    const request = vi.fn(() => pending.promise)
    vi.stubGlobal("navigator", { wakeLock: { request } })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const wakeLock = new P2PWakeLock(vi.fn())
    const sentinel = new MockWakeLockSentinel()

    const starting = wakeLock.start()
    document.dispatchEvent(new Event("visibilitychange"))
    document.dispatchEvent(new Event("visibilitychange"))
    pending.resolve(sentinel)
    await starting

    expect(request).toHaveBeenCalledTimes(1)
    expect(sentinel.released).toStrictEqual(false)
    await wakeLock.stop()
    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })
})

describe("P2P reconnect policy", () => {
  it("stops scheduling once the absolute reconnect window is exhausted", () => {
    const policy = new P2PReconnectPolicy(30_000)
    expect(policy.nextDelay(0)).toStrictEqual(1_000)
    expect(policy.nextDelay(1_000)).toStrictEqual(2_000)
    expect(policy.nextDelay(3_000)).toStrictEqual(4_000)
    expect(policy.nextDelay(7_000)).toStrictEqual(8_000)
    expect(policy.nextDelay(15_000)).toStrictEqual(10_000)
    expect(policy.nextDelay(25_000)).toBeNull()

    policy.reset()
    expect(policy.nextDelay(25_000)).toStrictEqual(1_000)
  })

  it("can retry beyond the receiver signaling grace deadline", () => {
    const policy = new P2PReconnectPolicy(45_000)
    expect(policy.nextDelay(0)).toStrictEqual(1_000)
    expect(policy.nextDelay(1_000)).toStrictEqual(2_000)
    expect(policy.nextDelay(3_000)).toStrictEqual(4_000)
    expect(policy.nextDelay(7_000)).toStrictEqual(8_000)
    expect(policy.nextDelay(15_000)).toStrictEqual(10_000)
    expect(policy.nextDelay(25_000)).toStrictEqual(10_000)
    expect(policy.nextDelay(35_000)).toStrictEqual(10_000)
    expect(policy.nextDelay(45_000)).toBeNull()
  })
})

describe("P2P signaling transport", () => {
  it("does not auto-connect before start and keeps explicit connect idempotent", () => {
    class SignalingSocket {
      static readonly OPEN = 1
      static instances: SignalingSocket[] = []

      readyState = SignalingSocket.OPEN
      onopen: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null

      constructor(readonly url: string) {
        SignalingSocket.instances.push(this)
      }

      send = vi.fn()

      close() {
        this.readyState = 3
      }
    }
    vi.stubGlobal("WebSocket", SignalingSocket)
    const onClose = vi.fn()
    const transport = createP2PSignalingTransport({
      url: "wss://example.com/p2p",
      shouldReconnect: () => true,
      onOpen: vi.fn(),
      onMessage: () => Promise.resolve(),
      onError: vi.fn(),
      onSocketError: vi.fn(),
      onClose,
      onReconnectExhausted: vi.fn(),
    })

    window.dispatchEvent(new Event("online"))
    document.dispatchEvent(new Event("visibilitychange"))
    expect(SignalingSocket.instances).toHaveLength(0)

    transport.connect()
    transport.connect()
    expect(SignalingSocket.instances).toHaveLength(1)

    window.dispatchEvent(new Event("online"))
    expect(SignalingSocket.instances).toHaveLength(2)
    expect(SignalingSocket.instances[0]?.readyState).toStrictEqual(3)
    expect(onClose).toHaveBeenCalledOnce()
    transport.close()
  })
})

describe("P2P data messages", () => {
  it("parses messages from each peer direction through one validator", () => {
    const meta = { name: "file.bin", size: 4, type: "", lastModified: 0, verifyTransfer: false }

    expect(parseP2PDataMessage(JSON.stringify({ type: "meta", meta }), "sender")).toStrictEqual({
      type: "meta",
      meta,
    })
    expect(parseP2PDataMessage(JSON.stringify({ type: "progress", doneBytes: 3 }), "receiver")).toStrictEqual({
      type: "progress",
      doneBytes: 3,
    })
  })

  it("rejects invalid fields and messages sent in the wrong direction", () => {
    expect(() => parseP2PDataMessage(JSON.stringify({ type: "download", offset: -1 }), "receiver")).toThrow(
      "download offset",
    )
    expect(() => parseP2PDataMessage(JSON.stringify({ type: "received", revision: "" }), "receiver")).toThrow(
      "revision",
    )
    expect(() => parseP2PDataMessage(JSON.stringify({ type: "meta", meta: {} }), "receiver")).toThrow(
      "Unexpected P2P receiver message type",
    )
  })
})

describe("P2P peer connection helpers", () => {
  it.each([
    ["host", "srflx", "direct"],
    ["srflx", "relay", "relay"],
  ] as const)("classifies a selected %s/%s ICE candidate pair as %s", async (localType, remoteType, route) => {
    const reports = new Map<string, RTCStats>([
      ["transport", { id: "transport", type: "transport", timestamp: 1, selectedCandidatePairId: "pair" } as RTCStats],
      [
        "pair",
        {
          id: "pair",
          type: "candidate-pair",
          timestamp: 1,
          localCandidateId: "local",
          remoteCandidateId: "remote",
        } as RTCStats,
      ],
      ["local", { id: "local", type: "local-candidate", timestamp: 1, candidateType: localType } as RTCStats],
      ["remote", { id: "remote", type: "remote-candidate", timestamp: 1, candidateType: remoteType } as RTCStats],
    ])
    const connection = {
      getStats: vi.fn(() => Promise.resolve(reports as unknown as RTCStatsReport)),
    } as unknown as RTCPeerConnection

    await expect(selectedP2PConnectionRoute(connection)).resolves.toStrictEqual(route)
  })

  it("buffers ICE candidates until a remote description is available", async () => {
    const addIceCandidate = vi.fn(() => Promise.resolve())
    const connectionState = {
      remoteDescription: null as RTCSessionDescription | null,
      addIceCandidate,
    }
    const connection = connectionState as unknown as RTCPeerConnection
    const candidates = new P2PIceCandidateBuffer()
    const first = { candidate: "first" }
    const second = { candidate: "second" }

    candidates.add(first)
    await candidates.addOrBuffer(connection, second)
    await candidates.flush(connection)
    expect(addIceCandidate).not.toHaveBeenCalled()

    connectionState.remoteDescription = {
      type: "offer",
      sdp: "offer",
    } as RTCSessionDescription
    await candidates.flush(connection)
    expect(addIceCandidate).toHaveBeenNthCalledWith(1, first)
    expect(addIceCandidate).toHaveBeenNthCalledWith(2, second)
  })

  it("detaches and closes the data channel and peer connection together", () => {
    const closeChannel = vi.fn()
    const closeConnection = vi.fn()
    const channel = {
      onopen: vi.fn(),
      onmessage: vi.fn(),
      onclose: vi.fn(),
      onerror: vi.fn(),
      close: closeChannel,
    } as unknown as RTCDataChannel
    const connection = {
      onicecandidate: vi.fn(),
      oniceconnectionstatechange: vi.fn(),
      onconnectionstatechange: vi.fn(),
      ondatachannel: vi.fn(),
      close: closeConnection,
    } as unknown as RTCPeerConnection

    closeP2PConnection(connection, channel)

    expect(channel.onopen).toBeNull()
    expect(channel.onmessage).toBeNull()
    expect(channel.onclose).toBeNull()
    expect(channel.onerror).toBeNull()
    expect(closeChannel).toHaveBeenCalledOnce()
    expect(connection.onicecandidate).toBeNull()
    expect(connection.oniceconnectionstatechange).toBeNull()
    expect(connection.onconnectionstatechange).toBeNull()
    expect(connection.ondatachannel).toBeNull()
    expect(closeConnection).toHaveBeenCalledOnce()
  })
})

describe("P2P block hashing", () => {
  it("keeps block boundaries while hashing into one reusable contiguous buffer", async () => {
    const bytes = new Uint8Array(verificationBlockSize + 17)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    const state: BlockHashState = {
      index: 0,
      size: 0,
      buffer: new Uint8Array(0),
      hashes: [],
    }

    await appendHashData(state, bytes.slice(0, 123_457).buffer)
    await appendHashData(state, bytes.slice(123_457).buffer)
    const hashes = await finishHashData(state)

    expect(hashes).toStrictEqual([
      await sha1Hex([bytes.slice(0, verificationBlockSize).buffer]),
      await sha1Hex([bytes.slice(verificationBlockSize).buffer]),
    ])
    expect(state.size).toStrictEqual(0)
    expect(state.buffer.byteLength).toStrictEqual(0)
  })

  it("splits verification hashes within the negotiated control message limit", () => {
    const hashes = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0"))
    const chunks = [...verificationHashChunks(hashes, 160)]

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((chunk) => chunk.hashes)).toStrictEqual(hashes)
    expect(chunks.map((chunk) => chunk.startIndex)).toStrictEqual(
      chunks.map((_, index) => chunks.slice(0, index).reduce((sum, chunk) => sum + chunk.hashes.length, 0)),
    )
    for (const chunk of chunks) expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(160)
  })

  it("caps verification messages at the application and negotiated limits", () => {
    expect(p2pControlMessageLengthLimit(undefined)).toStrictEqual(256 * 1024)
    expect(p2pControlMessageLengthLimit(256 * 1024)).toStrictEqual(256 * 1024)
    expect(p2pControlMessageLengthLimit(0)).toStrictEqual(maxP2PControlMessageLength)
    expect(p2pControlMessageLengthLimit(2 * 1024 * 1024)).toStrictEqual(maxP2PControlMessageLength)
    expect(() => [...verificationHashChunks(["a".repeat(40)], 32)]).toThrow("too small")
  })

  it("keeps small manifests compatible and chunks only manifests that exceed the limit", () => {
    const smallManifest = { blockSize: verificationBlockSize, hashes: ["a".repeat(40)] }
    expect([...verificationManifestMessages(smallManifest, 1024)]).toStrictEqual([
      { type: "done", verification: smallManifest },
    ])

    const largeManifest = {
      blockSize: verificationBlockSize,
      hashes: Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(40, "0")),
    }
    const messages = [...verificationManifestMessages(largeManifest, 160)]
    expect(messages[0]).toStrictEqual({
      type: "verification-start",
      blockSize: verificationBlockSize,
      hashCount: largeManifest.hashes.length,
    })
    expect(messages[messages.length - 1]).toStrictEqual({ type: "done" })
    expect(messages.flatMap((message) => (message.type === "verification-chunk" ? message.hashes : []))).toStrictEqual(
      largeManifest.hashes,
    )
    for (const message of messages) expect(JSON.stringify(message).length).toBeLessThanOrEqual(160)
  })
})

describe("P2P OPFS cleanup", () => {
  it("removes only stale P2P temporary files", async () => {
    const now = Date.UTC(2030, 0, 2)
    const handles = new Map<string, FileSystemFileHandle>([
      [
        "p2p-stale.tmp",
        {
          kind: "file",
          getFile: () =>
            Promise.resolve(new File(["old"], "p2p-stale.tmp", { lastModified: now - 25 * 60 * 60 * 1000 })),
        } as FileSystemFileHandle,
      ],
      [
        "p2p-current.tmp",
        {
          kind: "file",
          getFile: () => Promise.resolve(new File(["new"], "p2p-current.tmp", { lastModified: now - 60 * 60 * 1000 })),
        } as FileSystemFileHandle,
      ],
      [
        "p2p-held-stale.tmp",
        {
          kind: "file",
          getFile: () =>
            Promise.resolve(new File(["held"], "p2p-held-stale.tmp", { lastModified: now - 26 * 60 * 60 * 1000 })),
        } as FileSystemFileHandle,
      ],
      [
        "other-stale.tmp",
        {
          kind: "file",
          getFile: () => Promise.resolve(new File(["old"], "other-stale.tmp", { lastModified: 0 })),
        } as FileSystemFileHandle,
      ],
    ])
    const removeEntry = vi.fn(() => Promise.resolve())
    const root = {
      entries: async function* () {
        await Promise.resolve()
        yield* handles.entries()
      },
      removeEntry,
    } as unknown as FileSystemDirectoryHandle
    const request = vi.fn(
      (lockName: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) =>
        callback(lockName.endsWith("p2p-held-stale.tmp") ? null : { name: lockName, mode: "exclusive" }),
    )
    vi.stubGlobal("navigator", { locks: { request } })

    expect(await cleanupStaleOPFSTemporaryFiles(root, now)).toStrictEqual(1)
    expect(removeEntry).toHaveBeenCalledOnce()
    expect(removeEntry).toHaveBeenCalledWith("p2p-stale.tmp")
    expect(request).toHaveBeenCalledTimes(2)
  })
})

interface WorkerRequest {
  id: number
  type: string
  position?: number
  parts?: ArrayBuffer[]
}

class ResponsiveStorageWorker {
  static instances: ResponsiveStorageWorker[] = []
  readonly requests: { message: WorkerRequest; transfer: Transferable[] }[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null

  constructor() {
    ResponsiveStorageWorker.instances.push(this)
  }

  postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    this.requests.push({ message, transfer })
    queueMicrotask(() => {
      this.onmessage?.(
        new MessageEvent("message", {
          data: {
            id: message.id,
            ok: true,
            value: message.type === "open" ? { tail: new ArrayBuffer(0) } : undefined,
          },
        }),
      )
    })
  }

  terminate() {
    return undefined
  }
}

class FailingStorageWorker extends ResponsiveStorageWorker {
  override postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    this.requests.push({ message, transfer })
  }

  fail() {
    this.onerror?.(new ErrorEvent("error", { message: "worker failed" }))
  }
}

function mockExclusiveLocks() {
  const active = new Set<string>()
  const request = vi.fn(
    async (lockName: string, _options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> => {
      if (active.has(lockName)) return await callback(null)
      active.add(lockName)
      try {
        return await callback({ name: lockName, mode: "exclusive" })
      } finally {
        active.delete(lockName)
      }
    },
  )
  return { active, request }
}

describe("P2P persistent receive store", () => {
  it("keeps its OPFS entry until the completed File is discarded", async () => {
    const peerId = "00000000-0000-4000-8000-000000000060"
    const locks = mockExclusiveLocks()
    const removeEntry = vi.fn(() => Promise.resolve())
    const getFileHandle = vi.fn(() => Promise.resolve({ getFile: () => Promise.resolve(new File(["stored"], "temp")) }))
    vi.stubGlobal("Worker", ResponsiveStorageWorker)
    vi.stubGlobal("navigator", {
      locks,
      storage: {
        getDirectory: () => Promise.resolve({ getFileHandle, removeEntry }),
      },
    })
    const store = new P2PPersistentReceiveStore(peerId)
    await store.open(0, 0)
    expect(locks.active).toContain(`pastebin-worker:opfs:p2p-${peerId}.tmp`)

    const file = await store.file({
      revision: "revision",
      name: "received.txt",
      size: 6,
      type: "text/plain",
      lastModified: 123,
      verifyTransfer: false,
    })

    expect(removeEntry).not.toHaveBeenCalled()
    expect(await file.text()).toStrictEqual("stored")
    expect(locks.active).toContain(`pastebin-worker:opfs:p2p-${peerId}.tmp`)

    await store.discard()
    expect(removeEntry).toHaveBeenCalledOnce()
    expect(removeEntry).toHaveBeenCalledWith(`p2p-${peerId}.tmp`)
    await vi.waitFor(() => expect(locks.active.size).toStrictEqual(0))
  })

  it("batches sequential 64 KiB chunks into one zero-copy scatter write", async () => {
    vi.stubGlobal("Worker", ResponsiveStorageWorker)
    const store = new P2PPersistentReceiveStore("00000000-0000-4000-8000-000000000061")
    await store.open(0, 0)

    const chunkBytes = 64 * 1024
    for (let index = 0; index < 16; index += 1) {
      await store.write(index * chunkBytes, new ArrayBuffer(chunkBytes))
    }

    const worker = ResponsiveStorageWorker.instances[0]
    const writes = worker.requests.filter(({ message }) => message.type === "write")
    expect(writes).toHaveLength(1)
    expect(writes[0].message.position).toStrictEqual(0)
    expect(writes[0].message.parts).toHaveLength(16)
    expect(writes[0].message.parts?.reduce((sum, part) => sum + part.byteLength, 0)).toStrictEqual(1024 * 1024)
    expect(writes[0].transfer).toStrictEqual(writes[0].message.parts)

    await store.discard()
  })

  it("falls back to direct cleanup after a fatal worker error", async () => {
    const removeEntry = vi.fn(() => Promise.resolve())
    vi.stubGlobal("Worker", FailingStorageWorker)
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve({ removeEntry }),
      },
    })
    const peerId = "00000000-0000-4000-8000-000000000062"
    const store = new P2PPersistentReceiveStore(peerId)
    const opening = store.open(0, 0)
    const worker = ResponsiveStorageWorker.instances[0] as FailingStorageWorker
    worker.fail()

    await expect(opening).rejects.toThrow("P2P storage worker failed")
    await expect(store.discard()).resolves.toBeUndefined()
    expect(worker.requests.map(({ message }) => message.type)).toStrictEqual(["open"])
    expect(removeEntry).toHaveBeenCalledWith(`p2p-${peerId}.tmp`)
  })
})

describe("P2P resume checkpoint cleanup", () => {
  it("removes stale or malformed checkpoints for every room and preserves unrelated storage", () => {
    const now = Date.now()
    writeP2PResumeCheckpoint({
      version: 1,
      roomName: "active-room",
      peerId: "00000000-0000-4000-8000-000000000063",
      meta: {
        revision: "revision",
        name: "active.bin",
        size: 10,
        type: "application/octet-stream",
        lastModified: 0,
        verifyTransfer: false,
      },
      receivedBytes: 5,
      completedHashes: [],
      updatedAt: now,
    })
    localStorage.setItem(
      "pastebin-worker:p2p-resume:stale-room",
      JSON.stringify({
        version: 1,
        roomName: "stale-room",
        peerId: "00000000-0000-4000-8000-000000000064",
        meta: {
          revision: "revision",
          name: "stale.bin",
          size: 10,
          type: "application/octet-stream",
          lastModified: 0,
          verifyTransfer: false,
        },
        receivedBytes: 5,
        completedHashes: [],
        updatedAt: now - 25 * 60 * 60 * 1000,
      }),
    )
    localStorage.setItem("pastebin-worker:p2p-resume:broken-room", "not-json")
    localStorage.setItem("unrelated", "keep")

    expect(cleanupStaleP2PResumeCheckpoints(now)).toStrictEqual(2)
    expect(localStorage.getItem("pastebin-worker:p2p-resume:active-room")).not.toBeNull()
    expect(localStorage.getItem("pastebin-worker:p2p-resume:stale-room")).toBeNull()
    expect(localStorage.getItem("pastebin-worker:p2p-resume:broken-room")).toBeNull()
    expect(localStorage.getItem("unrelated")).toStrictEqual("keep")

    localStorage.removeItem("pastebin-worker:p2p-resume:active-room")
    localStorage.removeItem("unrelated")
  })
})

describe("P2P session peer cleanup", () => {
  it("expires malformed and old peers while migrating the UUID-only format", () => {
    const now = Date.now()
    const activePeerId = "00000000-0000-4000-8000-000000000071"
    const legacyPeerId = "00000000-0000-4000-8000-000000000072"
    const stalePeerId = "00000000-0000-4000-8000-000000000073"

    expect(writeP2PSessionPeerId("active-room", activePeerId)).toStrictEqual(true)
    sessionStorage.setItem("pastebin-worker:p2p-peer:legacy-room", legacyPeerId)
    sessionStorage.setItem(
      "pastebin-worker:p2p-peer:stale-room",
      JSON.stringify({ version: 1, peerId: stalePeerId, updatedAt: now - 25 * 60 * 60 * 1000 }),
    )
    sessionStorage.setItem("pastebin-worker:p2p-peer:broken-room", "not-json")
    sessionStorage.setItem("unrelated", "keep")

    expect(cleanupStaleP2PSessionPeers(now)).toStrictEqual(2)
    expect(readP2PSessionPeerId("active-room")).toStrictEqual(activePeerId)
    expect(readP2PSessionPeerId("legacy-room")).toStrictEqual(legacyPeerId)
    expect(sessionStorage.getItem("pastebin-worker:p2p-peer:legacy-room")).toContain('"version":1')
    expect(sessionStorage.getItem("pastebin-worker:p2p-peer:stale-room")).toBeNull()
    expect(sessionStorage.getItem("pastebin-worker:p2p-peer:broken-room")).toBeNull()
    expect(sessionStorage.getItem("unrelated")).toStrictEqual("keep")
  })
})
