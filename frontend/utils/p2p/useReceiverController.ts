import { useCallback, useReducer, useRef } from "react"
import type { PublicEnv } from "../../../shared/interfaces.js"
import type {
  P2PConnectionRoute,
  P2PFileMeta,
  P2PProgress,
  P2PReceiverSession,
  P2PTransferHistoryItem,
} from "./protocol.js"

export interface P2PReceivedFileContext {
  isCurrent: () => boolean
  highlightLanguage?: string
  setCanPreview: (canPreview: boolean) => void
  setStatus: (status: string | undefined) => void
}

interface ReceiverControllerOptions {
  onFile: (file: File, context: P2PReceivedFileContext) => void | Promise<void>
  onError: (error: Error) => void
  onStartError?: (error: Error) => void
  onTransferLimitReached?: () => void
  onRoomAvailable?: () => void
  onAcceptUpdate?: () => void
}

interface ReceiverControllerState {
  isMode: boolean
  status?: string
  connectionRoute?: P2PConnectionRoute
  meta?: P2PFileMeta
  updateMeta?: P2PFileMeta
  transferHistory: P2PTransferHistoryItem[]
  progress?: P2PProgress
  file?: File
  canPreviewFile: boolean
  isPaused: boolean
  isPausing: boolean
  isReconnecting: boolean
  isAcceptingUpdate: boolean
}

const initialState: ReceiverControllerState = {
  isMode: false,
  transferHistory: [],
  canPreviewFile: false,
  isPaused: false,
  isPausing: false,
  isReconnecting: false,
  isAcceptingUpdate: false,
}

type ReceiverControllerAction =
  | { type: "start"; status?: string }
  | { type: "patch"; patch: Partial<ReceiverControllerState> }
  | { type: "meta"; meta: P2PFileMeta }
  | { type: "archive-and-accept"; archived?: P2PTransferHistoryItem }

function reducer(state: ReceiverControllerState, action: ReceiverControllerAction): ReceiverControllerState {
  switch (action.type) {
    case "start":
      return { ...initialState, isMode: true, status: action.status }
    case "patch":
      return { ...state, ...action.patch }
    case "meta":
      return { ...state, meta: action.meta, isAcceptingUpdate: false }
    case "archive-and-accept": {
      const transferHistory =
        action.archived && !state.transferHistory.some((transfer) => transfer.id === action.archived!.id)
          ? [...state.transferHistory, action.archived]
          : state.transferHistory
      return {
        ...state,
        transferHistory,
        status: undefined,
        meta: undefined,
        file: undefined,
        canPreviewFile: false,
        progress: undefined,
        isPaused: false,
        isPausing: false,
        isAcceptingUpdate: true,
      }
    }
  }
}

