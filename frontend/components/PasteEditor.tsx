import { Button, Card, CardBody, CardProps, Tab, Tabs, Textarea } from "@heroui/react"
import React, { useRef, useState, DragEvent } from "react"
import { formatSize } from "../utils.js"
import { XIcon } from "../icons.js"

export type EditKind = "edit" | "file"

export type PasteEditState = {
  editKind: EditKind
  editContent: string
  file: File | null
}

interface PasteEditorProps extends CardProps {
  isPasteLoading: boolean
  state: PasteEditState
  onStateChange: (state: PasteEditState) => void
}

export function PasteEditor({ isPasteLoading, state, onStateChange, ...rest }: PasteEditorProps) {
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
          console.log(items)
          const file = items[i].getAsFile()!
          setFile(file)
          break
        }
      }
    }
    setDragged(false)
  }

  return (
    <Card aria-label="Pastebin editor panel" {...rest}>
      <CardBody>
        <Tabs
          variant="underlined"
          classNames={{
            tabList: "gap-2 w-full px-2 py-0 border-divider",
            cursor: "w-[80%]",
            tab: "max-w-fit px-2 h-8 px-2",
            panel: "pb-1",
          }}
          selectedKey={state.editKind}
          onSelectionChange={(k) => {
            onStateChange({ ...state, editKind: k as EditKind })
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
              aria-label="paste-edit"
              disableAutosize
              disableAnimation
              value={state.editContent}
              onValueChange={(k) => {
                onStateChange({ ...state, editContent: k })
              }}
              variant="faded"
              isRequired
            ></Textarea>
          </Tab>
          <Tab key="file" title="File">
            <div
              className={
                "w-full h-[20rem] rounded-xl flex flex-col items-center justify-center cursor-pointer relative" +
                (isDragged ? " bg-primary-100" : " bg-primary-50")
              }
              onDrop={onDrop}
              onDragEnter={() => setDragged(true)}
              onDragLeave={() => setDragged(false)}
              onDragOver={() => setDragged(true)}
              onClick={() => fileInput.current?.click()}
            >
              <input
                type="file"
                aria-label="paste-file"
                ref={fileInput}
                className="w-0 h-0 overflow-hidden absolute inline"
                onChange={(e) => {
                  const files = e.target.files
                  if (files && files.length) {
                    setFile(files[0])
                  }
                }}
              />
              <div className="text-2xl my-2 font-bold">Select File</div>
              <p className="text-1xl text-foreground-500 relative">
                <span>
                  {state.file !== null
                    ? `${state.file.name} (${formatSize(state.file.size)})`
                    : "Click or drag & drop file here"}
                </span>
              </p>
              {state.file && (
                <XIcon
                  className="h-6 inline absolute top-2 right-2 text-red-400"
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
