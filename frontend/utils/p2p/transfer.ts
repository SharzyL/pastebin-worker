import { maxP2PControlMessageLength, type DataMessage } from "./protocol.js"

export const chunkSize = 64 * 1024
export const progressUpdateIntervalMs = 500
const maxQueuedBytes = 1024 * 1024
const resumeQueuedBytes = 512 * 1024
const defaultP2PControlMessageLength = 256 * 1024

export interface SpeedTracker {
  lastMeasuredAt: number
  lastMeasuredBytes: number
  bytesPerSecond: number
}

export function sendData(channel: RTCDataChannel, message: DataMessage): void {
  if (channel.readyState === "open") channel.send(JSON.stringify(message))
}

export function p2pControlMessageLengthLimit(maxMessageSize: number | undefined): number {
  if (maxMessageSize === 0) return maxP2PControlMessageLength
  if (typeof maxMessageSize === "number" && Number.isFinite(maxMessageSize) && maxMessageSize > 0) {
    return Math.min(maxP2PControlMessageLength, Math.floor(maxMessageSize))
  }
  return Math.min(maxP2PControlMessageLength, defaultP2PControlMessageLength)
}

export function createSpeedTracker(doneBytes: number): SpeedTracker {
  return {
    lastMeasuredAt: performance.now(),
    lastMeasuredBytes: doneBytes,
    bytesPerSecond: 0,
  }
}

export function measureSpeed(tracker: SpeedTracker, doneBytes: number, force = false): number {
  const now = performance.now()
  const elapsedMs = now - tracker.lastMeasuredAt
  if (force || elapsedMs >= progressUpdateIntervalMs) {
    tracker.bytesPerSecond = elapsedMs > 0 ? ((doneBytes - tracker.lastMeasuredBytes) * 1000) / elapsedMs : 0
    tracker.lastMeasuredAt = now
    tracker.lastMeasuredBytes = doneBytes
  }
  return tracker.bytesPerSecond
}

export function waitForBufferedAmount(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState !== "open" || channel.bufferedAmount < maxQueuedBytes) return Promise.resolve()
  return new Promise((resolve) => {
    let isResolved = false
    const finish = () => {
      if (isResolved) return
      isResolved = true
      channel.removeEventListener("bufferedamountlow", finish)
      channel.removeEventListener("close", finish)
      channel.removeEventListener("error", finish)
      resolve()
    }

    channel.bufferedAmountLowThreshold = resumeQueuedBytes
    channel.addEventListener("bufferedamountlow", finish)
    channel.addEventListener("close", finish)
    channel.addEventListener("error", finish)
  })
}

let yieldChannel: MessageChannel | undefined
const yieldWaiters: (() => void)[] = []

export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0))

  yieldChannel ??= new MessageChannel()
  yieldChannel.port1.onmessage ??= () => {
    const resolve = yieldWaiters.shift()
    resolve?.()
  }
  return new Promise((resolve) => {
    yieldWaiters.push(resolve)
    yieldChannel!.port2.postMessage(undefined)
  })
}

interface StreamBlobToDataChannelOptions {
  blob: Blob
  channel: RTCDataChannel
  chunkSize: number
  shouldContinue: () => boolean
  onReaderChange?: (reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>, active: boolean) => void
  onChunkSent?: (chunk: Uint8Array<ArrayBuffer>) => void | Promise<void>
  yieldIntervalMs?: number
}

export async function streamBlobToDataChannel({
  blob,
  channel,
  chunkSize,
  shouldContinue,
  onReaderChange,
  onChunkSent,
  yieldIntervalMs = 8,
}: StreamBlobToDataChannelOptions): Promise<boolean> {
  const reader = blob.stream().getReader()
  onReaderChange?.(reader, true)
  let lastYieldAt = performance.now()

  try {
    while (shouldContinue() && channel.readyState === "open") {
      const { done, value } = await reader.read()
      if (!shouldContinue()) return false
      if (done) return true

      for (let offset = 0; offset < value.byteLength; offset += chunkSize) {
        if (!shouldContinue() || channel.readyState !== "open") return false
        const chunk = value.subarray(offset, offset + chunkSize)
        await waitForBufferedAmount(channel)
        if (!shouldContinue() || channel.readyState !== "open") return false
        channel.send(chunk)
        await onChunkSent?.(chunk)

        if (performance.now() - lastYieldAt >= yieldIntervalMs) {
          await yieldToEventLoop()
          lastYieldAt = performance.now()
          if (!shouldContinue() || channel.readyState !== "open") return false
        }
      }
    }
    return false
  } finally {
    onReaderChange?.(reader, false)
    try {
      reader.releaseLock()
    } catch {
      // A cancelled read may still own the lock until its promise settles.
    }
  }
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
