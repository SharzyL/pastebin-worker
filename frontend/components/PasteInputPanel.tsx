import type { CardProps } from "./ui/index.js"
import { Card, CardBody, Tab, Tabs } from "./ui/index.js"
import type { DragEvent } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { formatSize, verifyFileSize } from "../utils/utils.js"
import { XIcon } from "./icons.js"
import { cardOverrides, tst } from "../utils/overrides.js"
import { CodeEditor } from "./CodeEditor.js"

export type EditKind = "edit" | "file"

export interface PasteEditState {
  editKind: EditKind
  editContent: string
  editFilename?: string
  editHighlightLang?: string
  files: File[]
}

function filesFromDataTransferItems(items: DataTransferItemList | undefined): File[] {
  if (!items) return []
  return Array.from(items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

function isPasteEditorFocused(): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLTextAreaElement || (activeElement instanceof HTMLInputElement && !activeElement.readOnly)
}

function totalFileSize(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0)
}

interface PasteEditorProps extends CardProps {
  isPasteLoading: boolean
  state: PasteEditState
  onStateChange: (state: PasteEditState) => void
  config: Env
  showModal: (title: string, content: string) => void
}

export function PasteInputPanel({
  isPasteLoading,
  state,
  onStateChange,
  config,
  showModal,
  ...rest
}: PasteEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [isDragged, setDragged] = useState<boolean>(false)
  const [isEditDragged, setEditDragged] = useState<boolean>(false)

  const resetFileInput = useCallback(() => {
    if (fileInput.current) fileInput.current.value = ""
  }, [])

  const setFiles = useCallback((files: File[]) => {
    const totalSize = totalFileSize(files)
    const [totalOk, totalMsg] = verifyFileSize(totalSize, config)
    if (!totalOk) {
      showModal(files.length > 1 ? "Files too large" : "File too large", totalMsg)
      resetFileInput()
      return
    }

    onStateChange({ ...state, editKind: "file", files })
  }, [config, onStateChange, resetFileInput, showModal, state])

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (isPasteEditorFocused()) return

      const files = filesFromDataTransferItems(e.clipboardData?.items)
      if (files.length === 0) return

      e.preventDefault()
      setFiles(files)
    }

    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [setFiles])

  function onDrop(e: DragEvent) {
    e.preventDefault()
    const files = filesFromDataTransferItems(e.dataTransfer?.items)
    if (files.length > 0) setFiles(files)
    setDragged(false)
    setEditDragged(false)
  }

  return (
    <Card aria-label="Pastebin editor panel" classNames={cardOverrides} {...rest}>
      <CardBody className={"relative"}>
        <input
          type="file"
          ref={fileInput}
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            if (files?.length) {
              setFiles(Array.from(files))
            }
          }}
          multiple
        />
        <Tabs
          variant="underlined"
          classNames={{
            tabList: `gap-2 w-full py-0 border-divider mb-2 -ml-1`,
            cursor: tst,
            tab: `max-w-fit px-2 h-8 px-2`,
            panel: "pb-1",
          }}
          selectedKey={state.editKind}
          onSelectionChange={(k) => {
            onStateChange({ ...state, editKind: k as EditKind })
          }}
        >
          {/*Possibly a bug of chrome, but Tab sometimes has a transient unexpected scrollbar when resizing*/}
          <Tab key={"edit"} title="Edit" className={"overflow-hidden"}>
            <div
              className="relative"
              onDrop={onDrop}
              onDragEnter={(e) => {
                e.preventDefault()
                setEditDragged(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setEditDragged(true)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setEditDragged(false)
                }
              }}
            >
              <CodeEditor
                content={state.editContent}
                setContent={(k) => onStateChange({ ...state, editContent: k })}
                lang={state.editHighlightLang}
                setLang={(lang) => onStateChange({ ...state, editHighlightLang: lang })}
                filename={state.editFilename}
                setFilename={(name) => onStateChange({ ...state, editFilename: name })}
                disabled={isPasteLoading}
                placeholder={isPasteLoading ? "Loading..." : "Edit your paste here"}
              />
              {isEditDragged && (
                <div
                  className={
                    `absolute inset-0 rounded-xl flex flex-col items-center justify-center ` +
                    `bg-primary-100 pointer-events-none ${tst}`
                  }
                  aria-hidden="true"
                >
                  <div className="text-2xl my-2 font-bold">Drop file here</div>
                  <p className="text-1xl text-foreground-500">Release to upload as file</p>
                </div>
              )}
            </div>
          </Tab>
          <Tab key="file" title="File">
            <div
              className={
                `w-full h-[20rem] rounded-xl flex flex-col items-center justify-center cursor-pointer relative ${tst}` +
                (isDragged ? " bg-primary-100" : " bg-primary-50")
              }
              role="button"
              aria-label="Select file"
              onDrop={onDrop}
              onDragEnter={() => setDragged(true)}
              onDragLeave={() => setDragged(false)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragged(true)
              }}
              onClick={() => fileInput.current?.click()}
            >
              <div className="text-2xl my-2 font-bold px-4 text-center break-all">
                {state.files.length === 0
                  ? "Select Files"
                  : state.files.length === 1
                    ? state.files[0].name
                    : `${state.files.length} files selected`}
              </div>
              <p className={`text-1xl text-foreground-500 ${tst} relative`}>
                <span>
                  {state.files.length > 0
                    ? `${formatSize(totalFileSize(state.files))} · Click or drag or paste to replace`
                    : "Click or drag & drop or paste files here"}
                </span>
              </p>
              {state.files.length > 1 && (
                <div className="mt-3 max-h-32 overflow-auto text-sm text-foreground-600 w-full max-w-[32rem] px-4">
                  {state.files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex justify-between gap-4">
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0">{formatSize(file.size)}</span>
                    </div>
                  ))}
                </div>
              )}
              {state.files.length > 0 && (
                <XIcon
                  aria-label="Remove file"
                  role="button"
                  className={`h-6 inline absolute top-2 right-2 text-red-400 ${tst}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFiles([])
                    resetFileInput()
                  }}
                />
              )}
            </div>
          </Tab>
        </Tabs>
      </CardBody>
    </Card>
  )
}
