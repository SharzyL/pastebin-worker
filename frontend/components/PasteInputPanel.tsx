import type { CardProps } from "./ui/index.js"
import { Card, CardBody, Tab, Tabs } from "./ui/index.js"
import type { DragEvent } from "react"
import { useRef, useState } from "react"
import { formatSize, verifyFileSize } from "../utils/utils.js"
import { XIcon } from "./icons.js"
import { cardOverrides, tst } from "../utils/overrides.js"
import { CodeEditor } from "./CodeEditor.js"
import { FullscreenToggle } from "./FullscreenToggle.js"
import { useFullscreen } from "../utils/useFullscreen.js"

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
  config: Env
  showModal: (title: string, content: string) => void
  // overrides the deployment's R2_MAX_ALLOWED
  maxFileSize?: number
  // Ctrl+Enter (Cmd+Enter on macOS) in the editor
  onCtrlEnter?: () => void
}

export function PasteInputPanel({
  isPasteLoading,
  state,
  onStateChange,
  config,
  showModal,
  maxFileSize,
  onCtrlEnter,
  className,
  ...rest
}: PasteEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [isDragged, setDragged] = useState<boolean>(false)
  const [isEditDragged, setEditDragged] = useState<boolean>(false)

  // The whole card (tabs included) expands over the viewport; the toggle sits
  // in its top right corner either way. Every layer down to the editor or the
  // drop zone becomes a column flex that passes the height on.
  const [isFullscreen, setFullscreen] = useFullscreen()
  const fill = isFullscreen ? "flex-1 min-h-0 flex flex-col" : ""

  function setFile(file: File | null) {
    if (file) {
      const [ok, msg] = verifyFileSize(file.size, config, maxFileSize)
      if (!ok) {
        showModal("File too large", msg)
        // also reset the underlying input so picking the same file again re-triggers onChange
        if (fileInput.current) fileInput.current.value = ""
        return
      }
    }
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
    <div className={isFullscreen ? `fixed inset-0 z-50 flex flex-col bg-background p-3 ${tst}` : "contents"}>
      <Card
        aria-label="Pastebin editor panel"
        classNames={cardOverrides}
        className={isFullscreen ? fill : className}
        {...rest}
      >
        <CardBody className={`relative ${fill}`}>
          <FullscreenToggle
            isFullscreen={isFullscreen}
            onToggle={() => setFullscreen(!isFullscreen)}
            className="absolute top-2 right-3 z-10"
          />
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
          <Tabs
            variant="underlined"
            classNames={{
              base: fill,
              // room on the right for the fullscreen toggle
              tabList: `gap-2 w-full py-0 border-divider mb-2 -ml-1 pr-8`,
              cursor: tst,
              tab: `max-w-fit px-2 h-8 px-2`,
              panel: `pb-1 ${fill}`,
            }}
            selectedKey={state.editKind}
            onSelectionChange={(k) => {
              onStateChange({ ...state, editKind: k as EditKind })
              if (k === "file") fileInput.current?.click()
            }}
          >
            {/*Possibly a bug of chrome, but Tab sometimes has a transient unexpected scrollbar when resizing*/}
            <Tab key={"edit"} title="Edit" className={`overflow-hidden ${fill}`}>
              <div
                className={`relative ${fill}`}
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
                  onCtrlEnter={onCtrlEnter}
                  isFullscreen={isFullscreen}
                  onLeaveFullscreen={() => setFullscreen(false)}
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
            <Tab key="file" title="File" className={fill}>
              <div
                className={
                  `w-full rounded-xl flex flex-col items-center justify-center cursor-pointer relative ${tst}` +
                  (isFullscreen ? " flex-1 min-h-0" : " h-[20rem]") +
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
    </div>
  )
}
