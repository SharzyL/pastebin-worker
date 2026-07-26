import { useCallback, useMemo, useReducer, useRef } from "react"
import type { P2PCreateResponse, P2PIceServer } from "../../../shared/interfaces.js"
import type { PasteEditState } from "../../components/PasteInputPanel.js"
import type { PasteSetting } from "../pasteSetting.js"
import type { P2PSenderFileInfo, P2PSenderPeerInfo, P2PSenderSession } from "./protocol.js"

export interface P2PUpdateSnapshot {
  editorState: PasteEditState
  expiration: string
  maxTransfers: string
  verifyTransfer: boolean
}

export function isSameP2PContent(left: PasteEditState, right: PasteEditState): boolean {
  if (left.editKind !== right.editKind) return false
  if (left.editKind === "edit") {
    return left.editContent === right.editContent && left.editFilename === right.editFilename
  }
  return left.files.length === right.files.length && left.files.every((file, index) => file === right.files[index])
}

export function createP2PUpdateSnapshot(editorState: PasteEditState, setting: PasteSetting): P2PUpdateSnapshot {
  return {
    editorState: { ...editorState, files: [...editorState.files] },
    expiration: setting.expiration,
    maxTransfers: setting.readLimit,
    verifyTransfer: setting.verifyP2P,
  }
}

export function isSameP2PUpdate(
  snapshot: P2PUpdateSnapshot,
  editorState: PasteEditState,
  setting: PasteSetting,
): boolean {
  return (
    isSameP2PContent(snapshot.editorState, editorState) &&
    snapshot.expiration === setting.expiration &&
    snapshot.maxTransfers === setting.readLimit &&
    snapshot.verifyTransfer === setting.verifyP2P
  )
}

interface SenderControllerState {
  response?: P2PCreateResponse
  status?: string
  peers: P2PSenderPeerInfo[]
  iceServers?: P2PIceServer[]
  currentFile?: P2PSenderFileInfo
  lastUpdate: P2PUpdateSnapshot | null
}

const initialState: SenderControllerState = {
  peers: [],
  lastUpdate: null,
}

type SenderControllerAction =
  | { type: "reset" }
  | { type: "status"; status?: string }
  | { type: "peers"; peers: P2PSenderPeerInfo[] }
  | { type: "ice-servers"; iceServers?: P2PIceServer[] }
  | {
      type: "connected"
      response: P2PCreateResponse
      currentFile: P2PSenderFileInfo
      lastUpdate: P2PUpdateSnapshot
    }
  | { type: "current-file"; currentFile: P2PSenderFileInfo }
  | { type: "last-update"; lastUpdate: P2PUpdateSnapshot }
  | { type: "room-updated"; expireAt: string; expirationSeconds: number }

function reducer(state: SenderControllerState, action: SenderControllerAction): SenderControllerState {
  switch (action.type) {
    case "reset":
      return initialState
    case "status":
      return { ...state, status: action.status }
    case "peers":
      return { ...state, peers: action.peers }
    case "ice-servers":
      return { ...state, iceServers: action.iceServers }
    case "connected":
      return {
        ...state,
        response: action.response,
        currentFile: action.currentFile,
        lastUpdate: action.lastUpdate,
        status: "Waiting for receiver...",
      }
    case "current-file":
      return { ...state, currentFile: action.currentFile }
    case "last-update":
      return { ...state, lastUpdate: action.lastUpdate }
    case "room-updated":
      return {
        ...state,
        response: state.response
          ? {
              ...state.response,
              expireAt: action.expireAt,
              expirationSeconds: action.expirationSeconds,
            }
          : undefined,
      }
  }
}

export function useP2PSenderController(onError: (error: Error) => void) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const sessionRef = useRef<P2PSenderSession | null>(null)

  const close = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    session?.close()
    dispatch({ type: "reset" })
  }, [])

  const dispose = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    session?.close()
  }, [])

  const attach = useCallback((session: P2PSenderSession, lastUpdate: P2PUpdateSnapshot) => {
    sessionRef.current = session
    dispatch({
      type: "connected",
      response: session.response,
      currentFile: session.currentFile,
      lastUpdate,
    })
  }, [])

  const callbacks = useMemo(
    () => ({
      onStatus: (status: string) => dispatch({ type: "status", status }),
      onPeersChange: (peers: P2PSenderPeerInfo[]) => dispatch({ type: "peers", peers }),
      onIceServersChange: (iceServers: P2PIceServer[] | undefined) => dispatch({ type: "ice-servers", iceServers }),
      onError,
    }),
    [onError],
  )

  return {
    ...state,
    sessionRef,
    callbacks,
    close,
    dispose,
    attach,
    isCurrent: (session: P2PSenderSession) => sessionRef.current === session,
    setCurrentFile: (currentFile: P2PSenderFileInfo) => dispatch({ type: "current-file", currentFile }),
    setLastUpdate: (lastUpdate: P2PUpdateSnapshot) => dispatch({ type: "last-update", lastUpdate }),
    updateRoom: (expireAt: string, expirationSeconds: number) =>
      dispatch({ type: "room-updated", expireAt, expirationSeconds }),
  }
}
