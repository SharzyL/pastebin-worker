import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react"
import React from "react"

type ErrorModalProps = {
  onDismiss: () => void
  isOpen: boolean
  title: string
  content: string
}

export function ErrorModal({ onDismiss, title, content, isOpen }: ErrorModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss()
        }
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">{title}</ModalHeader>
        <ModalBody>
          <p>{content}</p>
        </ModalBody>
        <ModalFooter>
          <Button color="danger" variant="light" onPress={() => onDismiss()}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
