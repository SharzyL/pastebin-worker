import React, { useEffect, useState } from "react"

import { Button, Link } from "@heroui/react"

import { PasteResponse } from "../../shared/interfaces.js"
import { parsePath, parseFilenameFromContentDisposition } from "../../shared/parsers.js"

import { DarkModeToggle, DarkMode, defaultDarkMode, shouldBeDark } from "./DarkModeToggle.js"
import { ErrorModal, ErrorState } from "./ErrorModal.js"
import { PanelSettingsPanel, PasteSetting } from "./PasteSettingPanel.js"

import {
  verifyExpiration,
  verifyManageUrl,
  verifyName,
  maxExpirationReadable,
  BaseUrl,
  APIUrl,
} from "../utils/utils.js"

import "../style.css"
import { UploadedPanel } from "./UploadedPanel.js"
import { PasteEditor, PasteEditState } from "./PasteEditor.js"
import { genKey, encodeKey, encrypt, EncryptionScheme } from "../utils/encryption.js"

async function genAndEncrypt(scheme: EncryptionScheme, content: string | Uint8Array) {
  const key = await genKey(scheme)
  const plaintext = typeof content === "string" ? new TextEncoder().encode(content) : content
  const ciphertext = await encrypt(scheme, key, plaintext)
  return { key: await encodeKey(key), ciphertext }
}

