import { dateToUnix, genRandStr, workerAssert, WorkerError } from "../common.js"
import { parseSize } from "../../shared/parsers.js"
import type { MetaResponse, OriginalFileInfo, PasteLocation } from "../../shared/interfaces.js"
import { mapWithConcurrency } from "../../shared/async.js"
import {
  consumePasteReadState,
  getPasteReadState,
  initializePasteReadState,
  type PasteReadConsumption,
  type PasteReadStateSeed,
} from "../readCounter.js"

// since CF does not allow expiration shorter than 60s, extend the expiration to 70s
const PASTE_EXPIRE_SPECIFIED_MIN = 70
const R2_CLEANUP_KV_LOOKUP_CONCURRENCY = 32
const KV_METADATA_MAX_BYTES = 1024

// TODO: allow admin to upload permanent paste
// TODO: add filename length check
export interface PasteMetadata {
  schemaVersion: 1
  location: PasteLocation // new field on V1
  passwd: string

  lastModifiedAtUnix: number
  createdAtUnix: number
  willExpireAtUnix: number

  accessCounter: number // a counter representing how frequent it is accessed, to administration usage
  remainingReads?: number
  readStateVersion?: string
  sizeBytes: number
  filename?: string
  filenames?: OriginalFileInfo[]
  mimeType?: string
  highlightLanguage?: string
  encryptionScheme?: string
}

interface PasteMetadataInStorage {
  schemaVersion: number
  location?: PasteLocation
  passwd: string

  lastModifiedAtUnix: number
  createdAtUnix: number
  willExpireAtUnix: number

  accessCounter?: number
  remainingReads?: number
  readStateVersion?: string
  sizeBytes?: number
  filename?: string
  filenames?: OriginalFileInfo[]
  mimeType?: string
  highlightLanguage?: string
  encryptionScheme?: string
  extendedMetadataInValue?: true
}

type ExtendedPasteMetadata = Pick<
  PasteMetadata,
  "filename" | "filenames" | "mimeType" | "highlightLanguage" | "encryptionScheme"
>

export function metaResponseFromMetadata(metadata: PasteMetadata): MetaResponse {
  return {
    lastModifiedAt: new Date(metadata.lastModifiedAtUnix * 1000).toISOString(),
    createdAt: new Date(metadata.createdAtUnix * 1000).toISOString(),
    expireAt: new Date(metadata.willExpireAtUnix * 1000).toISOString(),
    sizeBytes: metadata.sizeBytes,
    location: metadata.location,
    remainingReads: metadata.remainingReads,
    filename: metadata.filename,
    filenames: metadata.filenames,
    mimeType: metadata.mimeType,
    highlightLanguage: metadata.highlightLanguage,
    encryptionScheme: metadata.encryptionScheme,
  }
}

function migratePasteMetadata(
  original: PasteMetadataInStorage,
  extended: Partial<ExtendedPasteMetadata> = {},
): PasteMetadata {
  return {
    schemaVersion: 1,
    location: original.location || "KV",
    passwd: original.passwd,

    lastModifiedAtUnix: original.lastModifiedAtUnix,
    createdAtUnix: original.createdAtUnix,
    willExpireAtUnix: original.willExpireAtUnix,

    accessCounter: original.accessCounter || 0,
    remainingReads: original.remainingReads,
    readStateVersion: original.readStateVersion,
    sizeBytes: original.sizeBytes || 0,
    filename: extended.filename ?? original.filename,
    filenames: extended.filenames ?? original.filenames,
    mimeType: extended.mimeType ?? original.mimeType,
    highlightLanguage: extended.highlightLanguage ?? original.highlightLanguage,
    encryptionScheme: extended.encryptionScheme ?? original.encryptionScheme,
  }
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function metadataFitsInKv(metadata: PasteMetadata): boolean {
  // Reserve enough room for the access counter to grow without making a later
  // best-effort counter update cross KV's metadata limit.
  return serializedByteLength({ ...metadata, accessCounter: Number.MAX_SAFE_INTEGER }) <= KV_METADATA_MAX_BYTES
}

function extendedMetadata(metadata: PasteMetadata): ExtendedPasteMetadata {
  return {
    filename: metadata.filename,
    filenames: metadata.filenames,
    mimeType: metadata.mimeType,
    highlightLanguage: metadata.highlightLanguage,
    encryptionScheme: metadata.encryptionScheme,
  }
}

function compactR2Metadata(metadata: PasteMetadata): PasteMetadataInStorage {
  const {
    filename: _filename,
    filenames: _filenames,
    mimeType: _mimeType,
    highlightLanguage: _highlightLanguage,
    encryptionScheme: _encryptionScheme,
    ...compact
  } = metadata
  const stored: PasteMetadataInStorage = { ...compact, extendedMetadataInValue: true }
  workerAssert(
    serializedByteLength(stored) <= KV_METADATA_MAX_BYTES,
    "internal paste metadata exceeds the Workers KV metadata limit",
  )
  return stored
}

async function metadataFromStorage(original: PasteMetadataInStorage, value: ReadableStream): Promise<PasteMetadata> {
  if (!original.extendedMetadataInValue) return migratePasteMetadata(original)
  if ((original.location ?? "KV") !== "R2") {
    throw new WorkerError(500, "invalid paste metadata storage layout")
  }

  let extended: Partial<ExtendedPasteMetadata>
  try {
    const parsed: unknown = await new Response(value).json()
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("extended metadata is not an object")
    }
    extended = parsed
  } catch (error) {
    console.warn("Failed to parse extended paste metadata:", error instanceof Error ? error.message : error)
    throw new WorkerError(500, "invalid extended paste metadata")
  }
  return migratePasteMetadata(original, extended)
}

