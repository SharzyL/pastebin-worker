/// <reference lib="webworker" />

interface StorageRequest {
  id: number
  type: "open" | "write" | "flush" | "close" | "discard"
  peerId?: string
  checkpointBytes?: number
  tailOffset?: number
  position?: number
  parts?: ArrayBuffer[]
}

let root: FileSystemDirectoryHandle | undefined
let filename: string | undefined
let access: FileSystemSyncAccessHandle | undefined

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError"
}

function respond(id: number, value?: unknown, transfer: Transferable[] = []): void {
  self.postMessage({ id, ok: true, value }, { transfer })
}

function fail(id: number, error: unknown): void {
  self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
}

async function open(request: StorageRequest): Promise<void> {
  if (!request.peerId || !Number.isSafeInteger(request.checkpointBytes) || !Number.isSafeInteger(request.tailOffset)) {
    throw new Error("Invalid P2P storage checkpoint.")
  }
  const checkpointBytes = request.checkpointBytes!
  const tailOffset = request.tailOffset!
  if (checkpointBytes < 0 || tailOffset < 0 || tailOffset > checkpointBytes) {
    throw new Error("Invalid P2P storage checkpoint range.")
  }

  root = await navigator.storage.getDirectory()
  filename = `p2p-${request.peerId}.tmp`
  const handle = await root.getFileHandle(filename, { create: checkpointBytes === 0 })
  access = await handle.createSyncAccessHandle()
  const size = access.getSize()
  if (size < checkpointBytes) throw new Error("The saved P2P partial file is incomplete.")
  if (size !== checkpointBytes) access.truncate(checkpointBytes)
  const tail = new ArrayBuffer(checkpointBytes - tailOffset)
  if (tail.byteLength > 0) access.read(tail, { at: tailOffset })
  respond(request.id, { tail }, [tail])
}

self.onmessage = (event: MessageEvent<StorageRequest>) => {
  const request = event.data
  void (async () => {
    try {
      if (request.type === "open") {
        await open(request)
        return
      }
      if (request.type === "discard") {
        access?.close()
        access = undefined
        if (root && filename) {
          try {
            await root.removeEntry(filename)
          } catch (error) {
            if (!isNotFoundError(error)) throw error
          }
        }
        respond(request.id)
        return
      }
      if (request.type === "close") {
        access?.close()
        access = undefined
        respond(request.id)
        return
      }
      if (!access) throw new Error("P2P storage is not open.")
      if (request.type === "write") {
        if (
          !Number.isSafeInteger(request.position) ||
          request.position! < 0 ||
          !Array.isArray(request.parts) ||
          request.parts.length === 0 ||
          !request.parts.every((part) => part instanceof ArrayBuffer)
        ) {
          throw new Error("Invalid P2P storage write.")
        }
        let position = request.position!
        for (const part of request.parts) {
          const written = access.write(part, { at: position })
          if (written !== part.byteLength) throw new Error("Incomplete P2P storage write.")
          position += written
        }
        respond(request.id)
        return
      }
      if (request.type === "flush") {
        access.flush()
        respond(request.id)
        return
      }
    } catch (error) {
      fail(request.id, error)
    }
  })()
}

export {}
