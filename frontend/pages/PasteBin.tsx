import { useEffect, useRef, useState, useTransition } from "react"
import type { CSSProperties } from "react"

import { Link } from "../components/ui/index.js"

import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { useErrorModal } from "../components/ErrorModal.js"
import { PanelSettingsPanel } from "../components/PasteSettingPanel.js"
import { UploadedPanel } from "../components/UploadedPanel.js"
import { P2PTransferPanel } from "../components/P2PTransferPanel.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { PasteInputPanel } from "../components/PasteInputPanel.js"
import { LocalUploadsSidebar } from "../components/LocalUploadsSidebar.js"

import type { PasteResponse, PublicEnv } from "../../shared/interfaces.js"
import { parsePath } from "../../shared/parsers.js"
import { PASSWD_SEP, MAX_URL_REDIRECT_LEN, MAX_AUTO_FETCH_BYTES } from "../../shared/constants.js"

import { verifyManageUrl, getMaxExpirationReadable } from "../utils/utils.js"
import { isLegalUrl } from "../../shared/verify.js"
import { useNameAvailability } from "../utils/useNameAvailability.js"
import type { UploadProgress } from "../utils/uploader.js"
import { uploadPaste } from "../utils/uploader.js"
import type { LocalUploadRecord } from "../utils/localUploads.js"
import { pasteKeyFromUrl } from "../utils/pasteUrls.js"
import { useLocalUploads } from "../utils/useLocalUploads.js"
import { tst } from "../utils/overrides.js"
import type { EncryptionScheme } from "../../shared/constants.js"
import { decodeKey, decrypt } from "../utils/encryption.js"
import { isMetaResponse, parsePasteResponseHeaders, stripEncryptedSuffix } from "../utils/pasteResponse.js"
import { validatePasteSetting, type PasteSetting } from "../utils/pasteSetting.js"
import { prepareContent } from "../utils/content.js"
import {
  createP2PUpdateSnapshot,
  isSameP2PContent,
  isSameP2PUpdate,
  useP2PSenderController,
} from "../utils/p2p/useSenderController.js"

import "../style.css"

function pasteKeyFromMaybeUrl(url: string): string | undefined {
  try {
    return pasteKeyFromUrl(url)
  } catch {
    return undefined
  }
}

interface PasteUpdateSnapshot {
  editorState: PasteEditState
  expiration: string
  readLimit: string
  password: string
  manageUrl: string
  doEncrypt: boolean
}

function pasteUpdateSnapshot(editorState: PasteEditState, setting: PasteSetting): PasteUpdateSnapshot {
  return {
    editorState: { ...editorState, files: [...editorState.files] },
    expiration: setting.expiration,
    readLimit: setting.readLimit,
    password: setting.password,
    manageUrl: setting.manageUrl,
    doEncrypt: setting.doEncrypt,
  }
}

function isSamePasteUpdate(snapshot: PasteUpdateSnapshot, editorState: PasteEditState, setting: PasteSetting): boolean {
  const previous = snapshot.editorState
  const sameEditor =
    previous.editKind === editorState.editKind &&
    (editorState.editKind === "edit"
      ? previous.editContent === editorState.editContent &&
        previous.editFilename === editorState.editFilename &&
        previous.editHighlightLang === editorState.editHighlightLang
      : previous.files.length === editorState.files.length &&
        previous.files.every((file, index) => file === editorState.files[index]))
  return (
    sameEditor &&
    snapshot.expiration === setting.expiration &&
    snapshot.readLimit === setting.readLimit &&
    snapshot.password === setting.password &&
    snapshot.manageUrl === setting.manageUrl &&
    snapshot.doEncrypt === setting.doEncrypt
  )
}

