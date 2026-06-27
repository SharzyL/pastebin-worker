import { useEffect, useRef, useState, useTransition } from "react"
import type { CSSProperties } from "react"

import { Link } from "../components/ui/index.js"

import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { useErrorModal } from "../components/ErrorModal.js"
import type { PasteSetting } from "../components/PasteSettingPanel.js"
import { PanelSettingsPanel } from "../components/PasteSettingPanel.js"
import { UploadedPanel } from "../components/UploadedPanel.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { PasteInputPanel } from "../components/PasteInputPanel.js"
import { LocalUploadsSidebar } from "../components/LocalUploadsSidebar.js"

import type { MetaResponse, PasteResponse } from "../../shared/interfaces.js"
import { parsePath, parseFilenameFromContentDisposition } from "../../shared/parsers.js"
import { PASSWD_SEP, MAX_URL_REDIRECT_LEN, MAX_AUTO_FETCH_BYTES } from "../../shared/constants.js"

import { verifyExpiration, verifyManageUrl, getMaxExpirationReadable } from "../utils/utils.js"
import { verifyName, verifyPassword, isLegalUrl, verifyReadLimit } from "../../shared/verify.js"
import { useNameAvailability } from "../utils/useNameAvailability.js"
import type { UploadProgress } from "../utils/uploader.js"
import { uploadPaste } from "../utils/uploader.js"
import type { LocalUploadRecord } from "../utils/localUploads.js"
import { pasteKeyFromUrl } from "../utils/pasteUrls.js"
import { useLocalUploads } from "../utils/useLocalUploads.js"
import { tst } from "../utils/overrides.js"
import type { EncryptionScheme } from "../utils/encryption.js"
import { decodeKey, decrypt } from "../utils/encryption.js"

import "../style.css"

function isMetaResponse(value: unknown): value is MetaResponse {
  return typeof value === "object" && value !== null && typeof (value as MetaResponse).sizeBytes === "number"
}

function parseContentLength(value: string | null): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function stripEncryptedSuffix(filename: string | undefined): string | undefined {
  return filename?.replace(/\.encrypted$/, "")
}

function pasteKeyFromMaybeUrl(url: string): string | undefined {
  try {
    return pasteKeyFromUrl(url)
  } catch {
    return undefined
  }
}

