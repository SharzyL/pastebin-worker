import React, { useEffect, useRef, useState } from "react"
import { ErrorModal, ErrorState } from "./ErrorModal.js"
import { decodeKey, decrypt, EncryptionScheme } from "../utils/encryption.js"

import { Button, CircularProgress, Link, Tooltip } from "@heroui/react"
import { CheckIcon, CopyIcon, DownloadIcon, HomeIcon } from "./icons.js"

import "../style.css"
import { parseFilenameFromContentDisposition, parsePath } from "../../src/shared.js"
import { formatSize } from "../utils/utils.js"
import { DarkMode, DarkModeToggle, defaultDarkMode, shouldBeDark } from "./DarkModeToggle.js"
import binaryExtensions from "binary-extensions"

function isBinaryPath(path: string) {
  return binaryExtensions.includes(path.replace(/.*\./, ""))
}

export function DecryptPaste() {
  const [pasteFile, setPasteFile] = useState<File | undefined>(undefined)
  const [pasteContentBuffer, setPasteContentBuffer] = useState<ArrayBuffer | undefined>(undefined)

  const [isFileBinary, setFileBinary] = useState(false)
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

  // uncomment the following lines for testing
  // const url = new URL("http://localhost:8787/d/dHYQ.jpg.txt#uqeULsBTb2I3iC7rD6AaYh4oJ5lMjJA2nYR+H0U8bEA=")
  const url = location

  const { nameFromPath, ext, filename } = parsePath(url.pathname)
  const keyString = url.hash.slice(1)

  useEffect(() => {
    if (keyString.length === 0) {
      showModal("No encryption key is given. You should append the key after a “#” character in the URL", "Error")
    }
    const pasteUrl = `${API_URL}/${nameFromPath}`

    const fetchPaste = async () => {
      try {
        setIsLoading(true)
        const resp = await fetch(pasteUrl)
        if (!resp.ok) {
          await reportResponseError(resp, `Error on fetching ${pasteUrl}`)
          return
        }

        const scheme: EncryptionScheme = (resp.headers.get("X-Encryption-Scheme") as EncryptionScheme) || "AES-GCM"
        let key: CryptoKey | undefined
        try {
          key = await decodeKey(scheme, keyString)
        } catch {
          showModal(`Failed to parse “${keyString}” as ${scheme} key`, "Error")
          return
        }
        if (key === undefined) {
          showModal(`Failed to parse “${keyString}” as ${scheme} key`, "Error")
          return
        }

        const decrypted = await decrypt(scheme, key, await resp.bytes())
        if (decrypted === null) {
          showModal("Failed to decrypt content", "Error")
        } else {
          const filenameFromDispTrimmed = resp.headers.has("Content-Disposition")
            ? parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")!)?.replace(
                /.encrypted$/g,
                "",
              ) || undefined
            : undefined

          const inferredFilename = filename || (ext && nameFromPath + ext) || filenameFromDispTrimmed || nameFromPath
          setPasteFile(new File([decrypted], inferredFilename))
          setPasteContentBuffer(decrypted)
          setFileBinary(isBinaryPath(inferredFilename))
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
        Possibly Binary file{" "}
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

  const showFileContent = pasteFile && (!isFileBinary || forceShowBinary)

  const buttonClasses = "rounded-full bg-background hover:bg-gray-100"
  return (
    <main
      className={
        "flex flex-col items-center min-h-screen bg-background text-foreground w-full p-2" +
        (shouldBeDark(darkModeSelect) ? " dark" : " light")
      }
    >
      <div className="w-full max-w-[64rem]">
        <div className="flex flex-row my-4 items-center justify-between">
          <h1 className="text-xl md:text-2xl grow inline-flex items-center">
            <Link href="/" className="text-foreground-500 text-[length:inherited]">
              <Button isIconOnly aria-label="Home" className={buttonClasses + " md:hidden"}>
                <HomeIcon className="size-6" />
              </Button>
              <span className="hidden md:inline">{INDEX_PAGE_TITLE}</span>
            </Link>
            <span className="mx-2">{" / "}</span>
            <code>{nameFromPath}</code>
            <span className="ml-1">{isLoading ? " (Loading…)" : pasteFile ? " (Decrypted)" : ""}</span>
          </h1>
          {showFileContent && (
            <Tooltip content={`Copy to clipboard`}>
              <Button isIconOnly aria-label="Copy" className={buttonClasses} onPress={onCopy}>
                {hasIssuedCopies ? <CheckIcon className="size-6" /> : <CopyIcon className="size-6" />}
              </Button>
            </Tooltip>
          )}
          {pasteFile && (
            <Tooltip content={`Download as file`}>
              <Button aria-label="Download" isIconOnly className={buttonClasses}>
                <a href={URL.createObjectURL(pasteFile)}>
                  <DownloadIcon className="size-6 inline" />
                </a>
              </Button>
            </Tooltip>
          )}
          <DarkModeToggle mode={darkModeSelect} onModeChange={setDarkModeSelect} className={buttonClasses} />
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
