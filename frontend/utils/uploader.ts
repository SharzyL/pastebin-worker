import type { PasteSetting } from "../components/PasteSettingPanel.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { ErrorWithTitle, verifyFileSize } from "./utils.js"
import type { PasteResponse, PublicEnv } from "../../shared/interfaces.js"
import { CHUNKED_ENCRYPTION_SCHEME, createChunkedEncryptionContext } from "./encryption.js"
import { encryptedFileSize, encryptionChunkBounds, encryptionChunkCount } from "./encryptionCore.js"
import type { UploadOptions } from "../../shared/uploadPaste.js"
import { UploadError, uploadMPU, uploadMPUSource, uploadNormal } from "../../shared/uploadPaste.js"
import { DIRECT_UPLOAD_MAX_BYTES } from "../../shared/constants.js"
import { parseReadLimit } from "../../shared/verify.js"
import { prepareContent } from "./content.js"

export interface UploadProgress {
  doneBytes: number
  totalBytes: number
}

export async function uploadPaste(
  pasteSetting: PasteSetting,
  editorState: PasteEditState,
  onEncryptionKeyChange: (k: string | undefined) => void, // we only generate key on upload, so need a callback of key generation
  config: PublicEnv,
  onProgress?: (progress: UploadProgress | undefined) => void,
  signal?: AbortSignal,
): Promise<PasteResponse> {
  const prepared = await prepareContent(editorState, {
    errorTitle: "Error on Preparing Upload",
    signal,
  })
  const { content, originalFiles } = prepared

  try {
    const storedSize = pasteSetting.doEncrypt ? encryptedFileSize(content.size) : content.size
    const [contentSizeOk, contentSizeMsg] = verifyFileSize(storedSize, config)
    if (!contentSizeOk) {
      throw new ErrorWithTitle("Error on Preparing Upload", contentSizeMsg)
    }
    const readLimit = parseReadLimit(pasteSetting.readLimit)
    if (readLimit === null) {
      throw new ErrorWithTitle("Error on Preparing Upload", "Reads must be a non-negative integer")
    }

    const options: UploadOptions = {
      content,
      filenames: originalFiles,
      isUpdate: pasteSetting.uploadKind === "manage",
      isPrivate: pasteSetting.uploadKind === "long",
      password: pasteSetting.password.length ? pasteSetting.password : undefined,
      expire: pasteSetting.expiration,
      remainingReads: readLimit,
      name: pasteSetting.uploadKind === "custom" ? pasteSetting.name : undefined,
      highlightLanguage: editorState.editKind === "edit" ? editorState.editHighlightLang : undefined,
      encryptionScheme: pasteSetting.doEncrypt ? CHUNKED_ENCRYPTION_SCHEME : undefined,
      inferMimeType: editorState.editKind === "file",
      manageUrl: pasteSetting.manageUrl,
    }

    const contentLength = storedSize
    const reportProgress = (doneBytes: number, totalBytes: number) => {
      if (onProgress) onProgress({ doneBytes, totalBytes })
    }

    try {
      if (onProgress) onProgress({ doneBytes: 0, totalBytes: contentLength })
      if (!pasteSetting.doEncrypt) {
        onEncryptionKeyChange(undefined)
        if (contentLength <= DIRECT_UPLOAD_MAX_BYTES) {
          return await uploadNormal(config.DEPLOY_URL, options, reportProgress, signal)
        }
        return await uploadMPU(config.DEPLOY_URL, DIRECT_UPLOAD_MAX_BYTES, options, reportProgress, undefined, signal)
      }

      const context = await createChunkedEncryptionContext(content.size)
      onEncryptionKeyChange(context.encodedKey)
      const encryptionPartCount = encryptionChunkCount(content.size)
      const encryptedChunk = async (index: number, abortSignal?: AbortSignal): Promise<Blob> => {
        abortSignal?.throwIfAborted()
        const { start, end } = encryptionChunkBounds(content.size, index)
        const plaintext = await content.slice(start, end).arrayBuffer()
        abortSignal?.throwIfAborted()
        const ciphertext = await context.session.encrypt(index, plaintext)
        abortSignal?.throwIfAborted()
        return index === 0 ? new Blob([context.session.header.bytes, ciphertext]) : new Blob([ciphertext])
      }
      let prefetchedEncryptionPart: { index: number; promise: Promise<Blob> } | undefined

      try {
        if (storedSize <= DIRECT_UPLOAD_MAX_BYTES) {
          const encryptedContent = new File([await encryptedChunk(0, signal)], content.name)
          return await uploadNormal(
            config.DEPLOY_URL,
            { ...options, content: encryptedContent },
            reportProgress,
            signal,
          )
        }

        // Encryption chunks are not valid R2 parts as-is: the first one also contains
        // the container header, so it is 32 bytes larger than later full chunks. R2
        // requires every non-final multipart part to have exactly the same size. Keep
        // the encryption container unchanged, but reframe its byte stream into fixed
        // 5 MiB upload parts.
        const uploadPartCount = Math.ceil(storedSize / DIRECT_UPLOAD_MAX_BYTES)
        let nextEncryptionPart = 0
        let nextUploadPart = 0
        let pending = new Blob()
        const takeNextEncryptionPart = async (abortSignal: AbortSignal): Promise<Blob> => {
          const index = nextEncryptionPart
          nextEncryptionPart += 1
          if (prefetchedEncryptionPart?.index === index) {
            const prefetched = prefetchedEncryptionPart.promise
            prefetchedEncryptionPart = undefined
            return await prefetched
          }
          return await encryptedChunk(index, abortSignal)
        }

        const prefetchNextEncryptionPart = (abortSignal: AbortSignal) => {
          if (prefetchedEncryptionPart || nextEncryptionPart >= encryptionPartCount) return
          prefetchedEncryptionPart = {
            index: nextEncryptionPart,
            promise: encryptedChunk(nextEncryptionPart, abortSignal),
          }
        }

        const getUploadPart = async (index: number, abortSignal: AbortSignal): Promise<Blob> => {
          if (index !== nextUploadPart) {
            throw new Error(`Encrypted MPU parts must be requested in order (expected ${nextUploadPart}, got ${index})`)
          }
          abortSignal.throwIfAborted()

          const targetSize = Math.min(DIRECT_UPLOAD_MAX_BYTES, storedSize - index * DIRECT_UPLOAD_MAX_BYTES)
          const pieces: Blob[] = []
          let partSize = 0
          while (partSize < targetSize) {
            if (pending.size === 0) {
              if (nextEncryptionPart >= encryptionPartCount) {
                throw new Error("Encrypted upload source ended unexpectedly")
              }
              pending = await takeNextEncryptionPart(abortSignal)
            }

            const bytesToTake = Math.min(targetSize - partSize, pending.size)
            pieces.push(pending.slice(0, bytesToTake))
            pending = pending.slice(bytesToTake)
            partSize += bytesToTake
          }
          nextUploadPart += 1
          prefetchNextEncryptionPart(abortSignal)
          return new Blob(pieces)
        }

        return await uploadMPUSource(
          config.DEPLOY_URL,
          {
            name: content.name,
            size: storedSize,
            partCount: uploadPartCount,
            getPart: getUploadPart,
          },
          options,
          reportProgress,
          1,
          signal,
        )
      } finally {
        const settlePrefetch = prefetchedEncryptionPart?.promise.catch(() => undefined)
        context.session.close()
        await settlePrefetch
      }
    } catch (e) {
      if (e instanceof UploadError) {
        throw new ErrorWithTitle("Error on Upload", e.message)
      }
      throw e
    } finally {
      if (onProgress) onProgress(undefined)
    }
  } finally {
    await prepared.cleanup?.()
  }
}
