import type { CardProps } from "./ui/index.js"
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CircularProgress,
  Divider,
  Input,
  Tooltip,
  mergeClasses,
} from "./ui/index.js"
import type { P2PCreateResponse, P2PIceServer } from "../../shared/interfaces.js"
import type { P2PSenderFileInfo, P2PSenderPeerInfo } from "../utils/p2pCommon.js"
import { CopyWidget } from "./CopyWidget.js"
import { QrCodeTooltip } from "./QrCodeTooltip.js"
import { InfoTooltip } from "./InfoTooltip.js"
import { tst } from "../utils/overrides.js"
import { P2PProgressBar } from "./P2PProgressBar.js"
import { RelayConnectionIcon } from "./icons.js"

interface P2PTransferPanelProps extends CardProps {
  isLoading: boolean
  response?: P2PCreateResponse
  currentFile?: P2PSenderFileInfo
  status?: string
  peers?: P2PSenderPeerInfo[]
  iceServers?: P2PIceServer[]
  onCancel?: () => void
}

function rtcIceServerUrls(iceServers: P2PIceServer[] | undefined): string[] {
  return (iceServers ?? [])
    .flatMap((server) => (typeof server.urls === "string" ? [server.urls] : server.urls))
    .map((url) => url.trim())
    .filter((url) => /^(?:stuns?|turns?):/i.test(url))
}

