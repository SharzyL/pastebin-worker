import { Card, CardBody, CardProps, Tab, Tabs } from "@heroui/react"
import React, { useRef, useState, DragEvent } from "react"
import { formatSize } from "../utils/utils.js"
import { XIcon } from "./icons.js"
import { cardOverrides, tst } from "../utils/overrides.js"
import { CodeEditor } from "./CodeEditor.js"

export type EditKind = "edit" | "file"

export type PasteEditState = {
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

  function setFile(file: File | null) {
    onStateChange({ ...state, editKind: "file", file })
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    const items = e.dataTransfer?.items
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          const file = items[i].getAsFile()!
          setFile(file)
          break
        }
      }
    }
    setDragged(false)
  }

  return (
    <Card aria-label="Pastebin editor panel" classNames={cardOverrides} {...rest}>
      <CardBody className={"relative"}>
        <Tabs
          variant="underlined"
          classNames={{
            tabList: `gap-2 w-full px-2 py-0 border-divider`,
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
              onDragOver={() => setDragged(true)}
              onClick={() => fileInput.current?.click()}
            >
              <input
                type="file"
                ref={fileInput}
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files
                  if (files && files.length) {
                    setFile(files[0])
                  }
                }}
              />
              <div className="text-2xl my-2 font-bold">Select File</div>
              <p className={`text-1xl text-foreground-500 ${tst} relative`}>
                <span>
                  {state.file !== null
                    ? `${state.file.name} (${formatSize(state.file.size)})`
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
