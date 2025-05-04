import { dateToUnix, workerAssert, WorkerError } from "../common.js"
import { parseSize } from "../../shared/parsers.js"
import { PasteLocation } from "../../shared/interfaces.js"

// since CF does not allow expiration shorter than 60s, extend the expiration to 70s
const PASTE_EXPIRE_SPECIFIED_MIN = 70

/* Since we need the metadata stored in KV to perform R2 cleanup,
 the paste in KV should not be deleted until it is cleaned in R2.
 We extend the lifetime by 2 days to avoid it being cleaned in VK too early
 */
const PASTE_EXPIRE_EXTENSION_FOR_R2 = 2 * 24 * 60 * 60

// TODO: allow admin to upload permanent paste
// TODO: add filename length check
export type PasteMetadata = {
  schemaVersion: 1
  location: PasteLocation // new field on V1
  passwd: string

  lastModifiedAtUnix: number
  createdAtUnix: number
  willExpireAtUnix: number

  accessCounter: number // a counter representing how frequent it is accessed, to administration usage
  sizeBytes: number
  filename?: string
  highlightLanguage?: string
  encryptionScheme?: string
}

type PasteMetadataInStorage = {
  schemaVersion: number
  location?: PasteLocation
  passwd: string

  lastModifiedAtUnix: number
  createdAtUnix: number
  willExpireAtUnix: number

  accessCounter?: number
  sizeBytes?: number
  filename?: string
  highlightLanguage?: string
  encryptionScheme?: string
}

function migratePasteMetadata(original: PasteMetadataInStorage): PasteMetadata {
  return {
    schemaVersion: 1,
    location: original.location || "KV",
    passwd: original.passwd,

    lastModifiedAtUnix: original.lastModifiedAtUnix,
    createdAtUnix: original.createdAtUnix,
    willExpireAtUnix: original.willExpireAtUnix,

    accessCounter: original.accessCounter || 0,
    sizeBytes: original.sizeBytes || 0,
    filename: original.filename,
    highlightLanguage: original.highlightLanguage,
    encryptionScheme: original.encryptionScheme,
  }
}

export type PasteWithMetadata = {
  paste: ArrayBuffer | ReadableStream
  metadata: PasteMetadata
}

async function updateAccessCounter(env: Env, short: string, value: ArrayBuffer, metadata: PasteMetadata) {
  // update counter with probability 1%
  if (Math.random() < 0.01) {
    metadata.accessCounter += 1
    try {
      await env.PB.put(short, value, {
        metadata: metadata,
        expiration: metadata.willExpireAtUnix,
      })
    } catch (e) {
      // ignore rate limit message
      if (!(e as Error).message.includes("KV PUT failed: 429 Too Many Requests")) {
        throw e
      }
    }
  }
}

export async function getPaste(env: Env, short: string, ctx: ExecutionContext): Promise<PasteWithMetadata | null> {
  const item = await env.PB.getWithMetadata<PasteMetadataInStorage>(short, {
    type: "arrayBuffer",
  })

  if (item.value === null) {
    return null
  } else {
    workerAssert(item.metadata != null, `paste of name '${short}' has no metadata`)
    const metadata = migratePasteMetadata(item.metadata)
    const expired = metadata.willExpireAtUnix < new Date().getTime() / 1000

    ctx.waitUntil(
      (async () => {
        if (expired) {
          await deletePaste(env, short, metadata)
          return null
        }
        await updateAccessCounter(env, short, item.value!, metadata)
      })(),
    )

    if (expired) {
      return null
    }

    if (metadata.location === "R2") {
      const object = await env.R2.get(short)
      if (object === null) {
        return null
      }
      // TODO: how Content-Length handled?
      return { paste: object.body, metadata }
    } else {
      return { paste: item.value, metadata }
    }
  }
}

// we separate usage of getPasteMetadata and getPaste to make access metric more reliable
export async function getPasteMetadata(env: Env, short: string): Promise<PasteMetadata | null> {
  const item = await env.PB.getWithMetadata<PasteMetadataInStorage>(short, {
    type: "stream",
  })

  if (item.value === null) {
    return null
  } else if (item.metadata === null) {
    throw new WorkerError(500, `paste of name '${short}' has no metadata`)
  } else {
    if (item.metadata.willExpireAtUnix < new Date().getTime() / 1000) {
      return null
    }
    return migratePasteMetadata(item.metadata)
  }
}

interface WriteOptions {
  now: Date
  contentLength: number
  expirationSeconds: number
  passwd: string
  filename?: string
  highlightLanguage?: string
  encryptionScheme?: string
  isMPUComplete: boolean
}