async function putPasteIndex(
  env: Env,
  pasteName: string,
  kvContent: ArrayBuffer | ReadableStream,
  metadata: PasteMetadata,
  expiration: number,
): Promise<void> {
  if (metadataFitsInKv(metadata)) {
    await env.PB.put(pasteName, metadata.location === "R2" ? "" : kvContent, { metadata, expiration })
    return
  }

  if (metadata.location === "R2") {
    await env.PB.put(pasteName, JSON.stringify(extendedMetadata(metadata)), {
      metadata: compactR2Metadata(metadata),
      expiration,
    })
    return
  }

  workerAssert(false, "inline paste metadata exceeds the Workers KV metadata limit")
}

export interface PasteRecord {
  metadata: PasteMetadata
  kvBody: ReadableStream | null
}

export interface PasteBody {
  paste: ReadableStream
  httpEtag?: string
}

export interface PasteBodyRange {
  offset: number
  length: number
}

async function cancelUnusedStream(stream: ReadableStream): Promise<void> {
  try {
    await stream.cancel()
  } catch {
    // The stream may already be closed or cancelled by the runtime.
  }
}

export async function discardPasteRecord(record: PasteRecord): Promise<void> {
  const stream = record.kvBody
  record.kvBody = null
  if (stream) await cancelUnusedStream(stream)
}

async function updateAccessCounter(
  env: Env,
  short: string,
  value: ArrayBuffer | ReadableStream,
  metadata: PasteMetadata,
) {
  try {
    await putPasteIndex(
      env,
      short,
      value,
      { ...metadata, accessCounter: metadata.accessCounter + 1 },
      metadata.willExpireAtUnix,
    )
  } catch (e) {
    // ignore rate limit message
    if (!(e as Error).message.includes("KV PUT failed: 429 Too Many Requests")) {
      throw e
    }
  }
}

export async function getPasteRecord(env: Env, short: string, ctx: ExecutionContext): Promise<PasteRecord | null> {
  const item = await env.PB.getWithMetadata<PasteMetadataInStorage>(short, {
    type: "stream",
  })

  if (item.value === null) {
    return null
  }

  if (item.metadata === null) {
    await cancelUnusedStream(item.value)
    throw new WorkerError(500, `paste of name '${short}' has no metadata`)
  }
  const metadata = await metadataFromStorage(item.metadata, item.value)
  if (metadata.willExpireAtUnix < Date.now() / 1000) {
    await cancelUnusedStream(item.value)
    ctx.waitUntil(deletePaste(env, short, metadata))
    return null
  }

  if (metadata.location === "R2" && !item.metadata.extendedMetadataInValue) await cancelUnusedStream(item.value)

  return {
    metadata,
    kvBody: metadata.location === "KV" ? item.value : null,
  }
}

export async function openPasteBody(
  env: Env,
  short: string,
  record: PasteRecord,
  ctx: ExecutionContext,
  range?: PasteBodyRange,
): Promise<PasteBody | null> {
  if (record.metadata.location === "R2") {
    const object = await env.R2.get(short, range ? { range } : undefined)
    if (object === null) return null
    if (!hasReadLimit(record.metadata) && Math.random() < 0.01) {
      ctx.waitUntil(updateAccessCounter(env, short, new ArrayBuffer(0), record.metadata))
    }
    return { paste: object.body, httpEtag: object.httpEtag }
  }

  workerAssert(record.kvBody !== null, `KV body of paste '${short}' has already been opened`)
  let paste = record.kvBody
  record.kvBody = null
  if (!hasReadLimit(record.metadata) && Math.random() < 0.01) {
    const [responseBody, counterBody] = paste.tee()
    paste = responseBody
    ctx.waitUntil(updateAccessCounter(env, short, counterBody, record.metadata))
  }
  return { paste }
}