export function PasteBin({ config }: { config: PublicEnv }) {
  const [editorState, setEditorState] = useState<PasteEditState>({
    editKind: config.DEFAULT_TAB === "file" ? "file" : "edit",
    editContent: "",
    files: [],
    editHighlightLang: "plaintext",
  })

  const [pasteSetting, setPasteSetting] = useState<PasteSetting>({
    expiration: config.DEFAULT_P2P_TRANSFER === true ? config.DEFAULT_P2P_EXPIRATION : config.DEFAULT_EXPIRATION,
    readLimit: String(config.DEFAULT_P2P_TRANSFER === true ? config.DEFAULT_P2P_TRANSFERS : config.DEFAULT_READS),
    manageUrl: "",
    name: "",
    password: "",
    uploadKind: "short",
    isP2P: config.DEFAULT_P2P_TRANSFER === true,
    doEncrypt: false,
    verifyP2P: config.DEFAULT_P2P_TRANSFER === true && config.DEFAULT_P2P_VERIFY,
  })

  const [pasteResponse, setPasteResponse] = useState<PasteResponse | undefined>(undefined)
  const [uploadedEncryptionKey, setUploadedEncryptionKey] = useState<string | undefined>(undefined)
  const [lastPasteUpdate, setLastPasteUpdate] = useState<PasteUpdateSnapshot | null>(null)

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
  const p2p = useP2PSenderController((error) => handleError("Error on P2P Transfer", error))

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
    const closePageResources = () => {
      const uploadController = uploadAbortRef.current
      uploadAbortRef.current = null
      uploadController?.abort()

      p2p.dispose()
    }
    const handlePageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) closePageResources()
    }

    window.addEventListener("pagehide", handlePageHide)
    return () => {
      window.removeEventListener("pagehide", handlePageHide)
      closePageResources()
    }
  }, [p2p.dispose])

  useEffect(() => {
    if (!pasteSetting.isP2P) p2p.close()
  }, [pasteSetting.isP2P, p2p.close])

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
      const controller = new AbortController()
      const { signal } = controller
      const manageUrl = `${config.DEPLOY_URL}/${name}:${password}`
      setPasteSetting((prev) => ({
        ...prev,
        isP2P: false,
        uploadKind: "manage",
        manageUrl,
        expiration: config.DEFAULT_EXPIRATION,
        verifyP2P: false,
      }))

      let pasteUrl = `${config.DEPLOY_URL}/${name}`
      if (filename) pasteUrl = `${pasteUrl}/${filename}`
      if (ext) pasteUrl = `${pasteUrl}${ext}`
      const metadataUrl = `${config.DEPLOY_URL}/m/${name}`

      startFetchingInitPaste(async () => {
        try {
          const metaResp = await fetch(metadataUrl, { signal })
          if (!metaResp.ok) {
            await handleFailedResp(`Error on Fetching ${metadataUrl}`, metaResp)
            return
          }
          const metadata: unknown = await metaResp.json()
          signal.throwIfAborted()
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

          const headResp = await fetch(pasteUrl, { method: "HEAD", signal })
          if (!headResp.ok) {
            await handleFailedResp(`Error on Fetching ${pasteUrl}`, headResp)
            return
          }
          signal.throwIfAborted()
          const responseInfo = parsePasteResponseHeaders(headResp.headers, encryptionScheme ?? null)
          const { effectiveContentType, contentLength } = responseInfo
          const contentLang = responseInfo.highlightLanguage || metadata.highlightLanguage

          const isText = effectiveContentType?.startsWith("text/") || !!contentLang
          if (!isText || contentLength === null || contentLength >= MAX_AUTO_FETCH_BYTES) {
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

          const resp = await fetch(pasteUrl, { signal })
          if (!resp.ok) {
            await handleFailedResp(`Error on Fetching ${pasteUrl}`, resp)
            return
          }

          let pasteFilename = filename || responseInfo.filename
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
            signal.throwIfAborted()
            const decrypted = await decrypt(encryptionScheme, key, encryptedBytes)
            signal.throwIfAborted()
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
            signal.throwIfAborted()
          }

          const nextEditorState: PasteEditState = {
            editKind: "edit",
            editContent,
            files: [],
            editHighlightLang: contentLang || undefined,
            editFilename: pasteFilename,
          }
          const nextSetting: PasteSetting = {
            ...pasteSetting,
            isP2P: false,
            uploadKind: "manage",
            manageUrl,
            expiration: config.DEFAULT_EXPIRATION,
            readLimit: metadata.remainingReads === undefined ? "0" : String(metadata.remainingReads),
            doEncrypt: isEncrypted,
            verifyP2P: false,
          }
          setEditorState(nextEditorState)
          setLastPasteUpdate(pasteUpdateSnapshot(nextEditorState, nextSetting))
        } catch (e) {
          if (signal.aborted || (e as Error).name === "AbortError") return
          handleError(`Error on Fetching ${pasteUrl}`, e as Error)
        }
      })
      return () => controller.abort()
    }
  }, [])

  function onStartUpload() {
    const controller = new AbortController()
    uploadAbortRef.current = controller
    // Clear any previous result so a failed/cancelled retry doesn't show stale URLs.
    setPasteResponse(undefined)
    setUploadedEncryptionKey(undefined)
    p2p.close()
    startUpload(async () => {
      try {
        if (pasteSetting.isP2P) {
          const { startP2PSender } = await import("../utils/p2pSender.js")
          controller.signal.throwIfAborted()
          const prepared = await prepareContent(editorState, {
            errorTitle: "Error on Preparing P2P Share",
            signal: controller.signal,
          })
          let cleanupTransferred = false
          try {
            const session = await startP2PSender(
              prepared.content,
              config,
              pasteSetting.expiration,
              pasteSetting.readLimit,
              pasteSetting.verifyP2P,
              p2p.callbacks,
              controller.signal,
              editorState.editKind === "edit" ? editorState.editHighlightLang : undefined,
              prepared.cleanup,
            )
            cleanupTransferred = true
            p2p.attach(session, createP2PUpdateSnapshot(editorState, pasteSetting))
            return
          } finally {
            if (!cleanupTransferred) await prepared.cleanup?.()
          }
        }

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
        const nextSetting = { ...pasteSetting, uploadKind: "manage" as const, manageUrl: uploaded.manageUrl }
        setPasteSetting(nextSetting)
        setLastPasteUpdate(pasteUpdateSnapshot(editorState, nextSetting))
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          handleError(pasteSetting.isP2P ? "Error on Starting P2P Share" : "Error on Uploading Paste", e as Error)
        }
      } finally {
        if (uploadAbortRef.current === controller) uploadAbortRef.current = null
      }
    })
  }

  function onCancelUpload() {
    uploadAbortRef.current?.abort()
    p2p.close()
  }

  function onUpdateP2P() {
    const session = p2p.sessionRef.current
    const previousUpdate = p2p.lastUpdate
    if (!session || !previousUpdate || isSameP2PUpdate(previousUpdate, editorState, pasteSetting)) return
    const controller = new AbortController()
    uploadAbortRef.current = controller
    startUpload(async () => {
      let pendingContentCleanup: (() => Promise<void>) | undefined
      try {
        const fileVersionChanged =
          !isSameP2PContent(previousUpdate.editorState, editorState) ||
          previousUpdate.verifyTransfer !== pasteSetting.verifyP2P
        const prepared = fileVersionChanged
          ? await prepareContent(editorState, {
              errorTitle: "Error on Preparing P2P Share",
              signal: controller.signal,
            })
          : undefined
        pendingContentCleanup = prepared?.cleanup
        controller.signal.throwIfAborted()
        if (!p2p.isCurrent(session)) return
        const updatedRoom = await session.updateRoomOptions(
          pasteSetting.expiration,
          pasteSetting.readLimit,
          controller.signal,
        )
        controller.signal.throwIfAborted()
        if (!p2p.isCurrent(session)) return
        if (prepared) {
          p2p.setCurrentFile(
            session.updateFile(
              prepared.content,
              pasteSetting.verifyP2P,
              editorState.editKind === "edit" ? editorState.editHighlightLang : undefined,
              prepared.cleanup,
            ),
          )
          pendingContentCleanup = undefined
        }
        p2p.updateRoom(updatedRoom.expireAt, updatedRoom.expirationSeconds)
        p2p.setLastUpdate(createP2PUpdateSnapshot(editorState, pasteSetting))
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          handleError("Error on Updating P2P Share", e as Error)
        }
      } finally {
        await pendingContentCleanup?.()
        if (uploadAbortRef.current === controller) uploadAbortRef.current = null
      }
    })
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

    const validation = validatePasteSetting(pasteSetting, config)
    if (!validation.isValid) return false

    if (pasteSetting.isP2P) return true

    if (pasteSetting.uploadKind === "short" || pasteSetting.uploadKind === "long") {
      return true
    } else if (pasteSetting.uploadKind === "custom") {
      // Allow upload if available, or if availability check failed (server still validates).
      return nameAvailability.status === "available" || nameAvailability.status === "error"
    } else if (pasteSetting.uploadKind === "manage") {
      return true
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
      setLastPasteUpdate(null)
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

  const isManageMode = !pasteSetting.isP2P && pasteSetting.uploadKind === "manage"
  const uploadDisabled = !canUpload() || isUploadPending || isDeletePending
  const deleteDisabled = !canDelete() || isUploadPending || isDeletePending
  const hasP2PPanel = pasteSetting.isP2P && (p2p.response !== undefined || isUploadPending)
  const hasActiveP2PSession = pasteSetting.isP2P && p2p.response !== undefined
  const hasP2PChanges = p2p.lastUpdate !== null && !isSameP2PUpdate(p2p.lastUpdate, editorState, pasteSetting)
  const p2pUpdateDisabled = uploadDisabled || !hasP2PChanges
  const pasteUpdateDisabled =
    uploadDisabled ||
    (isManageMode && lastPasteUpdate !== null && isSamePasteUpdate(lastPasteUpdate, editorState, pasteSetting))
  const hasUploadResultPanel = !pasteSetting.isP2P && (pasteResponse !== undefined || isUploadPending)

  const baseActionClass = `flex-1 py-3 text-center font-bold ${tst}`
  const uploadClass =
    `${baseActionClass} ${isManageMode ? "rounded-bl-2xl" : "rounded-b-2xl"} bg-primary-50 text-primary ` +
    (pasteUpdateDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-primary-100")
  const deleteClass =
    `${baseActionClass} rounded-br-2xl bg-danger-50 text-danger ` +
    (deleteDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-danger-100")
  const p2pUpdateClass =
    `${baseActionClass} rounded-bl-2xl bg-primary-50 text-primary ` +
    (p2pUpdateDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-primary-100")
  const p2pStopClass = `${baseActionClass} rounded-br-2xl bg-danger-50 text-danger cursor-pointer hover:bg-danger-100`

  const submitter = (
    <div className="flex flex-row items-stretch">
      {hasActiveP2PSession ? (
        <>
          <button type="button" onClick={onUpdateP2P} disabled={p2pUpdateDisabled} className={p2pUpdateClass}>
            {isUploadPending ? "Updating P2P..." : "Update P2P"}
          </button>
          <button type="button" onClick={onCancelUpload} className={p2pStopClass}>
            Stop P2P
          </button>
        </>
      ) : (
        <button type="button" onClick={onStartUpload} disabled={pasteUpdateDisabled} className={uploadClass}>
          {pasteSetting.isP2P ? "Start P2P" : isManageMode ? "Update" : "Upload"}
        </button>
      )}
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
              skipFileSizeLimit={pasteSetting.isP2P}
              showModal={showModal}
              className="mt-6 mb-4 mx-0"
            />
            <div className="grid grid-cols-1 items-start gap-4 mx-0 lg:grid-cols-2">
              <PanelSettingsPanel
                config={config}
                className="transition-width w-full"
                setting={pasteSetting}
                onSettingChange={setPasteSetting}
                nameAvailability={nameAvailability}
                footer={submitter}
              />
              {hasP2PPanel ? (
                <P2PTransferPanel
                  isLoading={isUploadPending}
                  response={p2p.response}
                  currentFile={p2p.currentFile}
                  status={p2p.status}
                  peers={p2p.peers}
                  iceServers={p2p.iceServers}
                  onCancel={onCancelUpload}
                  className="w-full"
                />
              ) : (
                hasUploadResultPanel && (
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
                    className="w-full"
                  />
                )
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