function P2PPeerStatus({ peer }: { peer: P2PSenderPeerInfo }) {
  if (
    !peer.progress &&
    (peer.connectionPhase === "pairing" ||
      peer.connectionPhase === "pairing-retry" ||
      peer.connectionPhase === "pairing-failed" ||
      peer.connectionPhase === "reconnect-failed")
  ) {
    const isPending = peer.connectionPhase === "pairing" || peer.connectionPhase === "pairing-retry"
    const label =
      peer.connectionPhase === "pairing"
        ? "Pairing"
        : peer.connectionPhase === "pairing-retry"
          ? "Retrying pairing"
          : peer.connectionPhase === "pairing-failed"
            ? "Pairing failed"
            : "Reconnect failed"
    return (
      <div className="flex min-h-8 w-full items-center justify-between gap-3 text-left text-sm">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="min-w-0 truncate font-medium" title={peer.browser}>
            {peer.browser}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              isPending ? "bg-primary-100 text-primary" : "bg-danger-100 text-danger"
            }`}
          >
            {label}
          </span>
        </div>
        {isPending && (
          <span
            role="status"
            aria-label={peer.connectionPhase === "pairing" ? "Pairing WebRTC connection" : "Retrying WebRTC pairing"}
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary-200 border-t-primary"
          />
        )}
      </div>
    )
  }
  return (
    <P2PProgressBar
      progress={peer.progress}
      label={peer.browser}
      connectionRoute={peer.connectionRoute}
      status={peer.transferStatus}
    />
  )
}

export function P2PTransferPanel({
  isLoading,
  response,
  currentFile,
  status,
  peers = [],
  iceServers,
  onCancel,
  className,
  ...rest
}: P2PTransferPanelProps) {
  const displayUrl = response?.displayUrl ?? ""
  const iceServerUrls = rtcIceServerUrls(iceServers)
  const hasTurn = iceServerUrls.some((url) => /^turns?:/i.test(url))
  const visiblePeers = peers.filter(
    (peer) =>
      peer.isConnected ||
      peer.progress ||
      peer.isWaitingForResume ||
      peer.connectionPhase === "pairing" ||
      peer.connectionPhase === "pairing-retry" ||
      peer.connectionPhase === "reconnecting" ||
      peer.connectionPhase === "pairing-failed" ||
      peer.connectionPhase === "reconnect-failed",
  )
  const transferGroups: { file: P2PSenderFileInfo; peers: P2PSenderPeerInfo[] }[] = []
  const groupsByRevision = new Map<string, (typeof transferGroups)[number]>()
  for (const peer of visiblePeers) {
    let group = groupsByRevision.get(peer.file.revision)
    if (!group) {
      group = { file: peer.file, peers: [] }
      groupsByRevision.set(peer.file.revision, group)
      transferGroups.push(group)
    }
    group.peers.push(peer)
  }
  if (currentFile && !groupsByRevision.has(currentFile.revision)) {
    transferGroups.push({ file: currentFile, peers: [] })
  }
  transferGroups.sort((left, right) => left.file.order - right.file.order)

  return (
    <Card classNames={mergeClasses({ base: tst }, { base: className })} {...rest}>
      <CardHeader className="flex items-center justify-between gap-3 pl-4 pb-2 text-2xl">
        <span>P2P Transfer</span>
        {hasTurn && (
          <Tooltip
            placement="bottom"
            contentClassName="max-w-sm whitespace-normal rounded-lg bg-gray-800 px-3 py-2 text-sm text-white shadow-lg"
            content={
              <div className="text-left">
                <div>TURN fallback available. Used only when a direct P2P connection cannot be established.</div>
                <div className="mt-2 text-xs font-medium text-gray-300">ICE server URLs</div>
                <div className="mt-1 flex flex-col gap-1">
                  {iceServerUrls.map((url, index) => (
                    <div key={`${index}:${url}`} className="break-all font-mono text-xs">
                      {url}
                    </div>
                  ))}
                </div>
              </div>
            }
          >
            <span
              role="img"
              tabIndex={0}
              aria-label="TURN fallback available"
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-default-100 px-2 py-1 text-xs font-medium text-default-600"
            >
              <RelayConnectionIcon aria-hidden="true" className="size-4" />
              <span aria-hidden="true">Relay</span>
              <span aria-hidden="true" className="size-2 rounded-full bg-success" />
            </span>
          </Tooltip>
        )}
      </CardHeader>
      <Divider />
      <CardBody>
        {isLoading && !response ? (
          <div className="w-full flex flex-col items-center justify-center gap-2 py-4">
            <CircularProgress aria-label="Preparing P2P transfer..." />
            <span className="text-sm text-foreground-500">Preparing P2P link...</span>
            {onCancel && (
              <Button size="sm" variant="ghost" onPress={onCancel} className="mt-1">
                Cancel
              </Button>
            )}
          </div>
        ) : (
          response && (
            <>
              <div className="mb-2 flex items-end gap-2">
                <Input
                  readOnly
                  className="mb-0 min-w-0 flex-1"
                  label="Pair URL"
                  labelExtra={
                    <InfoTooltip label="More information" compact>
                      Share this URL to the receiver. Keep this page open and your screen unlocked. The file is not
                      uploaded; closing this page or locking your phone will interrupt the transfer.
                    </InfoTooltip>
                  }
                  value={displayUrl}
                  endContent={<QrCodeTooltip value={displayUrl} className="hover:bg-default-200" />}
                />
                <CopyWidget
                  label="Copy link"
                  className={`${tst} h-[38px] bg-default-100`}
                  getCopyContent={() => displayUrl}
                />
              </div>
              <div className="rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary">
                {status || "Waiting for receiver..."}
              </div>
              {transferGroups.length > 0 && (
                <div className="mt-2 flex flex-col gap-3">
                  {transferGroups.map((group) => (
                    <div key={group.file.revision} className="min-w-0">
                      <Divider className="mb-2" />
                      <div className="min-w-0 overflow-hidden text-sm font-semibold text-foreground-500">
                        <span className="block truncate" title={group.file.name}>
                          {group.file.name}
                        </span>
                      </div>
                      {group.peers.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {group.peers.map((peer) => (
                            <div
                              key={`${group.file.revision}:${peer.peerId}`}
                              className="rounded-lg bg-default-50 py-2"
                            >
                              <P2PPeerStatus peer={peer} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}
      </CardBody>
    </Card>
  )
}
