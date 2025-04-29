import React, { useEffect, useRef, useState } from "react"
import { ErrorModal, ErrorState } from "./ErrorModal.js"
import { decodeKey, decrypt } from "../utils/encryption.js"

import { Button, CircularProgress, Link, Tooltip } from "@heroui/react"
import { CheckIcon, CopyIcon, DownloadIcon } from "./icons.js"

import "../style.css"
import { parseFilenameFromContentDisposition, parsePath } from "../../src/shared.js"
import { formatSize } from "../utils/utils.js"
import { DarkMode, DarkModeToggle, defaultDarkMode, shouldBeDark } from "./DarkModeToggle.js"

export function DecryptPaste() {
  const [pasteFile, setPasteFile] = useState<File | undefined>(undefined)
  const [pasteContentBuffer, setPasteContentBuffer] = useState<ArrayBuffer | undefined>(undefined)
  const [forceShowBinary, setForceShowBinary] = useState(false)

  const [isLoading, setIsLoading] = useState<boolean>(false)

  const [errorState, setErrorState] = useState<ErrorState>({ isOpen: false, content: "", title: "" })

  function showModal(content: string, title: string) {
    setErrorState({ title, content, isOpen: true })
  }

  async function reportResponseError(resp: Response, title: string) {
    const statusText = resp.statusText === "error" ? "Unknown error" : resp.statusText
    const errText = (await resp.text()) || statusText
    showModal(errText, title)
  }

  const { nameFromPath } = parsePath(location.pathname)
  const keyString = location.hash.slice(1)
  // const url = new URL("http://localhost:8787/e/dSGT#TkHRDZ4CD3UQPqjY71cuwd_yE3NpEEr_CtzF0wu32jA=")
  // const nameFromPath = url.pathname.slice(3)
  // const keyString = url.hash.slice(1)

  useEffect(() => {
    const pasteUrl = `${API_URL}/${nameFromPath}`

    const fetchPaste = async () => {
      const scheme = "AES-GCM"
      let key: CryptoKey | undefined
      try {
        key = await decodeKey(scheme, keyString)
      } catch {
        showModal(`Failed to parse “${keyString}” as key`, "Error")
        return
      }
      if (key === undefined) {
        showModal(`Failed to parse “${keyString}” as key`, "Error")
        return
      }

      try {
        setIsLoading(true)
        const resp = await fetch(pasteUrl)
        if (!resp.ok) {
          await reportResponseError(resp, `Error on fetching ${pasteUrl}`)
          return
        }

        const decrypted = await decrypt(scheme, key, await resp.bytes())
        if (decrypted === null) {
          showModal("Failed to decrypt content", "Error")
        } else {
          const filename = resp.headers.has("Content-Disposition")
            ? parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")!) || ""
            : ""
          const type = resp.headers.has("Content-Type")
            ? resp.headers.get("Content-Type")!.replace(/;.*/, "")
            : undefined
          setPasteFile(new File([decrypted], filename, { type }))
          setPasteContentBuffer(decrypted)
        }
      } finally {
        setIsLoading(false)
      }
    }
    fetchPaste().catch((e) => {
      showModal((e as Error).toString(), `Error on fetching ${pasteUrl}`)
      console.error(e)
    })
  }, [])

  const fileIndicator = pasteFile && (
    <div className="text-foreground-600 mb-2 text-small">
      {`${pasteFile?.name} (${formatSize(pasteFile.size)})`}
      {forceShowBinary && (
        <button className="ml-2 text-primary-500" onClick={() => setForceShowBinary(false)}>
          (Click to hide)
        </button>
      )}
    </div>
  )

  const binaryFileIndicator = pasteFile && (
    <div className="absolute top-[50%] left-[50%] translate-[-50%] flex flex-col items-center">
      <div className="text-foreground-600 mb-2">{`${pasteFile?.name} (${formatSize(pasteFile.size)})`}</div>
      <div>
        Binary file{" "}
        <button className="text-primary-500" onClick={() => setForceShowBinary(true)}>
          (Click to show)
        </button>
      </div>
    </div>
  )

  const [darkModeSelect, setDarkModeSelect] = useState<DarkMode>(defaultDarkMode())

  const numOfIssuedCopies = useRef(0)
  const [hasIssuedCopies, setHasIssuedCopies] = useState<boolean>(false)
  const onCopy = () => {
    navigator.clipboard
      .writeText(new TextDecoder().decode(pasteContentBuffer))
      .then(() => {
        numOfIssuedCopies.current = numOfIssuedCopies.current + 1
        setHasIssuedCopies(numOfIssuedCopies.current > 0)

        setTimeout(() => {
          numOfIssuedCopies.current = numOfIssuedCopies.current - 1
          setHasIssuedCopies(numOfIssuedCopies.current > 0)
        }, 1000)
      })
      .catch(console.error)
  }

  const showFileContent = pasteFile && (!pasteFile.name || forceShowBinary)

  return (
    <main
      className={
        "flex flex-col items-center min-h-screen bg-background text-foreground" +
        (shouldBeDark(darkModeSelect) ? " dark" : " light")
      }
    >
      <div className="w-full max-w-[64rem]">
        <div className="flex flex-row my-4 items-center justify-between">
          <h1 className="text-2xl inline grow">
            <Link href="/" className="text-2xl text-foreground-500 mr-1">
              {INDEX_PAGE_TITLE + " / "}
            </Link>
            <code>{nameFromPath}</code> (decrypted)
          </h1>
          {showFileContent && (
            <Tooltip content={`Copy to clipboard`}>
              <Button isIconOnly aria-label="Copy" className="mr-2 rounded-full bg-background" onPress={onCopy}>
                {hasIssuedCopies ? <CheckIcon className="size-6 inline" /> : <CopyIcon className="size-6 inline" />}
              </Button>
            </Tooltip>
          )}
          {pasteFile && (
            <Tooltip content={`Download as file`}>
              <Button aria-label="Download" isIconOnly className="rounded-full bg-background">
                <a href={URL.createObjectURL(pasteFile)}>
                  <DownloadIcon className="size-6 inline mr-2" />
                </a>
              </Button>
            </Tooltip>
          )}
          <DarkModeToggle mode={darkModeSelect} onModeChange={setDarkModeSelect} className="" />
        </div>
        <div className="my-4">
          <div className="min-h-[30rem] w-full bg-secondary-50 rounded-lg p-3 relative">
            {isLoading ? (
              <CircularProgress className="absolute top-[50%] left-[50%] translate-[-50%]" />
            ) : (
              pasteFile && (
                <div>
                  {showFileContent ? (
                    <>
                      {fileIndicator}
                      <div className="font-mono whitespace-pre-wrap" role="article">
                        {new TextDecoder().decode(pasteContentBuffer)}
                      </div>
                    </>
                  ) : (
                    binaryFileIndicator
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>
      <ErrorModal
        onDismiss={() => {
          setErrorState({ isOpen: false, content: "", title: "" })
        }}
        state={errorState}
      />
    </main>
  )
}
