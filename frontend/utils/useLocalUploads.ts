import { useEffect, useState } from "react"

import type { PasteResponse } from "../../shared/interfaces.js"
import type { LocalUploadRecord } from "./localUploads.js"
import { LOCAL_UPLOADS_KEY, readLocalUploads, removeLocalUpload, upsertLocalUpload } from "./localUploads.js"

export function useLocalUploads() {
  const [localUploads, setLocalUploads] = useState<LocalUploadRecord[]>([])

  useEffect(() => {
    setLocalUploads(readLocalUploads())
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_UPLOADS_KEY) {
        setLocalUploads(readLocalUploads())
      }
    }

    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  function rememberLocalUpload(response: PasteResponse, encryptionKey?: string) {
    setLocalUploads(upsertLocalUpload(response, encryptionKey))
  }

  function removeLocalUploadByKey(key: string) {
    setLocalUploads(removeLocalUpload(key))
  }

  return {
    localUploads,
    rememberLocalUpload,
    removeLocalUploadByKey,
  }
}
