import { useEffect, useRef, useState, useTransition } from "react"

import { Link } from "../components/ui/index.js"

import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { useErrorModal } from "../components/ErrorModal.js"
import type { PasteSetting } from "../components/PasteSettingPanel.js"
import { PanelSettingsPanel } from "../components/PasteSettingPanel.js"
import { UploadedPanel } from "../components/UploadedPanel.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { PasteInputPanel } from "../components/PasteInputPanel.js"

import type { PasteResponse } from "../../shared/interfaces.js"
import { parsePath, parseFilenameFromContentDisposition } from "../../shared/parsers.js"
import { PASSWD_SEP, MAX_URL_REDIRECT_LEN } from "../../shared/constants.js"

import { verifyExpiration, verifyManageUrl, getMaxExpirationReadable } from "../utils/utils.js"
import { verifyName, verifyPassword, isLegalUrl } from "../../shared/verify.js"
import { useNameAvailability } from "../utils/useNameAvailability.js"
import type { UploadProgress } from "../utils/uploader.js"
import { uploadPaste } from "../utils/uploader.js"
import { tst } from "../utils/overrides.js"

import "../style.css"

export function PasteBin({ config }: { config: Env }) {
  const [editorState, setEditorState] = useState<PasteEditState>({
    editKind: "edit",
    editContent: "",
    file: null,
    editHighlightLang: "plaintext",
  })

  const [pasteSetting, setPasteSetting] = useState<PasteSetting>({
    expiration: config.DEFAULT_EXPIRATION,
    manageUrl: "",
    name: "",
    password: "",
    uploadKind: "short",
    doEncrypt: false,
  })

  const [pasteResponse, setPasteResponse] = useState<PasteResponse | undefined>(undefined)
  const [uploadedEncryptionKey, setUploadedEncryptionKey] = useState<string | undefined>(undefined)

  const [isUploadPending, startUpload] = useTransition()
  const [loadingProgress, setLoadingProgress] = useState<UploadProgress | undefined>(undefined)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [isInitPasteLoading, startFetchingInitPaste] = useTransition()

  const [_, modeSelection, setModeSelection] = useDarkModeSelection()

  const { ErrorModal, showModal, handleError, handleFailedResp } = useErrorModal()

  const nameAvailability = useNameAvailability(
    pasteSetting.name,
    config.DEPLOY_URL,
    pasteSetting.uploadKind === "custom",
  )

  // handle admin URL
  useEffect(() => {
    // SSR environment check
    if (typeof window === "undefined") return

    // TODO: do not fetch paste for a large file paste
    const pathname = location.pathname
    // const pathname = new URL("http://localhost:8787/ds2W:ShNkSKdf5rZypdcJEcAdFmw3").pathname
    if (!pathname.includes(PASSWD_SEP)) return
    const { name, password, filename, ext } = parsePath(pathname)

    if (password !== undefined && pasteSetting.manageUrl === "") {
      setPasteSetting({
        ...pasteSetting,
        uploadKind: "manage",
        manageUrl: `${config.DEPLOY_URL}/${name}:${password}`,
      })

      let pasteUrl = `${config.DEPLOY_URL}/${name}`
      if (filename) pasteUrl = `${pasteUrl}/${filename}`
      if (ext) pasteUrl = `${pasteUrl}${ext}`

      startFetchingInitPaste(async () => {
        try {
          const resp = await fetch(pasteUrl)
          if (!resp.ok) {
            await handleFailedResp(`Error on Fetching ${pasteUrl}`, resp)
            return
          }
          const contentType = resp.headers.get("Content-Type")
          const contentDisp = resp.headers.get("Content-Disposition")
          const contentLang = resp.headers.get("X-PB-Highlight-Language")

          let pasteFilename = filename
          if (pasteFilename === undefined && contentDisp !== null) {
            pasteFilename = parseFilenameFromContentDisposition(contentDisp)
          }

          if (contentLang || contentType?.startsWith("text/")) {
            setEditorState({
              editKind: "edit",
              editContent: await resp.text(),
              file: null,
              editHighlightLang: contentLang || undefined,
              editFilename: pasteFilename,
            })
          } else {
            setEditorState({
              editKind: "file",
              editContent: "",
              file: new File([await resp.blob()], pasteFilename || "[unknown filename]"),
            })
          }
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
        const uploaded = await uploadPaste(
          pasteSetting,
          editorState,
          setUploadedEncryptionKey,
          config,
          setLoadingProgress,
          controller.signal,
        )
        setPasteResponse(uploaded)
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
    // TODO: also call a worker /mpu/abort endpoint to free orphaned R2 parts
  }

  function onStartDelete() {
    startUpload(async () => {
      try {
        const resp = await fetch(pasteSetting.manageUrl, { method: "DELETE" })
        if (resp.ok) {
          showModal("Deleted Successfully", "It may takes 60 seconds for the deletion to propagate to the world")
          setPasteResponse(undefined)
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
    } else if (editorState.editKind === "file" && editorState.file === null) {
      return false
    }

    if (!verifyPassword(pasteSetting.password)[0]) {
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
  const uploadDisabled = !canUpload() || isUploadPending
  const deleteDisabled = !canDelete()

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
      <div className="grow w-full max-w-[64rem]">
        {info}
        <PasteInputPanel
          isPasteLoading={isInitPasteLoading}
          state={editorState}
          onStateChange={setEditorState}
          config={config}
          showModal={showModal}
          className="mt-6 mb-4 mx-2 lg:mx-0"
        />
        <div className="flex flex-col items-start lg:flex-row gap-4 mx-2 lg:mx-0">
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
      {footer}
      <ErrorModal />
    </main>
  )
}
