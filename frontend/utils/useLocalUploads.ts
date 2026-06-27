import { useEffect, useRef, useState } from "react"

import type { PasteResponse } from "../../shared/interfaces.js"
import type { LocalUploadRecord } from "./localUploads.js"
import { LOCAL_UPLOADS_KEY, readLocalUploads, removeLocalUpload, upsertLocalUpload } from "./localUploads.js"

export function useLocalUploads() {
  const [localUploads, setLocalUploads] = useState<LocalUploadRecord[]>([])
  const localUploadsRef = useRef<LocalUploadRecord[]>([])
  const [externalRemoval, setExternalRemoval] = useState<{ keys: string[]; revision: number }>({
    keys: [],
    revision: 0,
  })

  useEffect(() => {
    const records = readLocalUploads()
    localUploadsRef.current = records
    setLocalUploads(records)
  }, [])

  useEffect(() => {
    localUploadsRef.current = localUploads
  }, [localUploads])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_UPLOADS_KEY) {
        const nextLocalUploads = readLocalUploads()
        const nextKeys = new Set(nextLocalUploads.map((upload) => upload.key))
        const removedKeys = localUploadsRef.current
          .map((upload) => upload.key)
          .filter((key) => !nextKeys.has(key))

        localUploadsRef.current = nextLocalUploads
        setLocalUploads(nextLocalUploads)
        if (removedKeys.length > 0) {
          setExternalRemoval((current) => ({ keys: removedKeys, revision: current.revision + 1 }))
        }
      }
    }

    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  function rememberLocalUpload(response: PasteResponse, encryptionKey?: string) {
    const nextLocalUploads = upsertLocalUpload(response, encryptionKey)
    localUploadsRef.current = nextLocalUploads
    setLocalUploads(nextLocalUploads)
  }

  function removeLocalUploadByKey(key: string) {
    const nextLocalUploads = removeLocalUpload(key)
    localUploadsRef.current = nextLocalUploads
    setLocalUploads(nextLocalUploads)
  }

  return {
    localUploads,
    externalRemoval,
    rememberLocalUpload,
    removeLocalUploadByKey,
  }
}
