export interface WebLockLease {
  release(): void
}

export function acquireExclusiveWebLock(name: string): Promise<WebLockLease | null> | undefined {
  if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") return undefined
  return new Promise((resolve) => {
    void navigator.locks
      .request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null)
          return
        }
        await new Promise<void>((release) => resolve({ release }))
      })
      .catch(() => resolve(null))
  })
}
