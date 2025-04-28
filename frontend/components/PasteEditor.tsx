import { Button, Card, CardBody, CardProps, Tab, Tabs, Textarea } from "@heroui/react"
import React from "react"
import { formatSize } from "../utils.js"

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

export function PasteEditor({ isPasteLoading, state, onStateChange, ...rest }: PasteEditorProps) {
  return (
    <Card {...rest}>
      <CardBody>
        <Tabs
          variant="underlined"
          classNames={{
            tabList: "ml-4 gap-6 w-full p-0 border-divider",
            cursor: "w-full",
            tab: "max-w-fit px-0 h-8",
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
              name="c"
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
            <Button radius="sm" color="primary" as="label">
              <input
                type="file"
                className="w-0 h-0 overflow-hidden absolute inline"
                onChange={(event) => {
                  const files = event.target.files
                  if (files && files.length) {
                    onStateChange({
                      ...state,
                      editKind: "file",
                      file: files[0],
                    })
                  }
                }}
              />
              Upload
            </Button>
            {displayFileInfo(state.file)}
          </Tab>
        </Tabs>
      </CardBody>
    </Card>
  )
}
