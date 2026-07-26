import type { CardProps } from "./ui/index.js"
import { Card, CardBody, Tab, Tabs } from "./ui/index.js"
import type { DragEvent } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { formatSize, verifyFileSize } from "../utils/utils.js"
import { XIcon } from "./icons.js"
import { cardOverrides, tst } from "../utils/overrides.js"
import { CodeEditor } from "./CodeEditor.js"
import { FileTree } from "./FileTree.js"
import { itemCountLabel } from "../../shared/format.js"
import type { PublicEnv } from "../../shared/interfaces.js"

export type EditKind = "edit" | "file"

export interface PasteEditState {
  editKind: EditKind
  editContent: string
  editFilename?: string
  editHighlightLang?: string
  files: File[]
}

interface FileSystemEntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  isFile: true
  isDirectory: false
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void
}

interface FileSystemDirectoryReaderLike {
  readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: DOMException) => void) => void
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  isFile: false
  isDirectory: true
  createReader: () => FileSystemDirectoryReaderLike
}

type TransferFileRecord = { kind: "entry"; entry: FileSystemEntryLike } | { kind: "file"; file: File }

class FileCollectionCancelledError extends Error {
  constructor() {
    super("File collection was superseded.")
    this.name = "FileCollectionCancelledError"
  }
}

function ensureCollectionActive(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new FileCollectionCancelledError()
}

function fileWithPath(file: File, path: string): File {
  if (file.name === path) return file
  return new File([file], path, { type: file.type, lastModified: file.lastModified })
}

function emptyFolderFile(path: string): File {
  return new File([new Uint8Array(0)], path)
}

function pathJoin(parentPath: string, name: string): string {
  return `${parentPath}${name}`
}

function readFileEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readDirectoryBatch(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function readAllDirectoryEntries(
  entry: FileSystemDirectoryEntryLike,
  isCurrent: () => boolean,
): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader()
  const entries: FileSystemEntryLike[] = []

  while (true) {
    ensureCollectionActive(isCurrent)
    const batch = await readDirectoryBatch(reader)
    ensureCollectionActive(isCurrent)
    if (batch.length === 0) break
    entries.push(...batch)
  }

  return entries
}

async function filesFromEntry(
  entry: FileSystemEntryLike,
  parentPath = "",
  isCurrent: () => boolean = () => true,
): Promise<File[]> {
  ensureCollectionActive(isCurrent)
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntryLike)
    ensureCollectionActive(isCurrent)
    return [fileWithPath(file, pathJoin(parentPath, file.name))]
  }

  if (entry.isDirectory) {
    const directoryPath = `${pathJoin(parentPath, entry.name)}/`
    const children = await readAllDirectoryEntries(entry as FileSystemDirectoryEntryLike, isCurrent)
    if (children.length === 0) return [emptyFolderFile(directoryPath)]

    const nestedFiles = await Promise.all(children.map((child) => filesFromEntry(child, directoryPath, isCurrent)))
    ensureCollectionActive(isCurrent)
    return nestedFiles.flat()
  }

  return []
}

function transferRecordsFromDataTransferItems(items: DataTransferItemList | undefined): TransferFileRecord[] {
  if (!items) return []
  const records: TransferFileRecord[] = []

  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue

    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry?.()
    if (entry) {
      records.push({ kind: "entry", entry })
      continue
    }

    const file = item.getAsFile()
    if (file) records.push({ kind: "file", file })
  }

  return records
}

async function filesFromTransferRecords(records: TransferFileRecord[], isCurrent: () => boolean): Promise<File[]> {
  ensureCollectionActive(isCurrent)
  const files = await Promise.all(
    records.map((record) =>
      record.kind === "entry" ? filesFromEntry(record.entry, "", isCurrent) : Promise.resolve([record.file]),
    ),
  )
  ensureCollectionActive(isCurrent)
  return files.flat()
}

function filesFromFileList(files: FileList | null | undefined): File[] {
  if (!files) return []
  return Array.from(files).map((file) => {
    const path = file.webkitRelativePath || file.name
    return fileWithPath(file, path)
  })
}

function isPasteEditorFocused(): boolean {
  const activeElement = document.activeElement
  return (
    activeElement instanceof HTMLTextAreaElement ||
    (activeElement instanceof HTMLInputElement && !activeElement.readOnly)
  )
}

function totalFileSize(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0)
}

