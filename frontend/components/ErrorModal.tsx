import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react"
import React from "react"

export type ErrorState = {
  title: string
  content: string
  isOpen: boolean
}

type ErrorModalProps = {
  onDismiss: () => void
  state: ErrorState
}

export function ErrorModal({ onDismiss, state }: ErrorModalProps) {
  return (
    <Modal
      isOpen={state.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss()
        }
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">{state.title}</ModalHeader>
        <ModalBody>
          <p>{state.content}</p>
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
