import { useEffect, useState } from "react"
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "./ui/index.js"
import { formatSize } from "../utils/utils.js"

export interface PastedFile {
  file: File
  // how many files the clipboard held; only the first is used
  count: number
}

interface PasteFileConfirmModalProps {
  pasted: PastedFile | null
  // the file already selected, which the pasted one would replace
  currentFile: File | null
  onConfirm: (file: File) => void
  onCancel: () => void
}

// Browsers name every pasted screenshot "image.png"; give it a name that tells
// one paste from another, like "pasted-20261125-153012.png".
export function renamePastedFile(file: File, now: Date = new Date()): File {
  const m = /^image\.(\w+)$/.exec(file.name)
  if (!m) return file
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return new File([file], `pasted-${stamp}.${m[1]}`, { type: file.type, lastModified: file.lastModified })
}

function useObjectUrl(file: File | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!file?.type.startsWith("image/") || typeof URL.createObjectURL !== "function") {
      setUrl(undefined)
      return
    }
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url
}

export function PasteFileConfirmModal({ pasted, currentFile, onConfirm, onCancel }: PasteFileConfirmModalProps) {
  const file = pasted?.file
  const previewUrl = useObjectUrl(file)

  return (
    <Modal isOpen={pasted !== null} onClose={onCancel}>
      <ModalContent role="dialog" aria-modal="true" aria-label="Use pasted file">
        <ModalHeader>Use pasted file?</ModalHeader>
        {/* items-center keeps the image at its own aspect ratio, so its corners round */}
        {file && (
          <ModalBody className="flex flex-col items-center gap-2 text-center">
            {previewUrl && (
              <img src={previewUrl} alt="Pasted image preview" className="max-w-full max-h-48 rounded-lg" />
            )}
            <div>
              <p className="text-foreground break-all font-medium">{file.name}</p>
              <p>
                {formatSize(file.size)}
                {file.type && ` · ${file.type}`}
              </p>
            </div>
            {currentFile && <p>This replaces the selected file {currentFile.name}.</p>}
            {pasted.count > 1 && <p>The clipboard holds {pasted.count} files; only the first is used.</p>}
          </ModalBody>
        )}
        <ModalFooter>
          <Button variant="ghost" onPress={onCancel}>
            Cancel
          </Button>
          <Button variant="solid" autoFocus onPress={() => file && onConfirm(file)}>
            Use as paste
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