interface PasteEditorProps extends CardProps {
  isPasteLoading: boolean
  state: PasteEditState
  onStateChange: (state: PasteEditState) => void
  config: PublicEnv
  skipFileSizeLimit?: boolean
  showModal: (title: string, content: string) => void
}

export function PasteInputPanel({
  isPasteLoading,
  state,
  onStateChange,
  config,
  skipFileSizeLimit = false,
  showModal,
  ...rest
}: PasteEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [isDragged, setDragged] = useState<boolean>(false)
  const [isEditDragged, setEditDragged] = useState<boolean>(false)
  const [isCollectingFiles, setIsCollectingFiles] = useState<boolean>(false)
  const collectionGeneration = useRef(0)

  useEffect(() => {
    return () => {
      collectionGeneration.current += 1
    }
  }, [])

  const resetFileInput = useCallback(() => {
    if (fileInput.current) fileInput.current.value = ""
  }, [])

  const setFiles = useCallback(
    (files: File[]) => {
      const totalSize = totalFileSize(files)
      if (!skipFileSizeLimit) {
        const [totalOk, totalMsg] = verifyFileSize(totalSize, config)
        if (!totalOk) {
          showModal(files.length > 1 ? "Pastes too large" : "Paste too large", totalMsg)
          resetFileInput()
          return
        }
      }

      onStateChange({ ...state, editKind: "file", files })
    },
    [config, onStateChange, resetFileInput, showModal, skipFileSizeLimit, state],
  )

  const collectAndSetFiles = useCallback(
    async (records: TransferFileRecord[]) => {
      if (records.length === 0) return

      const generation = collectionGeneration.current + 1
      collectionGeneration.current = generation
      const isCurrent = () => collectionGeneration.current === generation
      setIsCollectingFiles(true)
      try {
        const files = await filesFromTransferRecords(records, isCurrent)
        if (isCurrent() && files.length > 0) setFiles(files)
      } catch (error) {
        if (!isCurrent()) return
        if (error instanceof FileCollectionCancelledError) return
        const message = error instanceof Error ? error.message : "The selected files could not be read."
        showModal("Could not read files", message)
        resetFileInput()
      } finally {
        if (isCurrent()) setIsCollectingFiles(false)
      }
    },
    [resetFileInput, setFiles, showModal],
  )

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (isPasteEditorFocused()) return

      const records = transferRecordsFromDataTransferItems(e.clipboardData?.items)
      if (records.length === 0) return

      e.preventDefault()
      void collectAndSetFiles(records)
    }

    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [collectAndSetFiles])

  function onDrop(e: DragEvent) {
    e.preventDefault()
    const records = transferRecordsFromDataTransferItems(e.dataTransfer?.items)
    if (records.length > 0) {
      void collectAndSetFiles(records)
    } else {
      const files = filesFromFileList(e.dataTransfer?.files)
      if (files.length > 0) {
        collectionGeneration.current += 1
        setFiles(files)
      }
    }
    setDragged(false)
    setEditDragged(false)
  }

  const shouldShowFileTree = state.files.length > 1 || state.files.some((file) => file.name.includes("/"))

  return (
    <Card aria-label="Pastebin editor panel" classNames={cardOverrides} {...rest}>
      <CardBody className={"relative"}>
        <input
          type="file"
          ref={fileInput}
          className="hidden"
          onChange={(e) => {
            const files = filesFromFileList(e.target.files)
            if (files.length > 0) {
              collectionGeneration.current += 1
              setFiles(files)
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
                  <div className="text-2xl my-2 font-bold">Drop files or folders here</div>
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
                {isCollectingFiles
                  ? "Reading files..."
                  : state.files.length === 0
                    ? "Select Files"
                    : state.files.length === 1
                      ? state.files[0].name.includes("/")
                        ? `${itemCountLabel(state.files.length)} selected`
                        : state.files[0].name
                      : `${itemCountLabel(state.files.length)} selected`}
              </div>
              <p className={`text-1xl text-foreground-500 ${tst} relative`}>
                <span>
                  {state.files.length > 0
                    ? `${formatSize(totalFileSize(state.files))} · Click or drag or paste to replace`
                    : "Click or drag & drop or paste files here"}
                </span>
              </p>
              {shouldShowFileTree && (
                <div
                  className="mt-3 max-h-48 overflow-auto text-sm text-foreground-600 w-full max-w-[32rem] px-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FileTree files={state.files.map((file) => ({ name: file.name, sizeBytes: file.size }))} />
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