// Metadata-only callers intentionally do not update the access metric.
export async function getPasteMetadata(env: Env, short: string): Promise<PasteMetadata | null> {
  const item = await env.PB.getWithMetadata<PasteMetadataInStorage>(short, {
    type: "stream",
  })

  if (item.value === null) {
    return null
  }
  try {
    if (item.metadata === null) {
      throw new WorkerError(500, `paste of name '${short}' has no metadata`)
    }
    if (item.metadata.willExpireAtUnix < new Date().getTime() / 1000) {
      return null
    }
    return await metadataFromStorage(item.metadata, item.value)
  } finally {
    await cancelUnusedStream(item.value)
  }
}

interface WriteOptions {
  now: Date
  contentLength: number
  expirationSeconds: number
  passwd: string
  filename?: string
  filenames?: OriginalFileInfo[]
  mimeType?: string
  highlightLanguage?: string
  encryptionScheme?: string
  remainingReads?: number
  isMPUComplete: boolean
}

export function hasReadLimit(metadata: PasteMetadata): boolean {
  return metadata.remainingReads !== undefined
}

function readStateVersion(metadata: PasteMetadata): string {
  return metadata.readStateVersion ?? `legacy:${metadata.createdAtUnix}:${metadata.lastModifiedAtUnix}`
}

function readStateSeed(metadata: PasteMetadata): PasteReadStateSeed {
  workerAssert(metadata.remainingReads !== undefined, "cannot create a read state seed without a read limit")
  return {
    version: readStateVersion(metadata),
    remainingReads: metadata.remainingReads,
    expiresAt: metadata.willExpireAtUnix * 1000,
  }
}

export async function consumeRead(env: Env, pasteName: string, metadata: PasteMetadata): Promise<PasteReadConsumption> {
  return await consumePasteReadState(env, pasteName, readStateSeed(metadata))
}

export async function getRemainingReads(env: Env, pasteName: string, metadata: PasteMetadata): Promise<number | null> {
  const snapshot = await getPasteReadState(env, pasteName, readStateSeed(metadata))
  return snapshot.available ? snapshot.remainingReads : null
}

interface PasteMetadataSeed {
  location: PasteLocation
  createdAtUnix: number
  accessCounter: number
  readStateVersion?: string
}

function choosePasteLocation(env: Env, options: WriteOptions, currentLocation?: PasteLocation): PasteLocation {
  return currentLocation === "R2" || options.isMPUComplete || options.contentLength > parseSize(env.R2_THRESHOLD)!
    ? "R2"
    : "KV"
}

function buildPasteMetadata(options: WriteOptions, seed: PasteMetadataSeed): PasteMetadata {
  const nowUnix = dateToUnix(options.now)
  const metadata: PasteMetadata = {
    schemaVersion: 1,
    location: seed.location,
    filename: options.filename,
    filenames: options.filenames,
    mimeType: options.mimeType,
    highlightLanguage: options.highlightLanguage,
    passwd: options.passwd,
    lastModifiedAtUnix: nowUnix,
    createdAtUnix: seed.createdAtUnix,
    willExpireAtUnix: nowUnix + options.expirationSeconds,
    accessCounter: seed.accessCounter,
    remainingReads: options.remainingReads,
    readStateVersion: seed.readStateVersion,
    sizeBytes: options.contentLength,
    encryptionScheme: options.encryptionScheme,
  }

  // KV metadata is capped at 1024 serialized bytes. Moving an oversized
  // inline paste to R2 lets the index keep only the compact metadata.
  return metadata.location === "KV" && !metadataFitsInKv(metadata) ? { ...metadata, location: "R2" } : metadata
}

async function persistPaste(
  env: Env,
  pasteName: string,
  content: ArrayBuffer | ReadableStream,
  metadata: PasteMetadata,
  options: WriteOptions,
  readState?: PasteReadStateSeed,
): Promise<void> {
  if (readState !== undefined) {
    await initializePasteReadState(env, pasteName, readState)
  }
  if (metadata.location === "R2" && !options.isMPUComplete) {
    await env.R2.put(pasteName, content, {
      customMetadata: { willExpireAtUnix: String(metadata.willExpireAtUnix) },
    })
  }
  const kvExpiration = metadata.lastModifiedAtUnix + Math.max(options.expirationSeconds, PASTE_EXPIRE_SPECIFIED_MIN)
  await putPasteIndex(env, pasteName, content, metadata, kvExpiration)
}

