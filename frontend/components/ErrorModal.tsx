import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "./ui/index.js"
import type { ModalProps } from "./ui/index.js"
import React, { useState } from "react"
import { ErrorWithTitle } from "../utils/errors.js"

export interface ErrorState {
  title: string
  content: string
  isOpen: boolean
}

type ErrorModalProps = Partial<Omit<ModalProps, "children" | "isOpen" | "onClose">>

export function useErrorModal() {
  const [errorState, setErrorState] = useState<ErrorState>({ isOpen: false, content: "", title: "" })

  function showModal(title: string, content: string) {
    setErrorState({ title, content, isOpen: true })
  }

  async function handleFailedResp(defaultTitle: string, resp: Response) {
    const statusText = resp.statusText === "error" ? "Unknown error" : resp.statusText
    const errText = (await resp.text()) || statusText
    showModal(defaultTitle, errText)
  }

  function handleError(defaultTitle: string, error: Error) {
    console.error(error)
    if (error instanceof ErrorWithTitle) {
      showModal(error.title, error.message)
    } else {
      showModal(defaultTitle, error.message)
    }
  }

  const ErrorModal = ({ ...rest }: ErrorModalProps) => {
    const onClose = () => {
      setErrorState({ isOpen: false, content: "", title: "" })
    }
    return (
      <Modal isOpen={errorState.isOpen} onClose={onClose} {...rest}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">{errorState.title}</ModalHeader>
          <ModalBody>
            <p>{errorState.content}</p>
          </ModalBody>
          <ModalFooter>
            <Button color="danger" variant="light" onPress={onClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    )
  }

  return { ErrorModal, showModal, errorState, handleError, handleFailedResp }
}