export async function updatePaste(
  env: Env,
  pasteName: string,
  content: ArrayBuffer | ReadableStream,
  originalMetadata: PasteMetadata,
  options: WriteOptions,
) {
  const expirationUnix = dateToUnix(options.now) + options.expirationSeconds
  let expirationUnixSpecified =
    dateToUnix(options.now) + Math.max(options.expirationSeconds, PASTE_EXPIRE_SPECIFIED_MIN)

  if (originalMetadata.location === "R2") {
    expirationUnixSpecified = expirationUnixSpecified + PASTE_EXPIRE_EXTENSION_FOR_R2

    if (!options.isMPUComplete) {
      await env.R2.put(pasteName, content)
    }
  }

  // if the paste is previous on R2, we keep it on R2 to avoid losing reference to it
  const newLocation =
    originalMetadata.location === "R2" || options.isMPUComplete || options.contentLength > parseSize(env.R2_THRESHOLD)!
      ? "R2"
      : "KV"
  const metadata: PasteMetadata = {
    schemaVersion: 1,
    location: newLocation,
    filename: options.filename,
    highlightLanguage: options.highlightLanguage,
    passwd: options.passwd,

    lastModifiedAtUnix: dateToUnix(options.now),
    createdAtUnix: originalMetadata.createdAtUnix,
    willExpireAtUnix: expirationUnix,
    accessCounter: originalMetadata.accessCounter,
    sizeBytes: options.contentLength,
    encryptionScheme: options.encryptionScheme,
  }

  await env.PB.put(pasteName, originalMetadata.location === "R2" ? "" : content, {
    metadata: metadata,
    expiration: expirationUnixSpecified,
  })
}

export async function createPaste(
  env: Env,
  pasteName: string,
  content: ArrayBuffer | ReadableStream,
  options: WriteOptions,
) {
  const expirationUnix = dateToUnix(options.now) + options.expirationSeconds

  let expirationUnixSpecified =
    dateToUnix(options.now) + Math.max(options.expirationSeconds, PASTE_EXPIRE_SPECIFIED_MIN)

  const location = options.isMPUComplete || options.contentLength > parseSize(env.R2_THRESHOLD)! ? "R2" : "KV"
  if (location === "R2") {
    expirationUnixSpecified = expirationUnixSpecified + PASTE_EXPIRE_EXTENSION_FOR_R2

    if (!options.isMPUComplete) {
      await env.R2.put(pasteName, content)
    }
  }

  const metadata: PasteMetadata = {
    schemaVersion: 1,
    location: location,
    filename: options.filename,
    highlightLanguage: options.highlightLanguage,
    passwd: options.passwd,

    lastModifiedAtUnix: dateToUnix(options.now),
    createdAtUnix: dateToUnix(options.now),
    willExpireAtUnix: expirationUnix,
    accessCounter: 0,
    sizeBytes: options.contentLength,
    encryptionScheme: options.encryptionScheme,
  }

  await env.PB.put(pasteName, location === "R2" ? "" : content, {
    metadata: metadata,
    expiration: expirationUnixSpecified,
  })
}

export async function pasteNameAvailable(env: Env, pasteName: string): Promise<boolean> {
  const item = await env.PB.getWithMetadata<PasteMetadata>(pasteName)
  if (item.value == null) {
    return true
  } else if (item.metadata === null) {
    throw new WorkerError(500, `paste of name '${pasteName}' has no metadata`)
  } else {
    return item.metadata.willExpireAtUnix < new Date().getTime() / 1000
  }
}

export async function deletePaste(env: Env, pasteName: string, originalMetadata: PasteMetadata): Promise<void> {
  await env.PB.delete(pasteName)
  if (originalMetadata.location === "R2") {
    await env.R2.delete(pasteName)
  }
}

export async function cleanExpiredInR2(env: Env, controller: ScheduledController) {
  // types generated by wrangler somehow not working, so cast manually
  type Listed = {
    list_complete: false
    keys: KVNamespaceListKey<PasteMetadataInStorage, string>[]
    cursor: string
    cacheStatus: string | null
  }

  const nowUnix = controller.scheduledTime / 1000

  let numCleaned = 0
  const r2NamesToClean: string[] = []

  async function clean() {
    await env.R2.delete(r2NamesToClean)
    numCleaned += r2NamesToClean.length
    r2NamesToClean.length = 0
  }

  let cursor: string | null = null
  while (true) {
    const listed = (await env.PB.list<PasteMetadataInStorage>({ cursor })) as Listed

    cursor = listed.cursor

    for (const key of listed.keys) {
      if (key.metadata !== undefined) {
        const metadata = migratePasteMetadata(key.metadata)
        if (metadata.location === "R2" && metadata.willExpireAtUnix < nowUnix) {
          r2NamesToClean.push(key.name)

          if (r2NamesToClean.length === 1000) {
            await clean()
          }
        }
      }
    }

    if (listed.list_complete) break
  }
  await clean()

  console.log(`${numCleaned} buckets cleaned`)
}
