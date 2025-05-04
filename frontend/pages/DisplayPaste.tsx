import React, { useEffect, useState } from "react"

import { Button, CircularProgress, Link, Tooltip } from "@heroui/react"
import binaryExtensions from "binary-extensions"

import { useErrorModal } from "../components/ErrorModal.js"
import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { DownloadIcon, HomeIcon } from "../components/icons.js"
import { CopyWidget } from "../components/CopyWidget.js"

import { parseFilenameFromContentDisposition, parsePath } from "../../shared/parsers.js"
import { decodeKey, decrypt, EncryptionScheme } from "../utils/encryption.js"
import { formatSize } from "../utils/utils.js"
import { tst } from "../utils/overrides.js"

import "../style.css"
import "../styles/highlight-theme-light.css"
import "../styles/highlight-theme-dark.css"
import { highlightHTML, useHLJS } from "../utils/HighlightLoader.js"

function isBinaryPath(path: string) {
  return binaryExtensions.includes(path.replace(/.*\./, ""))
}

export function DisplayPaste() {
  const [pasteFile, setPasteFile] = useState<File | undefined>(undefined)
  const [pasteContentBuffer, setPasteContentBuffer] = useState<ArrayBuffer | undefined>(undefined)
  const [pasteLang, setPasteLang] = useState<string | undefined>(undefined)

  const [isFileBinary, setFileBinary] = useState(false)
  const [isDecrypted, setDecrypted] = useState<"not encrypted" | "encrypted" | "decrypted">("not encrypted")
  const [forceShowBinary, setForceShowBinary] = useState(false)
  const showFileContent = pasteFile !== undefined && (!isFileBinary || forceShowBinary)

  const [isLoading, setIsLoading] = useState<boolean>(false)

  const { ErrorModal, showModal, handleFailedResp } = useErrorModal()
  const [_, modeSelection, setModeSelection] = useDarkModeSelection()
  const hljs = useHLJS()

  const pasteStringContent = pasteContentBuffer && new TextDecoder().decode(pasteContentBuffer)

  const highlightedHTML = pasteStringContent ? highlightHTML(hljs, pasteLang, pasteStringContent) : ""
  const pasteLineCount = (highlightedHTML?.match(/\n/g)?.length || 0) + 1

  // uncomment the following lines for testing
  // const url = new URL("http://localhost:8787/GQbf")
  const url = new URL(location.toString())

  const { name, ext, filename } = parsePath(url.pathname)

  useEffect(() => {
    const pasteUrl = `${API_URL}/${name}`

    const fetchPaste = async () => {
      try {
        setIsLoading(true)
        const resp = await fetch(pasteUrl)
        if (!resp.ok) {
          await handleFailedResp("Failed to Fetch Paste", resp)
          return
        }

        const scheme: EncryptionScheme | null = resp.headers.get("X-PB-Encryption-Scheme") as EncryptionScheme | null
        let filenameFromDisp = resp.headers.has("Content-Disposition")
          ? parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")!) || undefined
          : undefined
        if (filenameFromDisp && scheme !== null) {
          filenameFromDisp = filenameFromDisp.replace(/.encrypted$/, "")
        }

        const lang = url.searchParams.get("lang") || resp.headers.get("X-PB-Highlight-Language")

        const inferredFilename = filename || (ext && name + ext) || filenameFromDisp
        const respBytes = await resp.bytes()
        const isBinary = lang === null && inferredFilename !== undefined && isBinaryPath(inferredFilename)
        setPasteLang(lang || undefined)

        const keyString = url.hash.slice(1)
        if (scheme === null || keyString.length === 0) {
          setPasteFile(new File([respBytes], inferredFilename || name))
          setPasteContentBuffer(respBytes)
          if (scheme) {
            setDecrypted("encrypted")
            setFileBinary(true)
          } else {
            setFileBinary(isBinary)
          }
        } else {
          let key: CryptoKey | undefined
          try {
            key = await decodeKey(scheme, keyString)
          } catch {
            showModal("Error", `Failed to parse “${keyString}” as ${scheme} key`)
            return
          }
          if (key === undefined) {
            showModal("Error", `Failed to parse “${keyString}” as ${scheme} key`)
            return
          }

          const decrypted = await decrypt(scheme, key, respBytes)
          if (decrypted === null) {
            showModal("Error", "Failed to decrypt content")
            return
          }

          setPasteFile(new File([decrypted], inferredFilename || name))
          setPasteContentBuffer(decrypted)
          setPasteLang(lang || undefined)

          const isBinary = lang === null && inferredFilename !== undefined && isBinaryPath(inferredFilename)
          setFileBinary(isBinary)
          setDecrypted("decrypted")
        }
      } finally {
        setIsLoading(false)
      }
    }
    fetchPaste().catch((e) => {
      showModal(`Error on fetching ${pasteUrl}`, (e as Error).toString())
      console.error(e)
    })
  }, [])

  const binaryFileIndicator = pasteFile && (
    <div className="absolute top-[50%] left-[50%] translate-[-50%] flex flex-col items-center w-full">
      <div className="text-foreground-600 mb-2">{`${pasteFile?.name} (${formatSize(pasteFile.size)})`}</div>
      <div className="w-fit text-center">
        Possibly Binary file{" "}
        <button className="text-primary-500 inline" onClick={() => setForceShowBinary(true)}>
          (Click to show)
        </button>
      </div>
    </div>
  )

  const buttonClasses = `rounded-full bg-background hover:bg-default-100 ${tst}`
  return (
    <main
      className={`flex flex-col items-center min-h-screen transition-transform-background bg-background ${tst} text-foreground w-full p-2`}
    >
      <div className="w-full max-w-[64rem]">
        <div className="flex flex-row my-4 items-center justify-between">
          <h1 className="text-xl md:text-2xl grow inline-flex items-center">
            <Link href="/" className="text-foreground-500 text-[length:inherited]">
              <Button isIconOnly aria-label={INDEX_PAGE_TITLE} className={buttonClasses + " md:hidden"}>
                <HomeIcon className="size-6" />
              </Button>
              <span className="hidden md:inline">{INDEX_PAGE_TITLE}</span>
            </Link>
            <span className="mx-2">{" / "}</span>
            <code>{name}</code>
            <span className="ml-1">
              {isDecrypted === "decrypted" ? " (Decrypted)" : isDecrypted === "encrypted" ? " (Encrypted)" : ""}
            </span>
          </h1>
          {showFileContent && (
            <Tooltip content={`Copy to clipboard`}>
              <CopyWidget className={buttonClasses} getCopyContent={() => pasteStringContent!} />
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
          <DarkModeToggle modeSelection={modeSelection} setModeSelection={setModeSelection} />
        </div>
        <div className="my-4">
          <div className={`w-full bg-default-100 rounded-lg p-3 relative ${tst}`}>
            {isLoading ? (
              <div className={"h-[10em]"}>
                <CircularProgress
                  className="h-[10em] absolute top-[50%] left-[50%] translate-[-50%]"
                  label={"Loading..."}
                />
              </div>
            ) : (
              pasteFile && (
                <div className={showFileContent ? "" : "h-[10em]"}>
                  {showFileContent ? (
                    <>
                      <div className="text-foreground-600 mb-2 text-small flex flex-row gap-2">
                        <span>{pasteFile?.name}</span>
                        <span>{`(${formatSize(pasteFile.size)})`}</span>
                        {forceShowBinary && (
                          <button className="ml-2 text-primary-500" onClick={() => setForceShowBinary(false)}>
                            (Click to hide)
                          </button>
                        )}
                        {pasteLang && <span className={"grow text-right"}>{pasteLang}</span>}
                      </div>
                      <div className="font-mono relative" role="article">
                        <pre
                          style={{ paddingLeft: `${Math.floor(Math.log10(pasteLineCount)) + 2}em` }}
                          dangerouslySetInnerHTML={{ __html: highlightedHTML }}
                        />
                        <span
                          className={
                            "line-number-rows absolute pointer-events-none text-default-500 top-0 left-0 " +
                            "border-solid border-default-300 border-r-1"
                          }
                        >
                          {Array.from({ length: pasteLineCount }, (_, idx) => {
                            return <span key={idx} />
                          })}
                        </span>
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
      <ErrorModal />
    </main>
  )
}
