import { createExecutionContext, env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { P2PRoom, getTurnIceServers, handleP2PUpdate, selfHostedTurnCredentialsCacheKey } from "../p2p.js"
import { PASTE_NAME_LEN } from "../../shared/constants.js"
import type { P2PCreateResponse } from "../../shared/interfaces.js"
import { workerFetch } from "./testUtils.js"

interface CollectedSocket {
  socket: WebSocket
  messages: Record<string, unknown>[]
}

function collectSocket(response: Response): CollectedSocket {
  expect(response.status).toStrictEqual(101)
  const socket = response.webSocket
  expect(socket).not.toBeNull()
  const messages: Record<string, unknown>[] = []
  socket!.addEventListener("message", (event) => {
    if (typeof event.data === "string") messages.push(JSON.parse(event.data) as Record<string, unknown>)
  })
  socket!.accept()
  return { socket: socket!, messages }
}

async function connect(
  stub: DurableObjectStub,
  role: "sender" | "receiver",
  options: { peerId?: string; token?: string } = {},
): Promise<CollectedSocket> {
  const url = new URL("https://p2p-room/ws")
  url.searchParams.set("role", role)
  if (options.peerId) url.searchParams.set("peerId", options.peerId)
  if (options.token) url.searchParams.set("token", options.token)
  const response = await stub.fetch(
    new Request(url, {
      headers: { Upgrade: "websocket" },
    }),
  )
  return collectSocket(response)
}

describe("P2P room creation", () => {
  it("creates a six-character pairing URL", async () => {
    const response = await workerFetch(
      createExecutionContext(),
      new Request(`${env.DEPLOY_URL}/p2p/create`, { method: "POST" }),
    )
    expect(response.status).toStrictEqual(200)

    const result = await response.json<P2PCreateResponse>()
    expect(result.name).toHaveLength(PASTE_NAME_LEN)
    expect(new URL(result.displayUrl).pathname).toStrictEqual(`/p/${result.name}`)
    expect(result).not.toHaveProperty("iceServers")

    const displayResponse = await workerFetch(createExecutionContext(), new Request(result.displayUrl))
    expect(displayResponse.status).toStrictEqual(200)
    expect(await displayResponse.text()).toContain(`<title>${env.INDEX_PAGE_TITLE} / ${result.name} (P2P)</title>`)
  })

  it("invalidates self-hosted TURN credentials when the shared secret changes", async () => {
    const urls = ["turn:turn.example.com:3478?transport=tcp"]
    const first = await selfHostedTurnCredentialsCacheKey(urls, "first-long-random-secret")
    const second = await selfHostedTurnCredentialsCacheKey(urls, "second-long-random-secret")

    expect(first).not.toStrictEqual(second)
    expect(first).not.toContain("first-long-random-secret")
    expect(second).not.toContain("second-long-random-secret")
  })

  it("omits ICE servers when self-hosted TURN validation fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const result = await getTurnIceServers({
        ...env,
        CF_TURN_ID: undefined,
        CF_TURN_API_SECRET: undefined,
        TURN_URLS: ["turn:unprobeable.example.com:3478?transport=udp"],
        TURN_SHARED_SECRET: "test-long-random-secret",
      } as unknown as Env)

      expect(result).toStrictEqual({})
      expect(warn).toHaveBeenCalledWith(
        "Self-hosted TURN health check failed; omitting ICE servers: " +
          "Worker-side TURN health checks require at least one turn: or turns: URL with ?transport=tcp",
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe("P2P room socket recovery cleanup", () => {
  it("rejects duplicate restored receivers and closes every accepted socket when the room ends", async () => {
    const peerId = "00000000-0000-4000-8000-000000000071"
    const socket = (role: "sender" | "receiver", id?: string) => {
      const close = vi.fn()
      return {
        close,
        websocket: {
          readyState: WebSocket.OPEN,
          deserializeAttachment: () => ({ role, peerId: id }),
          send: vi.fn(),
          close,
        } as unknown as WebSocket,
      }
    }
    const sender = socket("sender")
    const receiver = socket("receiver", peerId)
    const duplicateReceiver = socket("receiver", peerId)
    const sockets = [sender.websocket, receiver.websocket, duplicateReceiver.websocket]
    const deleteAll = vi.fn(() => Promise.resolve())
    const deleteAlarm = vi.fn(() => Promise.resolve())
    const state = {
      getWebSockets: () => sockets,
      storage: { deleteAll, deleteAlarm },
    } as unknown as DurableObjectState

    const room = new P2PRoom(state, env)
    expect(duplicateReceiver.close).toHaveBeenCalledWith(1008, "duplicate receiver")

    sender.close.mockClear()
    receiver.close.mockClear()
    duplicateReceiver.close.mockClear()
    await (
      room as unknown as {
        closeRoomAfterSenderLeft: () => Promise<void>
      }
    ).closeRoomAfterSenderLeft()

    expect(sender.close).toHaveBeenCalledWith(1000, "sender left")
    expect(receiver.close).toHaveBeenCalledWith(1000, "sender left")
    expect(duplicateReceiver.close).toHaveBeenCalledWith(1000, "sender left")
    expect(deleteAll).toHaveBeenCalledOnce()
    expect(deleteAlarm).toHaveBeenCalledOnce()
  })

  it("restores the newest hibernated socket for each role", () => {
    const peerId = "00000000-0000-4000-8000-000000000072"
    const restoredSocket = (role: "sender" | "receiver", connectedAt: number, id?: string) => {
      const close = vi.fn()
      return {
        close,
        socket: {
          readyState: WebSocket.OPEN,
          deserializeAttachment: () => ({ role, peerId: id, connectedAt }),
          send: vi.fn(),
          close,
        } as unknown as WebSocket,
      }
    }
    const oldSender = restoredSocket("sender", 1)
    const newSender = restoredSocket("sender", 2)
    const oldReceiver = restoredSocket("receiver", 1, peerId)
    const newReceiver = restoredSocket("receiver", 2, peerId)
    const state = {
      getWebSockets: () => [oldSender.socket, oldReceiver.socket, newSender.socket, newReceiver.socket],
    } as unknown as DurableObjectState

    new P2PRoom(state, env)

    expect(oldSender.close).toHaveBeenCalledWith(1001, "sender reconnected")
    expect(oldReceiver.close).toHaveBeenCalledWith(1001, "peer reconnected")
    expect(newSender.close).not.toHaveBeenCalled()
    expect(newReceiver.close).not.toHaveBeenCalled()
  })
})

describe("P2P room transfer limits", () => {
  const sockets: WebSocket[] = []

  afterEach(() => {
    for (const socket of sockets) socket.close()
    sockets.length = 0
  })

  it("authorizes only one of two receivers that pair concurrently", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    const initResponse = await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() + 60_000,
        maxTransfers: 1,
      }),
    })
    expect(initResponse.ok).toStrictEqual(true)

    const sender = await connect(stub, "sender", { token: senderToken })
    const firstPeerId = "00000000-0000-4000-8000-000000000001"
    const secondPeerId = "00000000-0000-4000-8000-000000000002"
    const firstReceiver = await connect(stub, "receiver", { peerId: firstPeerId })
    const secondReceiver = await connect(stub, "receiver", { peerId: secondPeerId })
    sockets.push(sender.socket, firstReceiver.socket, secondReceiver.socket)

    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId: firstPeerId }))
    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId: secondPeerId }))

    await expect
      .poll(() => sender.messages.filter((message) => message.type === "receiver-pair-result").length)
      .toStrictEqual(2)
    const pairResults = sender.messages.filter((message) => message.type === "receiver-pair-result")
    expect(pairResults).toContainEqual({ type: "receiver-pair-result", peerId: firstPeerId, accepted: true })
    expect(pairResults).toContainEqual({ type: "receiver-pair-result", peerId: secondPeerId, accepted: false })
    await expect
      .poll(() => secondReceiver.messages.some((message) => message.type === "receiver-limit-reached"))
      .toStrictEqual(true)

    sender.socket.send(JSON.stringify({ type: "transfer-complete", peerId: firstPeerId }))
    await expect
      .poll(() => sender.messages.some((message) => message.type === "transfer-limit-complete"))
      .toStrictEqual(true)
    await expect
      .poll(() => firstReceiver.messages.some((message) => message.type === "transfer-limit-complete"))
      .toStrictEqual(true)

    const nextReceiverUrl = new URL("https://p2p-room/ws")
    nextReceiverUrl.searchParams.set("role", "receiver")
    nextReceiverUrl.searchParams.set("peerId", "00000000-0000-4000-8000-000000000003")
    const nextReceiverResponse = await stub.fetch(new Request(nextReceiverUrl, { headers: { Upgrade: "websocket" } }))
    expect(nextReceiverResponse.status).toStrictEqual(429)
  })

  it("updates room admission without interrupting receivers that already hold slots", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() + 60_000,
        maxTransfers: 0,
      }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const firstPeerId = "00000000-0000-4000-8000-000000000011"
    const secondPeerId = "00000000-0000-4000-8000-000000000012"
    const firstReceiver = await connect(stub, "receiver", { peerId: firstPeerId })
    const secondReceiver = await connect(stub, "receiver", { peerId: secondPeerId })
    sockets.push(sender.socket, firstReceiver.socket, secondReceiver.socket)

    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId: firstPeerId }))
    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId: secondPeerId }))
    await expect
      .poll(() => sender.messages.filter((message) => message.type === "receiver-pair-result").length)
      .toStrictEqual(2)

    const loweredResponse = await stub.fetch("https://p2p-room/update", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() + 120_000,
        expirationSeconds: 120,
        maxTransfers: 1,
      }),
    })
    expect(loweredResponse.ok).toStrictEqual(true)
    expect(await loweredResponse.json()).toMatchObject({
      maxTransfers: 1,
      joinable: false,
      pairedReceivers: 2,
    })

    sender.socket.send(JSON.stringify({ type: "transfer-complete", peerId: firstPeerId }))
    sender.socket.send(JSON.stringify({ type: "transfer-complete", peerId: secondPeerId }))
    sender.socket.send(JSON.stringify({ type: "transfer-complete", peerId: firstPeerId }))
    await expect
      .poll(() => firstReceiver.messages.some((message) => message.type === "transfer-limit-complete"))
      .toStrictEqual(true)
    await expect
      .poll(() => secondReceiver.messages.some((message) => message.type === "transfer-limit-complete"))
      .toStrictEqual(true)

    const blockedUrl = new URL("https://p2p-room/ws")
    blockedUrl.searchParams.set("role", "receiver")
    blockedUrl.searchParams.set("peerId", "00000000-0000-4000-8000-000000000013")
    expect(
      (
        await stub.fetch(
          new Request(blockedUrl, {
            headers: { Upgrade: "websocket" },
          }),
        )
      ).status,
    ).toStrictEqual(429)

    const raisedResponse = await stub.fetch("https://p2p-room/update", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() + 180_000,
        expirationSeconds: 180,
        maxTransfers: 3,
      }),
    })
    expect(await raisedResponse.json()).toMatchObject({
      maxTransfers: 3,
      joinable: true,
      pairedReceivers: 2,
      successfulReceivers: 2,
    })
    const thirdReceiver = await connect(stub, "receiver", {
      peerId: "00000000-0000-4000-8000-000000000013",
    })
    sockets.push(thirdReceiver.socket)

    const expiredResponse = await stub.fetch("https://p2p-room/update", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() - 1,
        expirationSeconds: 0,
        maxTransfers: 3,
      }),
    })
    expect(await expiredResponse.json()).toMatchObject({ joinable: false })
    const expiredUrl = new URL("https://p2p-room/ws")
    expiredUrl.searchParams.set("role", "receiver")
    expiredUrl.searchParams.set("peerId", "00000000-0000-4000-8000-000000000014")
    expect(
      (
        await stub.fetch(
          new Request(expiredUrl, {
            headers: { Upgrade: "websocket" },
          }),
        )
      ).status,
    ).toStrictEqual(410)

    const invalidTokenResponse = await stub.fetch("https://p2p-room/update", {
      method: "POST",
      body: JSON.stringify({
        senderToken: "wrong",
        expiresAt: Date.now() + 60_000,
        expirationSeconds: 60,
        maxTransfers: 3,
      }),
    })
    expect(invalidTokenResponse.status).toStrictEqual(403)
  })

  it("keeps a paired receiver slot during signaling grace and releases it after the deadline", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const firstPeerId = "00000000-0000-4000-8000-000000000021"
    const receiver = await connect(stub, "receiver", { peerId: firstPeerId })
    sockets.push(sender.socket, receiver.socket)
    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId: firstPeerId }))
    await expect
      .poll(() => sender.messages.some((message) => message.type === "receiver-pair-result" && message.accepted))
      .toStrictEqual(true)

    receiver.socket.close()
    await expect
      .poll(() =>
        sender.messages.find(
          (message) => message.type === "peer-signaling-disconnected" && message.peerId === firstPeerId,
        ),
      )
      .toMatchObject({ role: "receiver" })

    const blockedUrl = new URL("https://p2p-room/ws")
    blockedUrl.searchParams.set("role", "receiver")
    blockedUrl.searchParams.set("peerId", "00000000-0000-4000-8000-000000000022")
    expect((await stub.fetch(new Request(blockedUrl, { headers: { Upgrade: "websocket" } }))).status).toStrictEqual(429)

    const resumed = await connect(stub, "receiver", { peerId: firstPeerId })
    sockets.push(resumed.socket)
    await expect
      .poll(() => sender.messages.find((message) => message.type === "peer-joined" && message.peerId === firstPeerId))
      .toBeTruthy()
    expect(
      sender.messages.some((message) => message.type === "peer-left" && message.peerId === firstPeerId),
    ).toStrictEqual(false)
    resumed.socket.close()
    await expect
      .poll(
        () =>
          sender.messages.filter(
            (message) => message.type === "peer-signaling-disconnected" && message.peerId === firstPeerId,
          ).length,
      )
      .toStrictEqual(2)

    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("receiverCleanupAt", { [firstPeerId]: Date.now() - 1 })
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    expect(await runDurableObjectAlarm(stub)).toStrictEqual(true)
    await expect
      .poll(() => sender.messages.find((message) => message.type === "peer-left" && message.peerId === firstPeerId))
      .toMatchObject({ resumable: false })
    const replacement = await connect(stub, "receiver", {
      peerId: "00000000-0000-4000-8000-000000000022",
    })
    sockets.push(replacement.socket)
  })

  it("replaces a live receiver socket without reporting the replacement as disconnected", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000025"
    const firstReceiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, firstReceiver.socket)
    await expect
      .poll(() => sender.messages.filter((message) => message.type === "peer-joined" && message.peerId === peerId))
      .toHaveLength(1)

    const replacement = await connect(stub, "receiver", { peerId })
    sockets.push(replacement.socket)
    await expect
      .poll(() => sender.messages.filter((message) => message.type === "peer-joined" && message.peerId === peerId))
      .toHaveLength(2)
    await expect.poll(() => firstReceiver.socket.readyState).toStrictEqual(WebSocket.CLOSED)

    const joinedMessages = sender.messages.filter(
      (message) => message.type === "peer-joined" && message.peerId === peerId,
    )
    expect(joinedMessages[0]?.connectionId).toBeTypeOf("string")
    expect(joinedMessages[1]?.connectionId).toBeTypeOf("string")
    expect(joinedMessages[1]?.connectionId).not.toStrictEqual(joinedMessages[0]?.connectionId)
    expect(
      sender.messages.filter((message) => message.type === "peer-signaling-disconnected" && message.peerId === peerId),
    ).toHaveLength(0)

    replacement.socket.close()
    await expect
      .poll(() =>
        sender.messages.find((message) => message.type === "peer-signaling-disconnected" && message.peerId === peerId),
      )
      .toMatchObject({ connectionId: joinedMessages[1]?.connectionId })
  })

  it("retains socket generation metadata when a heartbeat rewrites the attachment", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000027"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, receiver.socket)

    await runInDurableObject(stub, (instance, state) => {
      const serverSocket = state
        .getWebSockets()
        .find(
          (socket) =>
            (socket.deserializeAttachment() as { role?: string; peerId?: string } | null)?.role === "receiver" &&
            (socket.deserializeAttachment() as { peerId?: string } | null)?.peerId === peerId,
        )
      expect(serverSocket).toBeTruthy()
      const before = serverSocket!.deserializeAttachment() as { connectionId?: string; connectedAt?: number }
      expect(before.connectionId).toBeTypeOf("string")
      expect(before.connectedAt).toBeTypeOf("number")

      const room = instance as unknown as { sendHeartbeat: (now: number) => void }
      room.sendHeartbeat(Date.now())

      expect(serverSocket!.deserializeAttachment()).toMatchObject({
        connectionId: before.connectionId,
        connectedAt: before.connectedAt,
      })
    })
  })

  it("routes peer recovery through the sender without trusting a receiver-supplied peer ID", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000023"
    const retryToken = "00000000-0000-4000-8000-000000000024"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, receiver.socket)

    receiver.socket.send(
      JSON.stringify({
        type: "peer-reconnect-request",
        peerId: "00000000-0000-4000-8000-000000000099",
        retryToken,
      }),
    )
    await expect
      .poll(() => sender.messages.find((message) => message.type === "peer-reconnect-request"))
      .toStrictEqual({ type: "peer-reconnect-request", peerId, retryToken })

    sender.socket.send(JSON.stringify({ type: "peer-reconnect-failed", peerId, retryToken }))
    await expect
      .poll(() => receiver.messages.find((message) => message.type === "peer-reconnect-failed"))
      .toStrictEqual({ type: "peer-reconnect-failed", peerId, retryToken })
  })

  it("keeps the room recoverable while backgrounded signaling sockets reconnect", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000024"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, receiver.socket)

    sender.socket.close()
    await expect
      .poll(() => receiver.messages.find((message) => message.type === "peer-signaling-disconnected"))
      .toStrictEqual({ type: "peer-signaling-disconnected", role: "sender" })

    receiver.socket.close()
    const backgroundedAt = Date.now()
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(backgroundedAt + 31_000)
    try {
      await runInDurableObject(stub, async (_instance, state) => {
        await state.storage.setAlarm(Date.now())
      })
      expect(await runDurableObjectAlarm(stub)).toStrictEqual(true)
      expect(await (await stub.fetch("https://p2p-room/status")).json()).toMatchObject({ active: true })
    } finally {
      dateNow.mockRestore()
    }

    const refreshedReceiver = await connect(stub, "receiver", { peerId })
    sockets.push(refreshedReceiver.socket)
    await expect
      .poll(() =>
        refreshedReceiver.messages.find(
          (message) =>
            message.type === "ready" && (message.peers as { sender?: boolean } | undefined)?.sender === false,
        ),
      )
      .toBeTruthy()

    const reconnectedSender = await connect(stub, "sender", { token: senderToken })
    sockets.push(reconnectedSender.socket)
    await expect
      .poll(
        () =>
          refreshedReceiver.messages.filter(
            (message) => message.type === "ready" && (message.peers as { sender?: boolean } | undefined)?.sender,
          ).length,
      )
      .toBeGreaterThanOrEqual(1)
    expect(
      refreshedReceiver.messages.some((message) => message.type === "peer-left" && message.role === "sender"),
    ).toStrictEqual(false)
  })

  it("closes the room immediately when the sender explicitly ends the session", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000075"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, receiver.socket)

    sender.socket.send(JSON.stringify({ type: "sender-leave" }))

    await expect
      .poll(() => receiver.messages.find((message) => message.type === "peer-left" && message.role === "sender"))
      .toBeTruthy()
    await expect
      .poll(async () => (await (await stub.fetch("https://p2p-room/status")).json<{ active: boolean }>()).active)
      .toStrictEqual(false)
  })

  it("lets an authenticated sender replace a stale live signaling socket", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const firstSender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000026"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(firstSender.socket, receiver.socket)

    const replacementSender = await connect(stub, "sender", { token: senderToken })
    sockets.push(replacementSender.socket)
    await expect.poll(() => firstSender.socket.readyState).toStrictEqual(WebSocket.CLOSED)
    await expect
      .poll(() =>
        replacementSender.messages.find(
          (message) =>
            message.type === "ready" &&
            (message.peers as { receivers?: { peerId?: string }[] } | undefined)?.receivers?.some(
              (peer) => peer.peerId === peerId,
            ),
        ),
      )
      .toBeTruthy()
    expect(
      receiver.messages.filter(
        (message) => message.type === "peer-signaling-disconnected" && message.role === "sender",
      ),
    ).toHaveLength(0)
  })

  it("keeps only checkpointed receiver IDs resumable and retires them after completion", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000031"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, receiver.socket)
    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId }))
    await expect
      .poll(() => sender.messages.some((message) => message.type === "receiver-pair-result" && message.accepted))
      .toStrictEqual(true)

    receiver.socket.send(JSON.stringify({ type: "transfer-checkpoint" }))
    await expect
      .poll(() =>
        receiver.messages.some((message) => message.type === "transfer-checkpoint-result" && message.accepted),
      )
      .toStrictEqual(true)
    receiver.socket.close()
    await expect
      .poll(() =>
        sender.messages.find((message) => message.type === "peer-signaling-disconnected" && message.peerId === peerId),
      )
      .toMatchObject({ role: "receiver" })

    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("receiverCleanupAt", { [peerId]: Date.now() - 1 })
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    expect(await runDurableObjectAlarm(stub)).toStrictEqual(true)
    await expect
      .poll(() => sender.messages.find((message) => message.type === "peer-left" && message.peerId === peerId))
      .toMatchObject({ resumable: true })

    const resumed = await connect(stub, "receiver", { peerId })
    sockets.push(resumed.socket)
    sender.socket.send(JSON.stringify({ type: "transfer-complete", peerId }))
    await expect
      .poll(() => resumed.messages.some((message) => message.type === "transfer-limit-complete"))
      .toStrictEqual(true)
    expect(await (await stub.fetch("https://p2p-room/status")).json()).toMatchObject({
      active: true,
      joinable: false,
    })
    const displayResponse = await workerFetch(createExecutionContext(), new Request(`${env.DEPLOY_URL}/p/${name}`))
    expect(displayResponse.status).toStrictEqual(200)
    const completedUrl = new URL("https://p2p-room/ws")
    completedUrl.searchParams.set("role", "receiver")
    completedUrl.searchParams.set("peerId", peerId)
    const completedResponse = await stub.fetch(new Request(completedUrl, { headers: { Upgrade: "websocket" } }))
    expect(completedResponse.status).toStrictEqual(429)
    resumed.socket.close()
  })

  it("allows a checkpointed receiver to reconnect after new receiver admission expires", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000032"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, receiver.socket)
    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId }))
    await expect
      .poll(() => sender.messages.some((message) => message.type === "receiver-pair-result" && message.accepted))
      .toStrictEqual(true)
    receiver.socket.send(JSON.stringify({ type: "transfer-checkpoint" }))
    await expect
      .poll(() =>
        receiver.messages.some((message) => message.type === "transfer-checkpoint-result" && message.accepted),
      )
      .toStrictEqual(true)
    receiver.socket.close()
    await expect
      .poll(() =>
        sender.messages.some((message) => message.type === "peer-signaling-disconnected" && message.peerId === peerId),
      )
      .toStrictEqual(true)
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("receiverCleanupAt", { [peerId]: Date.now() - 1 })
      await state.storage.setAlarm(Date.now() + 60_000)
    })
    expect(await runDurableObjectAlarm(stub)).toStrictEqual(true)
    await expect
      .poll(() =>
        sender.messages.some(
          (message) => message.type === "peer-left" && message.peerId === peerId && message.resumable === true,
        ),
      )
      .toStrictEqual(true)

    const updateResponse = await stub.fetch("https://p2p-room/update", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() - 1,
        expirationSeconds: 0,
        maxTransfers: 1,
      }),
    })
    expect(updateResponse.ok).toStrictEqual(true)

    const newReceiverUrl = new URL("https://p2p-room/ws")
    newReceiverUrl.searchParams.set("role", "receiver")
    newReceiverUrl.searchParams.set("peerId", "00000000-0000-4000-8000-000000000033")
    expect((await stub.fetch(new Request(newReceiverUrl, { headers: { Upgrade: "websocket" } }))).status).toStrictEqual(
      410,
    )

    const resumed = await connect(stub, "receiver", { peerId })
    sockets.push(resumed.socket)
  })

  it("abandons a checkpointed transfer and releases its slot", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({ senderToken, expiresAt: Date.now() + 60_000, maxTransfers: 1 }),
    })
    const sender = await connect(stub, "sender", { token: senderToken })
    const peerId = "00000000-0000-4000-8000-000000000041"
    const receiver = await connect(stub, "receiver", { peerId })
    sockets.push(sender.socket, receiver.socket)
    sender.socket.send(JSON.stringify({ type: "receiver-paired", peerId }))
    await expect
      .poll(() => sender.messages.some((message) => message.type === "receiver-pair-result" && message.accepted))
      .toStrictEqual(true)
    receiver.socket.send(JSON.stringify({ type: "transfer-checkpoint" }))
    await expect
      .poll(() =>
        receiver.messages.some((message) => message.type === "transfer-checkpoint-result" && message.accepted),
      )
      .toStrictEqual(true)

    receiver.socket.send(JSON.stringify({ type: "transfer-abandon" }))
    await expect
      .poll(() => receiver.messages.some((message) => message.type === "transfer-abandoned"))
      .toStrictEqual(true)
    expect(sender.messages.find((message) => message.type === "peer-left" && message.peerId === peerId)).toMatchObject({
      resumable: false,
    })
    const replacement = await connect(stub, "receiver", {
      peerId: "00000000-0000-4000-8000-000000000042",
    })
    sockets.push(replacement.socket)
  })

  it("updates expiration from the request time through the authenticated HTTP endpoint", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() + 60_000,
        maxTransfers: 1,
      }),
    })

    const beforeUpdate = Date.now()
    const response = await handleP2PUpdate(
      new Request(`https://example.com/p2p/update/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderToken,
          expire: "2h",
          maxTransfers: 4,
        }),
      }),
      env,
    )
    if (!response) throw new Error("P2P update endpoint did not handle the request")
    expect(response.ok).toStrictEqual(true)
    const result: {
      expireAt: string
      expirationSeconds: number
      maxTransfers: number
    } = await response.json()
    expect(result.expirationSeconds).toStrictEqual(2 * 60 * 60)
    expect(result.maxTransfers).toStrictEqual(4)
    expect(new Date(result.expireAt).getTime()).toBeGreaterThanOrEqual(beforeUpdate + 2 * 60 * 60 * 1000)
  })

  it("returns mutable HTTP headers when changing unlimited receivers to one", async () => {
    const name = crypto.randomUUID()
    const senderToken = "sender-token"
    const stub = env.P2P_ROOM.get(env.P2P_ROOM.idFromName(name))
    await stub.fetch("https://p2p-room/init", {
      method: "POST",
      body: JSON.stringify({
        senderToken,
        expiresAt: Date.now() + 60_000,
        maxTransfers: 0,
      }),
    })

    const response = await workerFetch(
      createExecutionContext(),
      new Request(`${env.DEPLOY_URL}/p2p/update/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderToken,
          expire: "1h",
          maxTransfers: 1,
        }),
      }),
    )
    expect(response.status).toStrictEqual(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toStrictEqual("*")
    expect(await response.json()).toMatchObject({ maxTransfers: 1 })
  })
})