export function PasteBin() {
  const encryptionScheme: EncryptionScheme = "AES-GCM"
  const [editorState, setEditorState] = useState<PasteEditState>({
    editKind: "edit",
    editContent: "",
    file: null,
  })

  const [pasteSetting, setPasteSetting] = useState<PasteSetting>({
    expiration: DEFAULT_EXPIRATION,
    manageUrl: "",
    name: "",
    password: "",
    uploadKind: "short",
    doEncrypt: false,
  })

  const [pasteResponse, setPasteResponse] = useState<PasteResponse | null>(null)
  const [uploadedEncryptionKey, setUploadedEncryptionKey] = useState<string | null>(null)

  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isPasteLoading, setIsPasteLoading] = useState<boolean>(false)

  const [errorState, setErrorState] = useState<ErrorState>({ isOpen: false, content: "", title: "" })

  const [darkModeSelect, setDarkModeSelect] = useState<DarkMode>(defaultDarkMode())

  function showModal(content: string, title: string) {
    setErrorState({ title, content, isOpen: true })
  }

  async function reportResponseError(resp: Response, title: string) {
    const statusText = resp.statusText === "error" ? "Unknown error" : resp.statusText
    const errText = (await resp.text()) || statusText
    showModal(errText, title)
  }

  // handle admin URL
  useEffect(() => {
    // TODO: do not fetch paste for a large file paste
    const pathname = location.pathname
    const { name, password, filename, ext } = parsePath(pathname)

    const fetchPaste = async () => {
      try {
        setIsPasteLoading(true)

        let pasteUrl = `${APIUrl}/${name}`
        if (filename) pasteUrl = `${pasteUrl}/${filename}`
        if (ext) pasteUrl = `${pasteUrl}${ext}`

        const resp = await fetch(pasteUrl)
        if (!resp.ok) {
          await reportResponseError(resp, `Error on fetching ${pasteUrl}`)
          return
        }
        const contentType = resp.headers.get("Content-Type")
        const contentDisp = resp.headers.get("Content-Disposition")

        if (contentType && contentType.startsWith("text/")) {
          setEditorState({
            editKind: "edit",
            editContent: await resp.text(),
            file: null,
          })
        } else {
          let pasteFilename = filename
          if (pasteFilename === undefined && contentDisp !== null) {
            pasteFilename = parseFilenameFromContentDisposition(contentDisp)
          }
          setEditorState({
            editKind: "file",
            editContent: "",
            file: new File([await resp.blob()], pasteFilename || "[unknown filename]"),
          })
        }
      } finally {
        setIsPasteLoading(false)
      }
    }
    if (password !== undefined && pasteSetting.manageUrl === "") {
      setPasteSetting({
        ...pasteSetting,
        uploadKind: "manage",
        manageUrl: `${APIUrl}/${name}:${password}`,
      })

      fetchPaste().catch(console.error)
    }
  }, [])

  async function uploadPaste(): Promise<void> {
    const fd = new FormData()
    if (editorState.editKind === "file") {
      if (editorState.file === null) {
        showModal("No file selected", "Error on preparing upload")
        return
      }
      if (pasteSetting.doEncrypt) {
        const { key, ciphertext } = await genAndEncrypt(encryptionScheme, await editorState.file.bytes())
        const file = new File([ciphertext], editorState.file.name)
        setUploadedEncryptionKey(key)
        fd.append("c", file)
        fd.append("encryption-scheme", encryptionScheme)
      } else {
        fd.append("c", editorState.file)
      }
    } else {
      if (editorState.editContent.length === 0) {
        showModal("Empty paste", "Error on preparing upload")
        return
      }
      if (pasteSetting.doEncrypt) {
        const { key, ciphertext } = await genAndEncrypt(encryptionScheme, editorState.editContent)
        setUploadedEncryptionKey(key)
        fd.append("c", new File([ciphertext], ""))
        fd.append("encryption-scheme", encryptionScheme)
      } else {
        fd.append("c", editorState.editContent)
      }
    }

    fd.append("e", pasteSetting.expiration)
    if (pasteSetting.password.length > 0) fd.append("s", pasteSetting.password)

    if (pasteSetting.uploadKind === "long") fd.append("p", "true")
    else if (pasteSetting.uploadKind === "custom") fd.append("n", pasteSetting.name)

    try {
      setIsLoading(true)
      setPasteResponse(null)
      const isUpdate = pasteSetting.uploadKind !== "manage"
      // TODO: add progress indicator
      const resp = isUpdate
        ? await fetch(APIUrl, {
            method: "POST",
            body: fd,
          })
        : await fetch(pasteSetting.manageUrl, {
            method: "PUT",
            body: fd,
          })
      if (resp.ok) {
        const respParsed = JSON.parse(await resp.text()) as PasteResponse
        setPasteResponse(respParsed)
        setIsLoading(false)
      } else {
        await reportResponseError(resp, `Error ${resp.status}`)
        // will setIsLoading(false) on closing modal
      }
    } catch (e) {
      showModal((e as Error).toString(), "Error on uploading paste")
      console.error(e)
    }
  }

  async function deletePaste() {
    try {
      const resp = await fetch(pasteSetting.manageUrl, {
        method: "DELETE",
      })
      if (resp.ok) {
        showModal("It may takes 60 seconds for the deletion to propagate to the world", "Deletion succeeded")
        setPasteResponse(null)
      } else {
        await reportResponseError(resp, `Error ${resp.status}`)
      }
    } catch (e) {
      showModal((e as Error).message, "Error on deleting paste")
      console.error(e)
    }
  }

  function canUpload(): boolean {
    if (editorState.editKind === "edit" && editorState.editContent.length === 0) {
      return false
    } else if (editorState.editKind === "file" && editorState.file === null) {
      return false
    }

    if (verifyExpiration(pasteSetting.expiration)[0]) {
      if (pasteSetting.uploadKind === "short" || pasteSetting.uploadKind === "long") {
        return true
      } else if (pasteSetting.uploadKind === "custom") {
        return verifyName(pasteSetting.name)[0]
      } else if (pasteSetting.uploadKind === "manage") {
        return verifyManageUrl(pasteSetting.manageUrl)[0]
      } else {
        return false
      }
    } else {
      return false
    }
  }

  function canDelete(): boolean {
    return verifyManageUrl(pasteSetting.manageUrl)[0]
  }

  const info = (
    <div className="mx-4 lg:mx-0">
      <div className="mt-8 mb-4 relative">
        <h1 className="text-3xl inline">{INDEX_PAGE_TITLE}</h1>
        <DarkModeToggle mode={darkModeSelect} onModeChange={setDarkModeSelect} className="absolute right-0" />
      </div>
      <p className="my-2">An open source pastebin deployed on Cloudflare Workers. </p>
      <p className="my-2">
        <b>Usage</b>: Paste text or file here; submit; share it with a URL. (
        <Link href={`${BaseUrl}/api`}>API Documentation</Link>)
      </p>
      <p className="my-2">
        <b>Warning</b>: Only for temporary share <b>(max {maxExpirationReadable})</b>. Files could be deleted without
        notice!
      </p>
    </div>
  )

  const submitter = (
    <div className="my-4 mx-2 lg:mx-0">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <Button color="primary" onPress={uploadPaste} className="mr-4" isDisabled={!canUpload() || isLoading}>
        {pasteSetting.uploadKind === "manage" ? "Update" : "Upload"}
      </Button>
      {pasteSetting.uploadKind === "manage" ? (
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        <Button color="danger" onPress={deletePaste} isDisabled={!canDelete()}>
          Delete
        </Button>
      ) : null}
    </div>
  )

  const footer = (
    <footer className="px-3 my-4 text-center">
      <p>
        <Link href={`${BaseUrl}/tos`} className="d-inline-block">
          Terms & Conditions
        </Link>
        {" / "}
        <Link href={REPO} className="d-inline-block">
          Repository
        </Link>
      </p>
    </footer>
  )

  return (
    <main
      className={
        "flex flex-col items-center min-h-screen font-sans transition-transform-background bg-background text-foreground" +
        (shouldBeDark(darkModeSelect) ? " dark" : " light")
      }
    >
      <div className="grow w-full max-w-[64rem]">
        {info}
        <PasteEditor
          isPasteLoading={isPasteLoading}
          state={editorState}
          onStateChange={setEditorState}
          className="mt-6 mb-4 mx-2 lg:mx-0"
        />
        <div className="flex flex-col items-start lg:flex-row gap-4 mx-2 lg:mx-0">
          <PanelSettingsPanel
            className={"transition-width ease-in-out lg:w-1/2 w-full"}
            setting={pasteSetting}
            onSettingChange={setPasteSetting}
          />
          {(pasteResponse || isLoading) && (
            <UploadedPanel
              pasteResponse={pasteResponse}
              encryptionKey={uploadedEncryptionKey}
              className="w-full lg:w-1/2"
            />
          )}
        </div>
        {submitter}
      </div>
      {footer}
      <ErrorModal
        onDismiss={() => {
          setIsPasteLoading(false)
          setIsLoading(false)
          setErrorState({ isOpen: false, content: "", title: "" })
        }}
        state={errorState}
      />
    </main>
  )
}
