import type { ChunkedEncryptionHeader } from "./encryptionCore.js"
import { decryptChunk, encryptChunk } from "./encryptionCore.js"

interface InitializeMessage {
  type: "initialize"
  key: CryptoKey
  header: ChunkedEncryptionHeader
}

interface TransformMessage {
  type: "encrypt" | "decrypt"
  id: number
  index: number
  data: ArrayBuffer
}

type WorkerRequest = InitializeMessage | TransformMessage

interface WorkerSuccess {
  id: number
  data: ArrayBuffer
}

interface WorkerFailure {
  id: number
  error: string
}

let key: CryptoKey | undefined
let header: ChunkedEncryptionHeader | undefined

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === "initialize") {
    key = message.key
    header = message.header
    return
  }

  void (async () => {
    try {
      if (!key || !header) throw new Error("Encryption worker is not initialized")
      const data =
        message.type === "encrypt"
          ? await encryptChunk(key, header, message.index, message.data)
          : await decryptChunk(key, header, message.index, message.data)
      const response: WorkerSuccess = { id: message.id, data }
      self.postMessage(response, { transfer: [data] })
    } catch (error) {
      const response: WorkerFailure = {
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }
      self.postMessage(response)
    }
  })()
}
