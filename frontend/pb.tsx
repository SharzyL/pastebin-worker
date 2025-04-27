import React, { useEffect, useState } from "react"

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Input,
  Link,
  Radio,
  RadioGroup,
  Skeleton,
  Snippet,
  Tab,
  Tabs,
  Textarea,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalFooter,
  Tooltip,
} from "@heroui/react"

import { PasteResponse, parsePath, parseFilenameFromContentDisposition } from "../src/shared.js"

import {
  verifyExpiration,
  verifyManageUrl,
  verifyName,
  formatSize,
  maxExpirationReadable,
  BaseUrl,
  APIUrl,
} from "./utils.js"

import "./style.css"
import { computerIcon, moonIcon, sunIcon } from "./icons.js"

type EditKind = "edit" | "file"
type UploadKind = "short" | "long" | "custom" | "manage"
type DarkMode = "dark" | "light" | "system"

function defaultDarkMode(): DarkMode {
  const storedDarkModeSelect = localStorage.getItem("darkModeSelect")
  if (storedDarkModeSelect !== null && ["light", "dark", "system"].includes(storedDarkModeSelect)) {
    return storedDarkModeSelect as DarkMode
  } else {
    return "system"
  }
}

export function PasteBin() {
  const [editKind, setEditKind] = useState<EditKind>("edit")
  const [pasteEdit, setPasteEdit] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  const [expiration, setExpiration] = useState(DEFAULT_EXPIRATION)
  const [password, setPassword] = useState("")
  const [customName, setCustomName] = useState("")
  const [manageUrl, setManageUrl] = useState("")
  const [uploadKind, setUploadKind] = useState<UploadKind>("short")

  const [pasteResponse, setPasteResponse] = useState<PasteResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isPasteLoading, setIsPasteLoading] = useState<boolean>(false)

  const [isModalOpen, setModalOpen] = useState(false)
  const [modalErrMsg, setModalErrMsg] = useState("")
  const [modalErrTitle, setModalErrTitle] = useState("")

  const [darkModeSelect, setDarkModeSelect] = useState<DarkMode>(defaultDarkMode())

  // when matchMedia not available (e.g. in tests), set to light mode
  const systemDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  const isDark = darkModeSelect === "system" ? systemDark : darkModeSelect === "dark"

  function showErrorMsg(err: string, title: string) {
    setModalErrMsg(err)
    setModalErrTitle(title)
    setModalOpen(true)
  }

  async function reportResponseError(resp: Response, title: string) {
    const statusText = resp.statusText === "error" ? "Unknown error" : resp.statusText
    const errText = (await resp.text()) || statusText
    showErrorMsg(errText, title)
  }

  const errorModal = (
    <Modal
      isOpen={isModalOpen}
      onOpenChange={(open) => {
        setModalOpen(open)
        if (!open) {
          setIsPasteLoading(false)
          setIsLoading(false)
        }
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">{modalErrTitle}</ModalHeader>
        <ModalBody>
          <p>{modalErrMsg}</p>
        </ModalBody>
        <ModalFooter>
          <Button color="danger" variant="light" onPress={() => setModalOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )

  useEffect(() => {
    localStorage.setItem("darkModeSelect", darkModeSelect)
  }, [darkModeSelect])

  // handle admin URL
  useEffect(() => {
    const pathname = location.pathname
    const { nameFromPath, passwd, filename, ext } = parsePath(pathname)

    const fetchPaste = async () => {
      try {
        setIsPasteLoading(true)

        let pasteUrl = `${APIUrl}/${nameFromPath}`
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
          setEditKind("edit")
          const t = await resp.text()
          setPasteEdit(t)
        } else {
          setEditKind("file")
          let pasteFilename = filename
          if (pasteFilename === undefined && contentDisp !== null) {
            pasteFilename = parseFilenameFromContentDisposition(contentDisp)
          }
          setUploadFile(new File([await resp.blob()], pasteFilename || "[unknown filename]"))
        }
      } finally {
        setIsPasteLoading(false)
      }
    }
    if (passwd !== undefined && manageUrl === "") {
      setUploadKind("manage")
      setManageUrl(`${APIUrl}/${nameFromPath}:${passwd}`)

      fetchPaste().catch(console.error)
    }
  }, [])

  function displayFileInfo(file: File | null) {
    if (file === null) {
      return null
    } else {
      return (
        <span className="ml-4">
          <code>{file.name}</code> ({formatSize(file.size)})
        </span>
      )
    }
  }

  async function uploadPaste(): Promise<void> {
    const fd = new FormData()
    if (editKind === "file") {
      if (uploadFile === null) {
        showErrorMsg("No file selected", "Error on preparing upload")
        return
      }
      fd.append("c", uploadFile)
    } else {
      if (pasteEdit.length === 0) {
        showErrorMsg("Empty paste", "Error on preparing upload")
        return
      }
      fd.append("c", pasteEdit)
    }

    fd.append("e", expiration)
    if (password.length > 0) fd.append("s", password)

    if (uploadKind === "long") fd.append("p", "true")
    else if (uploadKind === "custom") fd.append("n", customName)

    try {
      setIsLoading(true)
      setPasteResponse(null)
      const isUpdate = uploadKind !== "manage"
      const resp = isUpdate
        ? await fetch(APIUrl, {
            method: "POST",
            body: fd,
          })
        : await fetch(manageUrl, {
            method: "PUT",
            body: fd,
          })
      if (resp.ok) {
        const respParsed = JSON.parse(await resp.text()) as PasteResponse
        setPasteResponse(respParsed)
      } else {
        await reportResponseError(resp, `Error ${resp.status}`)
      }
    } catch (e) {
      showErrorMsg((e as Error).toString(), "Error on uploading paste")
      console.error(e)
    }
  }

  async function deletePaste() {
    try {
      const resp = await fetch(manageUrl, {
        method: "DELETE",
      })
      if (resp.ok) {
        setPasteResponse(null)
      } else {
        await reportResponseError(resp, `Error ${resp.status}`)
      }
    } catch (e) {
      showErrorMsg((e as Error).message, "Error on deleting paste")
      console.error(e)
    }
  }

  const iconsMap = new Map([
    ["system", computerIcon],
    ["dark", moonIcon],
    ["light", sunIcon],
  ])
  const toggleDarkModeButton = (
    <Tooltip content="Toggle Dark Mode">
      <span
        className="absolute right-0"
        data-testid="pastebin-darkmode-toggle"
        onClick={() => {
          if (darkModeSelect === "system") {
            setDarkModeSelect("dark")
          } else if (darkModeSelect === "dark") {
            setDarkModeSelect("light")
          } else {
            setDarkModeSelect("system")
          }
        }}
      >
        {iconsMap.get(darkModeSelect)}
      </span>
    </Tooltip>
  )

  const info = (
    <div className="mx-4 lg:mx-0">
      <h1 className="text-3xl mt-8 mb-4 relative">
        {INDEX_PAGE_TITLE} {toggleDarkModeButton}
      </h1>
      <p className="my-2">This is an open source pastebin deployed on Cloudflare Workers. </p>
      <p className="my-2">
        <b>Usage</b>: paste any text here, submit, then share it with URL. (
        <Link href={`${BaseUrl}/api`}>API Documentation</Link>)
      </p>
      <p className="my-2">
        <b>Warning</b>: Only for temporary share <b>(max {maxExpirationReadable})</b>. Files could be deleted without
        notice!
      </p>
    </div>
  )

  const editor = (
    <Card className="mt-6 mb-4 mx-2 lg:mx-0">
      <CardBody>
        <Tabs
          variant="underlined"
          classNames={{
            tabList: "ml-4 gap-6 w-full p-0 border-divider",
            cursor: "w-full",
            tab: "max-w-fit px-0 h-8",
          }}
          selectedKey={editKind}
          onSelectionChange={(k) => {
            setEditKind(k as EditKind)
          }}
        >
          <Tab key={"edit"} title="Edit">
            <Textarea
              isClearable
              data-testid="pastebin-edit"
              placeholder={isPasteLoading ? "Loading..." : "Edit your paste here"}
              isDisabled={isPasteLoading}
              className="px-0 py-0"
              classNames={{
                input: "resize-y min-h-[30em] font-mono",
              }}
              name="c"
              disableAutosize
              disableAnimation
              value={pasteEdit}
              onValueChange={setPasteEdit}
              variant="faded"
              isRequired
            ></Textarea>
          </Tab>
          <Tab key="file" title="File">
            <Button radius="sm" color="primary" as="label">
              <input
                type="file"
                className="w-0 h-0 overflow-hidden absolute inline"
                onChange={(event) => {
                  const files = event.target.files
                  if (files && files.length) {
                    setEditKind("file")
                    setUploadFile(files[0])
                  }
                }}
              />
              Upload
            </Button>
            {displayFileInfo(uploadFile)}
          </Tab>
        </Tabs>
      </CardBody>
    </Card>
  )

  const setting = (
    <Card className={"transition-width ease-in-out lg:w-1/2 w-full"}>
      <CardHeader className="text-2xl">Settings</CardHeader>
      <Divider />
      <CardBody>
        <div className="gap-4 mb-6 flex flex-row">
          <Input
            type="text"
            label="Expiration"
            className="basis-80"
            defaultValue="7d"
            value={expiration}
            isRequired
            onValueChange={setExpiration}
            isInvalid={!verifyExpiration(expiration)[0]}
            errorMessage={verifyExpiration(expiration)[1]}
            description={verifyExpiration(expiration)[1]}
          />
          <Input
            type="password"
            label="Password"
            value={password}
            onValueChange={setPassword}
            placeholder={"Generated randomly"}
            description="Used to update/delete your paste"
          />
        </div>
        <RadioGroup
          className="gap-4 mb-2 w-full"
          value={uploadKind}
          onValueChange={(v) => setUploadKind(v as UploadKind)}
        >
          <Radio value="short" description={`Example: ${BaseUrl}/BxWH`}>
            Generate a short random URL
          </Radio>
          <Radio
            value="long"
            description={`Example: ${BaseUrl}/5HQWYNmjA4h44SmybeThXXAm`}
            classNames={{
              description: "text-ellipsis max-w-[calc(100vw-5rem)] whitespace-nowrap overflow-hidden",
            }}
          >
            Generate a long random URL
          </Radio>
          <Radio value="custom" description={`Example: ${BaseUrl}/~stocking`}>
            Set by your own
          </Radio>
          {uploadKind === "custom" ? (
            <Input
              value={customName}
              onValueChange={setCustomName}
              type="text"
              className="shrink"
              isInvalid={!verifyName(customName)[0]}
              errorMessage={verifyName(customName)[1]}
              startContent={
                <div className="pointer-events-none flex items-center">
                  <span className="text-default-500 text-small w-max">{`${BaseUrl}/~`}</span>
                </div>
              }
            />
          ) : null}
          <Radio value="manage">
            <div className="">Update or delete</div>
          </Radio>
          {uploadKind === "manage" ? (
            <Input
              value={manageUrl}
              onValueChange={setManageUrl}
              type="text"
              className="shrink"
              isInvalid={!verifyManageUrl(manageUrl)[0]}
              errorMessage={verifyManageUrl(manageUrl)[1]}
              placeholder={`Manage URL`}
            />
          ) : null}
        </RadioGroup>
      </CardBody>
    </Card>
  )

  const snippetClassNames = {
    pre: "overflow-scroll leading-[2.5]",
    base: "w-full py-2/3",
    copyButton: "relative ml-[-12pt] left-[5pt]",
  }
  const firstColClassNames = "w-[7rem] whitespace-nowrap"
  const uploaded = () => (
    <Card className="w-full lg:w-1/2">
      <CardHeader className="text-2xl">Uploaded Paste</CardHeader>
      <Divider />
      <CardBody>
        <table className="border-spacing-2 border-separate table-fixed w-full">
          <tbody>
            <tr>
              <td className={firstColClassNames}>Paste URL</td>
              <td className="w-full">
                <Skeleton isLoaded={pasteResponse !== null} className="rounded-2xl grow">
                  <Snippet hideSymbol variant="bordered" classNames={snippetClassNames}>
                    {pasteResponse?.url}
                  </Snippet>
                </Skeleton>
              </td>
            </tr>
            <tr>
              <td className={firstColClassNames}>Manage URL</td>
              <td className="w-full overflow-hidden">
                <Skeleton isLoaded={pasteResponse !== null} className="rounded-2xl grow">
                  <Snippet hideSymbol variant="bordered" classNames={snippetClassNames}>
                    {pasteResponse?.manageUrl}
                  </Snippet>
                </Skeleton>
              </td>
            </tr>
            {pasteResponse?.suggestedUrl ? (
              <tr>
                <td className={firstColClassNames}>Suggested URL</td>
                <td className="w-full">
                  <Snippet hideSymbol variant="bordered" classNames={snippetClassNames}>
                    {pasteResponse?.suggestedUrl}
                  </Snippet>
                </td>
              </tr>
            ) : null}
            <tr>
              <td className={firstColClassNames}>Expire At</td>
              <td className="w-full py-2">
                <Skeleton isLoaded={pasteResponse !== null} className="rounded-2xl">
                  {pasteResponse && new Date(pasteResponse.expireAt).toLocaleString()}
                </Skeleton>
              </td>
            </tr>
          </tbody>
        </table>
      </CardBody>
    </Card>
  )

  function canUpload(): boolean {
    if (editKind === "edit" && pasteEdit.length === 0) {
      return false
    } else if (editKind === "file" && uploadFile === null) {
      return false
    }

    if (verifyExpiration(expiration)[0]) {
      if (uploadKind === "short" || uploadKind === "long") {
        return true
      } else if (uploadKind === "custom") {
        return verifyName(customName)[0]
      } else if (uploadKind === "manage") {
        return verifyManageUrl(manageUrl)[0]
      } else {
        return false
      }
    } else {
      return false
    }
  }

  function canDelete(): boolean {
    return verifyManageUrl(manageUrl)[0]
  }

  const submitter = (
    <div className="my-4 mx-2 lg:mx-0">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <Button color="primary" onPress={uploadPaste} className="mr-4" isDisabled={!canUpload()}>
        {uploadKind === "manage" ? "Update" : "Upload"}
      </Button>
      {uploadKind === "manage" ? (
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
      data-testid="pastebin-main"
      className={
        "flex flex-col items-center min-h-screen font-sans bg-background text-foreground" +
        (isDark ? " dark" : " light")
      }
    >
      <div className="grow w-full max-w-[64rem]">
        {info}
        {editor}
        <div className="flex flex-col items-start lg:flex-row gap-4 mx-2 lg:mx-0">
          {setting}
          {(pasteResponse || isLoading) && uploaded()}
        </div>
        {submitter}
      </div>
      {footer}
      {errorModal}
    </main>
  )
}