export function useP2PReceiverController(name: string, config: PublicEnv, options: ReceiverControllerOptions) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const optionsRef = useRef(options)
  optionsRef.current = options
  const sessionRef = useRef<P2PReceiverSession | null>(null)
  const sessionIdRef = useRef(0)
  const fileGenerationRef = useRef(0)
  const metaRef = useRef<P2PFileMeta | undefined>(undefined)
  const transferHistorySequenceRef = useRef(0)
  const startRef = useRef<(status?: string) => Promise<void>>(() => Promise.resolve())

  const setStatus = useCallback((status: string | undefined) => {
    dispatch({ type: "patch", patch: { status } })
  }, [])

  const setCanPreview = useCallback((canPreviewFile: boolean) => {
    dispatch({ type: "patch", patch: { canPreviewFile } })
  }, [])

  const start = useCallback(
    async (initialStatus?: string): Promise<void> => {
      sessionRef.current?.close()
      sessionRef.current = null
      const sessionId = sessionIdRef.current + 1
      sessionIdRef.current = sessionId
      fileGenerationRef.current += 1
      metaRef.current = undefined
      transferHistorySequenceRef.current = 0
      const isCurrentSession = () => sessionIdRef.current === sessionId
      dispatch({ type: "start", status: initialStatus })

      const receiverModule = await import("../p2pReceiver.js").catch((error: unknown) => {
        if (isCurrentSession()) {
          optionsRef.current.onStartError?.(error instanceof Error ? error : new Error(String(error)))
        }
        return null
      })
      if (!receiverModule || !isCurrentSession()) return

      sessionRef.current = receiverModule.startP2PReceiver(name, config, {
        onStatus: (status) => {
          if (isCurrentSession()) dispatch({ type: "patch", patch: { status } })
        },
        onConnectionRouteChange: (connectionRoute) => {
          if (isCurrentSession()) dispatch({ type: "patch", patch: { connectionRoute } })
        },
        onMeta: (meta) => {
          if (!isCurrentSession()) return
          metaRef.current = meta
          dispatch({ type: "meta", meta })
        },
        onUpdateAvailable: (updateMeta) => {
          if (!isCurrentSession()) return
          dispatch({
            type: "patch",
            patch: {
              updateMeta,
              ...(updateMeta ? {} : { isAcceptingUpdate: false }),
            },
          })
        },
        onProgress: (progress) => {
          if (isCurrentSession()) dispatch({ type: "patch", patch: { progress } })
        },
        onPausedChange: (isPaused) => {
          if (isCurrentSession()) dispatch({ type: "patch", patch: { isPaused } })
        },
        onPausePendingChange: (isPausing) => {
          if (isCurrentSession()) dispatch({ type: "patch", patch: { isPausing } })
        },
        onReconnectingChange: (isReconnecting) => {
          if (isCurrentSession()) dispatch({ type: "patch", patch: { isReconnecting } })
        },
        onFile: (file) => {
          if (!isCurrentSession()) return
          const generation = fileGenerationRef.current + 1
          fileGenerationRef.current = generation
          const isCurrent = () => isCurrentSession() && fileGenerationRef.current === generation
          dispatch({ type: "patch", patch: { file, canPreviewFile: false } })
          void Promise.resolve(
            optionsRef.current.onFile(file, {
              isCurrent,
              highlightLanguage: metaRef.current?.highlightLanguage,
              setCanPreview,
              setStatus,
            }),
          ).catch((error: unknown) => {
            if (isCurrent()) optionsRef.current.onError(error instanceof Error ? error : new Error(String(error)))
          })
        },
        onAbandoned: () => {
          if (isCurrentSession()) void startRef.current("Transfer abandoned. Starting a new session...")
        },
        onTransferLimitReached: () => {
          if (isCurrentSession()) optionsRef.current.onTransferLimitReached?.()
        },
        onRoomAvailabilityChange: (joinable) => {
          if (isCurrentSession() && joinable) optionsRef.current.onRoomAvailable?.()
        },
        onError: (error) => {
          if (isCurrentSession()) optionsRef.current.onError(error)
        },
      })
    },
    [config, name, setCanPreview, setStatus],
  )
  startRef.current = start

  const dispose = useCallback(() => {
    sessionIdRef.current += 1
    fileGenerationRef.current += 1
    metaRef.current = undefined
    const session = sessionRef.current
    sessionRef.current = null
    session?.close()
  }, [])

  const acceptUpdate = useCallback(() => {
    const session = sessionRef.current
    const current = stateRef.current
    if (!session || !current.updateMeta || current.isAcceptingUpdate) return

    let archived: P2PTransferHistoryItem | undefined
    if (current.meta) {
      const id = current.meta.revision || `p2p-transfer-${transferHistorySequenceRef.current++}`
      const isComplete = current.file !== undefined
      archived = {
        id,
        meta: current.meta,
        status: isComplete ? current.status || "Transfer complete." : "Transfer stopped for a newer version.",
        transferStatus: isComplete ? "DONE" : "STOPPED",
        connectionRoute: current.connectionRoute,
        progress: current.progress ? { ...current.progress, speedBytesPerSecond: 0 } : undefined,
        file: current.file,
      }
    }

    fileGenerationRef.current += 1
    metaRef.current = undefined
    dispatch({ type: "archive-and-accept", archived })
    optionsRef.current.onAcceptUpdate?.()
    session.acceptUpdate()
  }, [])

  const captureFileGuard = useCallback(() => {
    const generation = fileGenerationRef.current
    return () => fileGenerationRef.current === generation
  }, [])

  return {
    ...state,
    start,
    dispose,
    acceptUpdate,
    captureFileGuard,
    requestDownload: () => sessionRef.current?.requestDownload(),
    pause: () => sessionRef.current?.pause(),
    resume: () => sessionRef.current?.resume(),
    terminate: () => sessionRef.current?.terminate(),
  }
}