export async function updatePaste(
  env: Env,
  pasteName: string,
  content: ArrayBuffer | ReadableStream,
  originalMetadata: PasteMetadata,
  options: WriteOptions,
): Promise<PasteMetadata> {
  const needsReadState =
    options.remainingReads !== undefined ||
    originalMetadata.remainingReads !== undefined ||
    originalMetadata.readStateVersion !== undefined
  const readStateVersion = needsReadState ? crypto.randomUUID() : undefined
  const metadata = buildPasteMetadata(options, {
    // Once a paste is in R2, keep it there so an update cannot orphan the object.
    location: choosePasteLocation(env, options, originalMetadata.location),
    createdAtUnix: originalMetadata.createdAtUnix,
    accessCounter: originalMetadata.accessCounter,
    readStateVersion,
  })
  const readState =
    readStateVersion === undefined
      ? undefined
      : {
          version: readStateVersion,
          remainingReads: options.remainingReads ?? null,
          expiresAt: metadata.willExpireAtUnix * 1000,
          cleanupAt: Math.max(originalMetadata.willExpireAtUnix, metadata.willExpireAtUnix) * 1000,
        }
  await persistPaste(env, pasteName, content, metadata, options, readState)

  return metadata
}

export async function createPaste(
  env: Env,
  pasteName: string,
  content: ArrayBuffer | ReadableStream,
  options: WriteOptions,
): Promise<PasteMetadata> {
  const readStateVersion = options.remainingReads !== undefined ? crypto.randomUUID() : undefined
  const nowUnix = dateToUnix(options.now)
  const metadata = buildPasteMetadata(options, {
    location: choosePasteLocation(env, options),
    createdAtUnix: nowUnix,
    accessCounter: 0,
    readStateVersion,
  })
  const readState =
    readStateVersion === undefined
      ? undefined
      : {
          version: readStateVersion,
          remainingReads: options.remainingReads!,
          expiresAt: metadata.willExpireAtUnix * 1000,
        }
  await persistPaste(env, pasteName, content, metadata, options, readState)

  return metadata
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

interface RandomPasteNameOptions {
  maxAttempts?: number
  generateName?: (length: number) => string
}

export async function allocateRandomPasteName(
  env: Env,
  length: number,
  options: RandomPasteNameOptions = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 30
  const generateName = options.generateName ?? genRandStr

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateName(length)
    if (await pasteNameAvailable(env, candidate)) return candidate
  }

  throw new WorkerError(503, "unable to allocate an unused paste name")
}

export async function deletePaste(
  env: Env,
  pasteName: string,
  originalMetadata: PasteMetadata,
  options: { readStateAlreadyFinal?: boolean } = {},
): Promise<void> {
  if (
    !options.readStateAlreadyFinal &&
    (originalMetadata.remainingReads !== undefined || originalMetadata.readStateVersion !== undefined)
  ) {
    await initializePasteReadState(env, pasteName, {
      version: `deleted:${crypto.randomUUID()}`,
      remainingReads: null,
      expiresAt: Date.now(),
      cleanupAt: originalMetadata.willExpireAtUnix * 1000,
    })
  }
  if (originalMetadata.location === "R2") {
    await env.R2.delete(pasteName)
  }
  await env.PB.delete(pasteName)
}

export async function cleanExpiredInR2(env: Env, controller: ScheduledController) {
  const nowUnix = controller.scheduledTime / 1000
  let numCleaned = 0

  let cursor: string | undefined
  while (true) {
    const listed = await env.R2.list({ cursor, limit: 1000, include: ["customMetadata"] })
    const toDelete: string[] = []

    // separate objects with and without custom metadata
    const needKvLookup: R2Object[] = []
    for (const obj of listed.objects) {
      const expStr = obj.customMetadata?.willExpireAtUnix
      if (expStr) {
        if (Number(expStr) < nowUnix) {
          toDelete.push(obj.key)
        }
      } else {
        needKvLookup.push(obj)
      }
    }

    // batch KV lookups for legacy/MPU objects without custom metadata
    const kvResults = await mapWithConcurrency(needKvLookup, R2_CLEANUP_KV_LOOKUP_CONCURRENCY, (obj) =>
      getPasteMetadata(env, obj.key),
    )
    for (let i = 0; i < needKvLookup.length; i++) {
      const kvMeta = kvResults[i]
      if (kvMeta === null || kvMeta.willExpireAtUnix < nowUnix) {
        toDelete.push(needKvLookup[i].key)
      }
    }

    if (toDelete.length > 0) {
      await env.R2.delete(toDelete)
      numCleaned += toDelete.length
    }

    if (listed.truncated) {
      cursor = listed.cursor
    } else {
      break
    }
  }

  console.log(`${numCleaned} R2 objects cleaned`)
}
