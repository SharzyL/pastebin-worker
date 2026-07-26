import { jsonResponse } from "./common.js"

const READ_STATE_KEY = "readState"

interface PasteReadState {
  version: string
  remainingReads: number | null
  expiresAt: number
  cleanupAt: number
}

export interface PasteReadStateSeed {
  version: string
  remainingReads: number | null
  expiresAt: number
  cleanupAt?: number
}

export interface PasteReadConsumption {
  allowed: boolean
  remainingBefore: number
  remainingAfter: number
}

export interface PasteReadSnapshot {
  available: boolean
  remainingReads: number
}

function counterStub(env: { PASTE_READ_COUNTER: DurableObjectNamespace }, pasteName: string): DurableObjectStub {
  return env.PASTE_READ_COUNTER.get(env.PASTE_READ_COUNTER.idFromName(pasteName))
}

function normalizeSeed(value: unknown): PasteReadState | null {
  if (typeof value !== "object" || value === null) return null
  const seed = value as PasteReadStateSeed
  const cleanupAt = seed.cleanupAt ?? seed.expiresAt
  if (
    typeof seed.version !== "string" ||
    seed.version.length === 0 ||
    (seed.remainingReads !== null &&
      (typeof seed.remainingReads !== "number" ||
        !Number.isSafeInteger(seed.remainingReads) ||
        seed.remainingReads < 0)) ||
    typeof seed.expiresAt !== "number" ||
    !Number.isFinite(seed.expiresAt) ||
    typeof cleanupAt !== "number" ||
    !Number.isFinite(cleanupAt)
  ) {
    return null
  }
  return {
    version: seed.version,
    remainingReads: seed.remainingReads,
    expiresAt: seed.expiresAt,
    cleanupAt: Math.max(seed.expiresAt, cleanupAt),
  }
}

async function postCounter<T>(env: Env, pasteName: string, path: string, seed: PasteReadStateSeed): Promise<T> {
  const response = await counterStub(env, pasteName).fetch(`https://paste-read-counter${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seed),
  })
  if (!response.ok) {
    throw new Error(`Paste read counter ${path} failed: ${response.status} ${await response.text()}`)
  }
  return await response.json<T>()
}

export async function initializePasteReadState(env: Env, pasteName: string, seed: PasteReadStateSeed): Promise<void> {
  await postCounter<{ ok: true }>(env, pasteName, "/init", seed)
}

export async function consumePasteReadState(
  env: Env,
  pasteName: string,
  seed: PasteReadStateSeed,
): Promise<PasteReadConsumption> {
  return await postCounter<PasteReadConsumption>(env, pasteName, "/consume", seed)
}

export async function getPasteReadState(
  env: Env,
  pasteName: string,
  seed: PasteReadStateSeed,
): Promise<PasteReadSnapshot> {
  return await postCounter<PasteReadSnapshot>(env, pasteName, "/peek", seed)
}

export class PasteReadCounter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } })
    }

    const seed = normalizeSeed(await request.json().catch(() => null))
    if (seed === null) return new Response("invalid read state", { status: 400 })

    const path = new URL(request.url).pathname
    if (path === "/init") {
      const cleanupAt = await this.state.storage.transaction(async (transaction) => {
        const stored = await transaction.get<PasteReadState>(READ_STATE_KEY)
        const next = this.mergeInit(stored, seed)
        if (stored === undefined || JSON.stringify(stored) !== JSON.stringify(next)) {
          await transaction.put(READ_STATE_KEY, next)
        }
        return next.cleanupAt
      })
      await this.scheduleCleanup(cleanupAt)
      return jsonResponse({ ok: true })
    }

    if (path === "/consume") {
      const result = await this.state.storage.transaction(async (transaction) => {
        const existing = await transaction.get<PasteReadState>(READ_STATE_KEY)
        const stored = this.reconcileRemainingReads(existing ?? seed, seed)
        if (stored.version !== seed.version || stored.remainingReads === null || Date.now() >= stored.expiresAt) {
          return { response: { allowed: false, remainingBefore: 0, remainingAfter: 0 }, cleanupAt: stored.cleanupAt }
        }
        if (stored.remainingReads <= 0) {
          return { response: { allowed: false, remainingBefore: 0, remainingAfter: 0 }, cleanupAt: stored.cleanupAt }
        }

        const remainingAfter = stored.remainingReads - 1
        await transaction.put(READ_STATE_KEY, { ...stored, remainingReads: remainingAfter })
        return {
          response: {
            allowed: true,
            remainingBefore: stored.remainingReads,
            remainingAfter,
          },
          cleanupAt: stored.cleanupAt,
        }
      })
      await this.scheduleCleanup(result.cleanupAt)
      return jsonResponse(result.response)
    }

    if (path === "/peek") {
      const result = await this.state.storage.transaction(async (transaction) => {
        const existing = await transaction.get<PasteReadState>(READ_STATE_KEY)
        const stored = this.reconcileRemainingReads(existing ?? seed, seed)
        if (stored.version !== seed.version || stored.remainingReads === null || Date.now() >= stored.expiresAt) {
          return { response: { available: false, remainingReads: 0 }, cleanupAt: stored.cleanupAt }
        }
        if (existing?.remainingReads !== stored.remainingReads) {
          await transaction.put(READ_STATE_KEY, stored)
        }
        return {
          response: { available: stored.remainingReads > 0, remainingReads: stored.remainingReads },
          cleanupAt: stored.cleanupAt,
        }
      })
      await this.scheduleCleanup(result.cleanupAt)
      return jsonResponse(result.response)
    }

    return new Response("not found", { status: 404 })
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll()
    await this.state.storage.deleteAlarm()
  }

  private async scheduleCleanup(cleanupAt: number): Promise<void> {
    const alarmAt = Math.max(cleanupAt, Date.now() + 1000)
    const currentAlarm = await this.state.storage.getAlarm()
    if (currentAlarm === null || currentAlarm < alarmAt) {
      await this.state.storage.setAlarm(alarmAt)
    }
  }

  private mergeInit(stored: PasteReadState | undefined, seed: PasteReadState): PasteReadState {
    if (stored?.version !== seed.version) return seed
    const merged = {
      ...stored,
      expiresAt: seed.expiresAt,
      cleanupAt: Math.max(stored.cleanupAt, seed.cleanupAt),
    }
    return this.reconcileRemainingReads(merged, seed)
  }

  private reconcileRemainingReads(stored: PasteReadState, seed: PasteReadState): PasteReadState {
    if (
      stored.version !== seed.version ||
      stored.remainingReads === null ||
      seed.remainingReads === null ||
      seed.remainingReads >= stored.remainingReads
    ) {
      return stored
    }
    return { ...stored, remainingReads: seed.remainingReads }
  }
}
