import type { CardProps } from "./ui/index.js"
import { Card, CardBody, Tab, Tabs } from "./ui/index.js"
import type { DragEvent } from "react"
import { useRef, useState } from "react"
import { formatSize } from "../utils/utils.js"
import { XIcon } from "./icons.js"
import { cardOverrides, tst } from "../utils/overrides.js"
import { CodeEditor } from "./CodeEditor.js"

export type EditKind = "edit" | "file"

export interface PasteEditState {
  editKind: EditKind
  editContent: string
  editFilename?: string
  editHighlightLang?: string
  file: File | null
}

interface PasteEditorProps extends CardProps {
  isPasteLoading: boolean
  state: PasteEditState
  onStateChange: (state: PasteEditState) => void
}

export function PasteInputPanel({ isPasteLoading, state, onStateChange, ...rest }: PasteEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [isDragged, setDragged] = useState<boolean>(false)
  const [isEditDragged, setEditDragged] = useState<boolean>(false)

  function setFile(file: File | null) {
    onStateChange({ ...state, editKind: "file", file })
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    const items = e.dataTransfer?.items
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile()!
          setFile(file)
          break
        }
      }
    }
    setDragged(false)
    setEditDragged(false)
  }

  return (
    <Card aria-label="Pastebin editor panel" classNames={cardOverrides} {...rest}>
      <CardBody className={"relative"}>
        <Tabs
          variant="underlined"
          classNames={{
            tabList: `gap-2 w-full py-0 border-divider mb-2 -ml-1`,
            cursor: `w-[80%] ${tst}`,
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
              <input
                type="file"
                ref={fileInput}
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files
                  if (files?.length) {
                    setFile(files[0])
                  }
                }}
              />
              <div className="text-2xl my-2 font-bold px-4 text-center break-all">
                {state.file !== null ? state.file.name : "Select File"}
              </div>
              <p className={`text-1xl text-foreground-500 ${tst} relative`}>
                <span>
                  {state.file !== null
                    ? `${formatSize(state.file.size)} · Click or drag to replace`
                    : "Click or drag & drop file here"}
                </span>
              </p>
              {state.file && (
                <XIcon
                  aria-label="Remove file"
                  role="button"
                  className={`h-6 inline absolute top-2 right-2 text-red-400 ${tst}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFile(null)
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
