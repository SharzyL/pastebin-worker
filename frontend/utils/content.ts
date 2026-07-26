import { DEFAULT_EDIT_FILENAME, TEXT_MIME_TYPE } from "../../shared/constants.js"
import type { OriginalFileInfo } from "../../shared/interfaces.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { ErrorWithTitle } from "./errors.js"

export interface PreparedContent {
  content: File
  originalFiles?: OriginalFileInfo[]
  cleanup?: () => Promise<void>
}

export interface PrepareContentOptions {
  errorTitle?: string
  signal?: AbortSignal
}

function shouldZipFiles(files: File[]): boolean {
  return files.length > 1 || files.some((file) => file.name.includes("/"))
}

export async function prepareContent(
  editorState: PasteEditState,
  { errorTitle = "Error on Preparing Content", signal }: PrepareContentOptions = {},
): Promise<PreparedContent> {
  signal?.throwIfAborted()

  if (editorState.editKind === "edit") {
    if (editorState.editContent.length === 0) {
      throw new ErrorWithTitle(errorTitle, "Empty paste")
    }
    return {
      content: new File([editorState.editContent], editorState.editFilename || DEFAULT_EDIT_FILENAME, {
        type: TEXT_MIME_TYPE,
      }),
    }
  }

  if (editorState.files.length === 0) {
    throw new ErrorWithTitle(errorTitle, "No file selected")
  }
  if (!shouldZipFiles(editorState.files)) return { content: editorState.files[0] }

  const originalFiles = editorState.files.map((file) => ({ name: file.name, sizeBytes: file.size }))
  const { zipFiles } = await import("./archive.js")
  const archive = await zipFiles(editorState.files, { signal })
  return { content: archive.file, originalFiles, cleanup: archive.cleanup }
}
