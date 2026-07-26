import type { P2PIceServer } from "../../../shared/interfaces.js"
import type { P2PConnectionRoute } from "./protocol.js"

const defaultIceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }]

export function rtcConfig(iceServers: P2PIceServer[] | undefined): RTCConfiguration {
  return { iceServers: iceServers?.length ? iceServers : defaultIceServers }
}

interface P2PTransportStats extends RTCStats {
  selectedCandidatePairId?: string
}

interface P2PCandidatePairStats extends RTCStats {
  localCandidateId?: string
  remoteCandidateId?: string
  nominated?: boolean
  selected?: boolean
  state?: string
}

interface P2PCandidateStats extends RTCStats {
  candidateType?: RTCIceCandidateType
}

export async function selectedP2PConnectionRoute(
  connection: RTCPeerConnection,
): Promise<P2PConnectionRoute | undefined> {
  if (typeof connection.getStats !== "function") return undefined

  const stats = await connection.getStats()
  let selectedPair: P2PCandidatePairStats | undefined
  let nominatedPair: P2PCandidatePairStats | undefined

  for (const rawReport of stats.values()) {
    const report = rawReport as RTCStats
    if (report.type === "transport") {
      const pairId = (report as P2PTransportStats).selectedCandidatePairId
      if (pairId) selectedPair = stats.get(pairId) as P2PCandidatePairStats | undefined
    }
    if (report.type === "candidate-pair") {
      const pair = report as P2PCandidatePairStats
      if (pair.selected) selectedPair = pair
      else if (pair.nominated && pair.state === "succeeded") nominatedPair = pair
    }
  }

  const pair = selectedPair ?? nominatedPair
  if (!pair?.localCandidateId || !pair.remoteCandidateId) return undefined
  const local = stats.get(pair.localCandidateId) as P2PCandidateStats | undefined
  const remote = stats.get(pair.remoteCandidateId) as P2PCandidateStats | undefined
  if (!local?.candidateType || !remote?.candidateType) return undefined

  return local.candidateType === "relay" || remote.candidateType === "relay" ? "relay" : "direct"
}

export class P2PIceCandidateBuffer {
  private readonly pending: RTCIceCandidateInit[] = []

  add(candidate: RTCIceCandidateInit): void {
    this.pending.push(candidate)
  }

  async addOrBuffer(
    connection: RTCPeerConnection,
    candidate: RTCIceCandidateInit,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) return
    if (!connection.remoteDescription) {
      this.add(candidate)
      return
    }
    await connection.addIceCandidate(candidate)
  }

  async flush(connection: RTCPeerConnection, isCurrent: () => boolean = () => true): Promise<void> {
    if (!connection.remoteDescription) return
    while (isCurrent() && this.pending.length > 0) {
      const candidate = this.pending.shift()
      if (candidate) await connection.addIceCandidate(candidate)
    }
  }

  clear(): void {
    this.pending.length = 0
  }
}

export function closeP2PConnection(connection: RTCPeerConnection | undefined, channel?: RTCDataChannel): void {
  if (channel) {
    channel.onopen = null
    channel.onmessage = null
    channel.onclose = null
    channel.onerror = null
    channel.close()
  }
  if (connection) {
    connection.onicecandidate = null
    connection.oniceconnectionstatechange = null
    connection.onconnectionstatechange = null
    connection.ondatachannel = null
    connection.close()
  }
}
