interface WakeLockSentinelLike extends EventTarget {
  released: boolean
  release: () => Promise<void>
}

interface WakeLockProviderLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>
}

export class P2PWakeLock {
  private sentinel?: WakeLockSentinelLike
  private acquisition?: { generation: number; promise: Promise<void> }
  private isActive = false
  private didWarn = false
  private generation = 0

  constructor(private readonly onWarning: (message: string) => void) {}

  async start(): Promise<void> {
    if (!this.isActive) {
      this.isActive = true
      this.generation += 1
      document.addEventListener("visibilitychange", this.onVisibilityChange)
    }
    await this.acquire()
  }

  async stop(): Promise<void> {
    this.isActive = false
    this.generation += 1
    document.removeEventListener("visibilitychange", this.onVisibilityChange)
    const sentinel = this.sentinel
    this.sentinel = undefined
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined)

    const pending = this.acquisition?.promise
    if (pending) await pending
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === "visible") void this.acquire()
  }

  private async acquire(): Promise<void> {
    if (!this.isActive || document.visibilityState !== "visible" || (this.sentinel && !this.sentinel.released)) return

    const generation = this.generation
    if (this.acquisition?.generation === generation) return await this.acquisition.promise

    const wakeLock = (navigator as unknown as { wakeLock?: WakeLockProviderLike }).wakeLock
    if (!wakeLock) {
      this.warn()
      return
    }

    const promise = (async () => {
      try {
        const sentinel = await wakeLock.request("screen")
        if (
          !this.isActive ||
          generation !== this.generation ||
          document.visibilityState !== "visible" ||
          (this.sentinel && !this.sentinel.released)
        ) {
          if (!sentinel.released) await sentinel.release().catch(() => undefined)
          return
        }

        this.sentinel = sentinel
        sentinel.addEventListener(
          "release",
          () => {
            if (this.sentinel === sentinel) this.sentinel = undefined
            if (this.isActive && document.visibilityState === "visible") void this.acquire()
          },
          { once: true },
        )
      } catch {
        if (this.isActive && generation === this.generation) this.warn()
      }
    })()
    this.acquisition = { generation, promise }
    try {
      await promise
    } finally {
      if (this.acquisition?.promise === promise) this.acquisition = undefined
    }
  }

  private warn(): void {
    if (this.didWarn) return
    this.didWarn = true
    this.onWarning("Keep this tab visible and keep the screen unlocked during P2P transfer.")
  }
}