export function PasteBin({ config }: { config: Env }) {
  const [editorState, setEditorState] = useState<PasteEditState>({
    editKind: "edit",
    editContent: "",
    files: [],
    editHighlightLang: "plaintext",
  })

  const [pasteSetting, setPasteSetting] = useState<PasteSetting>({
    expiration: config.DEFAULT_EXPIRATION,
    readLimit: String(config.DEFAULT_READS),
    manageUrl: "",
    name: "",
    password: "",
    uploadKind: "short",
    doEncrypt: false,
  })

  const [pasteResponse, setPasteResponse] = useState<PasteResponse | undefined>(undefined)
  const [uploadedEncryptionKey, setUploadedEncryptionKey] = useState<string | undefined>(undefined)

  const [isUploadPending, startUpload] = useTransition()
  const [isDeletePending, startDelete] = useTransition()
  const [loadingProgress, setLoadingProgress] = useState<UploadProgress | undefined>(undefined)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const mainUploadAreaRef = useRef<HTMLDivElement | null>(null)
  const [isInitPasteLoading, startFetchingInitPaste] = useTransition()
  const { localUploads, externalRemoval, rememberLocalUpload, removeLocalUploadByKey } = useLocalUploads()
  const [latestLocalUploadKey, setLatestLocalUploadKey] = useState<string | undefined>(undefined)
  const [mainUploadAreaHeight, setMainUploadAreaHeight] = useState<number | undefined>(undefined)

  const [_, modeSelection, setModeSelection] = useDarkModeSelection()

  const { ErrorModal, showModal, handleError, handleFailedResp } = useErrorModal()

  const nameAvailability = useNameAvailability(
    pasteSetting.name,
    config.DEPLOY_URL,
    pasteSetting.uploadKind === "custom",
  )

  useEffect(() => {
    const element = mainUploadAreaRef.current
    if (!element || typeof ResizeObserver === "undefined") return

    const updateHeight = () => {
      setMainUploadAreaHeight(Math.ceil(element.getBoundingClientRect().height))
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (externalRemoval.revision === 0) return
    for (const key of externalRemoval.keys) {
      clearCurrentManagedPasteByKey(key)
    }
  }, [externalRemoval])

  // handle admin URL
  useEffect(() => {
    // SSR environment check
    if (typeof window === "undefined") return

    const pathname = location.pathname
    if (!pathname.includes(PASSWD_SEP)) return
    const { name, password, filename, ext } = parsePath(pathname)

    if (password !== undefined && pasteSetting.manageUrl === "") {
      setPasteSetting((prev) => ({
        ...prev,
        uploadKind: "manage",
        manageUrl: `${config.DEPLOY_URL}/${name}:${password}`,
      }))

      let pasteUrl = `${config.DEPLOY_URL}/${name}`
      if (filename) pasteUrl = `${pasteUrl}/${filename}`
      if (ext) pasteUrl = `${pasteUrl}${ext}`
      const metadataUrl = `${config.DEPLOY_URL}/m/${name}`

      startFetchingInitPaste(async () => {
        try {
          const metaResp = await fetch(metadataUrl)
          if (!metaResp.ok) {
            await handleFailedResp(`Error on Fetching ${metadataUrl}`, metaResp)
            return
          }
          const metadata: unknown = await metaResp.json()
          if (!isMetaResponse(metadata)) {
            showModal("Error on Fetching Paste Metadata", "The metadata response is invalid.")
            return
          }
          const encryptionScheme = metadata.encryptionScheme as EncryptionScheme | undefined
          const isEncrypted = encryptionScheme !== undefined
          if (isEncrypted) {
            setPasteSetting((prev) => ({ ...prev, doEncrypt: true }))
          }
          setPasteSetting((prev) => ({
            ...prev,
            readLimit: metadata.remainingReads === undefined ? "0" : String(metadata.remainingReads),
          }))

          const headResp = await fetch(pasteUrl, { method: "HEAD" })
          if (!headResp.ok) {
            await handleFailedResp(`Error on Fetching ${pasteUrl}`, headResp)
            return
          }
          const contentType = headResp.headers.get("Content-Type")
          const decryptedContentType = headResp.headers.get("X-PB-Decrypted-Content-Type")
          const effectiveContentType = isEncrypted ? decryptedContentType : contentType
          const contentLength = parseContentLength(headResp.headers.get("Content-Length"))
          const contentLang = headResp.headers.get("X-PB-Highlight-Language") || metadata.highlightLanguage
          const contentDisp = headResp.headers.get("Content-Disposition")

          const isText = effectiveContentType?.startsWith("text/") || !!contentLang
          if (!isText || !Number.isFinite(contentLength) || contentLength >= MAX_AUTO_FETCH_BYTES) {
            return
          }

          const keyString = location.hash.slice(1)
          if (isEncrypted && keyString.length === 0) {
            showModal(
              "Decryption key required",
              "This paste is encrypted. Open the manage URL with the decryption key after # to edit the plaintext.",
            )
            return
          }

          const resp = await fetch(pasteUrl)
          if (!resp.ok) {
            await handleFailedResp(`Error on Fetching ${pasteUrl}`, resp)
            return
          }

          let pasteFilename = filename
          if (pasteFilename === undefined && contentDisp !== null) {
            pasteFilename = parseFilenameFromContentDisposition(contentDisp)
          }
          if (isEncrypted) pasteFilename = stripEncryptedSuffix(pasteFilename)
          pasteFilename ||= metadata.filename

          let editContent: string
          if (isEncrypted) {
            let key: CryptoKey
            try {
              key = await decodeKey(encryptionScheme, keyString)
            } catch (err) {
              showModal("Invalid decryption key", (err as Error).message)
              return
            }
            const encryptedBytes = new Uint8Array(await resp.arrayBuffer())
            const decrypted = await decrypt(encryptionScheme, key, encryptedBytes)
            if (!decrypted) {
              showModal(
                "Decryption failed",
                "Could not decrypt the paste with the provided key. The URL fragment may be wrong, " +
                  "or the paste has been replaced or corrupted.",
              )
              return
            }
            editContent = new TextDecoder().decode(decrypted)
          } else {
            editContent = await resp.text()
          }

          setEditorState({
            editKind: "edit",
            editContent,
            files: [],
            editHighlightLang: contentLang || undefined,
            editFilename: pasteFilename,
          })
        } catch (e) {
          handleError(`Error on Fetching ${pasteUrl}`, e as Error)
        }
      })
    }
  }, [])

  function onStartUpload() {
    const controller = new AbortController()
    uploadAbortRef.current = controller
    // Clear any previous result so a failed/cancelled retry doesn't show stale URLs.
    setPasteResponse(undefined)
    setUploadedEncryptionKey(undefined)
    startUpload(async () => {
      try {
        let nextEncryptionKey: string | undefined
        const uploaded = await uploadPaste(
          pasteSetting,
          editorState,
          (key) => {
            nextEncryptionKey = key
            setUploadedEncryptionKey(key)
          },
          config,
          setLoadingProgress,
          controller.signal,
        )
        setPasteResponse(uploaded)
        rememberLocalUpload(uploaded, nextEncryptionKey)
        setLatestLocalUploadKey(pasteKeyFromUrl(uploaded.url))
        setPasteSetting({ ...pasteSetting, uploadKind: "manage", manageUrl: uploaded.manageUrl })
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          handleError("Error on Uploading Paste", e as Error)
        }
      } finally {
        if (uploadAbortRef.current === controller) uploadAbortRef.current = null
      }
    })
  }

  function onCancelUpload() {
    uploadAbortRef.current?.abort()
  }

  function onStartDelete() {
    startDelete(async () => {
      try {
        const resp = await fetch(pasteSetting.manageUrl, { method: "DELETE" })
        if (resp.ok) {
          showModal("Deleted Successfully", "It may takes 60 seconds for the deletion to propagate to the world")
          removeLocalUploadFromState(pasteKeyFromUrl(pasteSetting.manageUrl))
        } else {
          await handleFailedResp("Error on Delete Paste", resp)
        }
      } catch (e) {
        handleError("Error on Delete Paste", e as Error)
      }
    })
  }

  function canUpload(): boolean {
    if (editorState.editKind === "edit" && editorState.editContent.length === 0) {
      return false
    } else if (editorState.editKind === "file" && editorState.files.length === 0) {
      return false
    }

    if (!verifyPassword(pasteSetting.password)[0]) {
      return false
    }

    if (!verifyReadLimit(pasteSetting.readLimit)[0]) {
      return false
    }

    if (verifyExpiration(pasteSetting.expiration, config)[0]) {
      if (pasteSetting.uploadKind === "short" || pasteSetting.uploadKind === "long") {
        return true
      } else if (pasteSetting.uploadKind === "custom") {
        if (!verifyName(pasteSetting.name)[0]) return false
        // Allow upload if available, or if availability check failed (server still validates).
        return nameAvailability.status === "available" || nameAvailability.status === "error"
      } else if (pasteSetting.uploadKind === "manage") {
        return verifyManageUrl(pasteSetting.manageUrl, config)[0]
      } else {
        return false
      }
    } else {
      return false
    }
  }

  function canDelete(): boolean {
    return verifyManageUrl(pasteSetting.manageUrl, config)[0]
  }

  function clearCurrentManagedPasteByKey(key: string) {
    if (pasteKeyFromMaybeUrl(pasteSetting.manageUrl) === key) {
      setPasteResponse(undefined)
      setPasteSetting((prev) => {
        if (pasteKeyFromMaybeUrl(prev.manageUrl) !== key) return prev
        return { ...prev, uploadKind: "short", manageUrl: "" }
      })
    }
  }

  function removeLocalUploadFromState(key: string) {
    removeLocalUploadByKey(key)
    clearCurrentManagedPasteByKey(key)
  }

  async function onDeleteLocalUpload(upload: LocalUploadRecord): Promise<boolean> {
    try {
      const resp = await fetch(upload.manageUrl, { method: "DELETE" })
      if (resp.ok) {
        removeLocalUploadFromState(upload.key)
        return true
      } else if (resp.status === 404 || resp.status === 410) {
        removeLocalUploadFromState(upload.key)
        return true
      } else {
        await handleFailedResp("Error on Delete Paste", resp)
        return false
      }
    } catch (e) {
      handleError("Error on Delete Paste", e as Error)
      return false
    }
  }

  const info = (
    <div className="mx-4 lg:px-4 lg:mx-0">
      <div className="mt-8 mb-4 flex items-center justify-between">
        <h1 className="text-3xl">{config.INDEX_PAGE_TITLE}</h1>
        <DarkModeToggle modeSelection={modeSelection} setModeSelection={setModeSelection} />
      </div>
      <p className="my-2">A pastebin running on Cloudflare Workers.</p>
      <p className="my-2">
        <b>Usage</b>: paste text or drop a file, then share the returned URL. You can also use{" "}
        <Link className={tst} href={`${config.DEPLOY_URL}/doc/curl`}>
          curl
        </Link>
        {", the "}
        <Link className={tst} href={`${config.DEPLOY_URL}/doc/api`}>
          HTTP API
        </Link>
        {", or as an "}
        <Link className={tst} href={`${config.DEPLOY_URL}/doc/skill.md`}>
          AI agent skill
        </Link>
        .
      </p>
      <p className="my-2">
        <b>Warning</b>: Only for temporary share <b>(max {getMaxExpirationReadable(config)})</b>. Files could be deleted
        without notice!
      </p>
    </div>
  )

  const isManageMode = pasteSetting.uploadKind === "manage"
  const uploadDisabled = !canUpload() || isUploadPending || isDeletePending
  const deleteDisabled = !canDelete() || isUploadPending || isDeletePending

  const baseActionClass = `flex-1 py-3 text-center font-bold ${tst}`
  const uploadClass =
    `${baseActionClass} ${isManageMode ? "rounded-bl-2xl" : "rounded-b-2xl"} bg-primary-50 text-primary ` +
    (uploadDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-primary-100")
  const deleteClass =
    `${baseActionClass} rounded-br-2xl bg-danger-50 text-danger ` +
    (deleteDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-danger-100")

  const submitter = (
    <div className="flex flex-row items-stretch">
      <button type="button" onClick={onStartUpload} disabled={uploadDisabled} className={uploadClass}>
        {isManageMode ? "Update" : "Upload"}
      </button>
      {isManageMode && (
        <button type="button" onClick={onStartDelete} disabled={deleteDisabled} className={deleteClass}>
          Delete
        </button>
      )}
    </div>
  )

  const footer = (
    <footer className="px-3 my-4 text-center">
      <p>
        <Link href={`${config.DEPLOY_URL}/doc/tos`} className={`d-inline-block ${tst}`}>
          Terms & Conditions
        </Link>
        {" / "}
        <Link href={config.REPO} className={`d-inline-block ${tst}`}>
          Repository
        </Link>
      </p>
    </footer>
  )

  return (
    <main className={`flex flex-col items-center min-h-screen font-sans ${tst} bg-background text-foreground`}>
      <div className="grow w-full max-w-[88rem] px-2 lg:px-4 xl:px-0">
        {info}
        <div className="flex w-full flex-col gap-6 xl:flex-row xl:items-start">
          <div ref={mainUploadAreaRef} className="min-w-0 flex-1">
            <PasteInputPanel
              isPasteLoading={isInitPasteLoading}
              state={editorState}
              onStateChange={setEditorState}
              config={config}
              showModal={showModal}
              className="mt-6 mb-4 mx-0"
            />
            <div className="flex flex-col items-start lg:flex-row gap-4 mx-0">
              <PanelSettingsPanel
                config={config}
                className={"transition-width lg:w-1/2 w-full"}
                setting={pasteSetting}
                onSettingChange={setPasteSetting}
                nameAvailability={nameAvailability}
                footer={submitter}
              />
              {(pasteResponse || isUploadPending) && (
                <UploadedPanel
                  isLoading={isUploadPending}
                  loadingProgress={loadingProgress}
                  onCancel={onCancelUpload}
                  pasteResponse={pasteResponse}
                  encryptionKey={uploadedEncryptionKey}
                  highlightLang={editorState.editKind === "edit" ? editorState.editHighlightLang : undefined}
                  isUrlPaste={
                    editorState.editKind === "edit" &&
                    editorState.editContent.length > 0 &&
                    editorState.editContent.length <= MAX_URL_REDIRECT_LEN &&
                    isLegalUrl(editorState.editContent)
                  }
                  className="w-full lg:w-1/2"
                />
              )}
            </div>
          </div>
          <LocalUploadsSidebar
            uploads={localUploads}
            onDeleteUpload={onDeleteLocalUpload}
            scrollToKey={latestLocalUploadKey}
            style={
              mainUploadAreaHeight === undefined
                ? undefined
                : ({ "--local-uploads-height": `${mainUploadAreaHeight}px` } as CSSProperties)
            }
          />
        </div>
      </div>
      {footer}
      <ErrorModal />
    </main>
  )
}
