import { useEffect, useState } from "react"

import { Button, Card, CardBody, Divider, Input, Link } from "../components/ui/index.js"
import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { CopyWidget } from "../components/CopyWidget.js"
import { QRCodeWidget } from "../components/QRCodeWidget.js"
import { useErrorModal } from "../components/ErrorModal.js"
import { RefreshIcon } from "../components/icons.js"
import { LivePostCard } from "../components/LivePostCard.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { PasteInputPanel } from "../components/PasteInputPanel.js"

import { LIVE_MAX_BODY_BYTES, LIVE_PAGE_PATH } from "../../shared/live.js"
import type { LivePost } from "../utils/live.js"
import { genLiveSecret, genNickname } from "../utils/live.js"
import type { LiveStatus } from "../utils/useLiveChannel.js"
import { useLiveChannel } from "../utils/useLiveChannel.js"
import { formatSize } from "../utils/utils.js"
import { cardOverrides, tst } from "../utils/overrides.js"

import "../style.css"

// enough to tell channels apart in a tab bar
const CHANNEL_ID_TITLE_CHARS = 8

const statusText: Record<LiveStatus, string> = {
  connecting: "Connecting",
  open: "Connected",
  reconnecting: "Reconnecting",
  error: "Error",
}

const statusColor: Record<LiveStatus, string> = {
  connecting: "bg-yellow-500",
  open: "bg-success",
  reconnecting: "bg-yellow-500",
  error: "bg-danger",
}

async function postFromEditor(state: PasteEditState, author: string): Promise<LivePost> {
  if (state.editKind === "file" && state.file !== null) {
    return {
      author,
      kind: "file",
      filename: state.file.name,
      mime: state.file.type || undefined,
      body: new Uint8Array(await state.file.arrayBuffer()),
    }
  }
  return {
    author,
    kind: "text",
    filename: state.editFilename || undefined,
    lang: state.editHighlightLang && state.editHighlightLang !== "plaintext" ? state.editHighlightLang : undefined,
    body: new TextEncoder().encode(state.editContent),
  }
}

function readSecretFromHash(): string {
  const secret = location.hash.slice(1)
  if (secret) return secret
  const fresh = genLiveSecret()
  history.replaceState(null, "", `${LIVE_PAGE_PATH}#${fresh}`)
  return fresh
}

export function LivePaste({ config }: { config: Env }) {
  const [secret, setSecret] = useState(readSecretFromHash)
  const [nickname, setNickname] = useState(genNickname)
  const [editorState, setEditorState] = useState<PasteEditState>({
    editKind: "edit",
    editContent: "",
    file: null,
    editHighlightLang: "plaintext",
  })
  const [isSending, setSending] = useState(false)

  const [_, modeSelection, setModeSelection] = useDarkModeSelection()
  const { ErrorModal, showModal, handleError } = useErrorModal()

  const channel = useLiveChannel(config.DEPLOY_URL, secret)

  // the channel id rather than the secret, which must not end up in window titles
  useEffect(() => {
    const base = `${config.INDEX_PAGE_TITLE} / Live`
    document.title = channel.channelId
      ? `${base} (Channel ${channel.channelId.slice(0, CHANNEL_ID_TITLE_CHARS)})`
      : base
  }, [config.INDEX_PAGE_TITLE, channel.channelId])

  useEffect(() => {
    const onHashChange = () => setSecret(readSecretFromHash())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const channelUrl = `${config.DEPLOY_URL}${LIVE_PAGE_PATH}#${secret}`
  const isFile = editorState.editKind === "file"
  const draftBytes = isFile ? (editorState.file?.size ?? 0) : new TextEncoder().encode(editorState.editContent).length
  const isDraftEmpty = isFile ? editorState.file === null : editorState.editContent.length === 0
  const isDraftTooLarge = draftBytes > LIVE_MAX_BODY_BYTES
  const canSend = channel.status === "open" && !isDraftEmpty && !isDraftTooLarge && !isSending

  function onSend() {
    if (!canSend) return
    setSending(true)
    const sentState = editorState
    postFromEditor(sentState, nickname.trim() || "anon")
      .then((post) => channel.send(post))
      // keep anything edited while the post was being sent
      .then(() =>
        setEditorState((state) =>
          state === sentState ? { ...state, editContent: "", editFilename: undefined, file: null } : state,
        ),
      )
      .catch((e: Error) => handleError("Error on Sending Message", e))
      .finally(() => setSending(false))
  }

  function onNewChannel() {
    // the hashchange listener picks the new secret up
    location.hash = genLiveSecret()
  }

  const info = (
    <div className="mx-4 lg:px-4 lg:mx-0">
      <div className="mt-8 mb-4 flex items-center justify-between">
        <h1 className="text-3xl">
          <Link href={config.DEPLOY_URL} className={tst}>
            {config.INDEX_PAGE_TITLE}
          </Link>
          {" / Live"}
        </h1>
        <DarkModeToggle modeSelection={modeSelection} setModeSelection={setModeSelection} />
      </div>
      <p className="my-2">
        Everyone with the channel link can post here, and posts show up on every open page immediately. Posts are
        encrypted and not visible to the server. (
        <Link href={`${config.DEPLOY_URL}/doc/live-crypto`} className={tst}>
          How it works
        </Link>
        )
      </p>
      <p className="my-2">
        <b>Warning</b>: Nothing is stored. Your posts are only visible to those who have this page open.
      </p>
    </div>
  )

  const composer = (
    <div
      className="mx-2 lg:mx-0 mt-6"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          onSend()
        }
      }}
    >
      <PasteInputPanel
        isPasteLoading={false}
        state={editorState}
        onStateChange={setEditorState}
        config={config}
        showModal={showModal}
        maxFileSize={LIVE_MAX_BODY_BYTES}
      />
      <Card aria-label="Live post settings and channel" classNames={cardOverrides} className="mt-4">
        <CardBody>
          <div className="flex items-end gap-2">
            <Input
              label="Channel link"
              labelExtra={
                // plain inline text, so it wraps like a sentence on narrow screens
                <span className="ml-3" role="status">
                  <span
                    className={`inline-block size-2 mr-1.5 align-middle rounded-full ${statusColor[channel.status]}`}
                  />
                  <span className="text-foreground">{statusText[channel.status]}</span>
                  {channel.status === "open" && (
                    <>
                      {" · "}
                      {channel.peerCount} online
                    </>
                  )}
                  {channel.status === "open" && channel.peerCount === 1 && (
                    <span className="text-yellow-600"> · nobody will see your post!</span>
                  )}
                </span>
              }
              readOnly
              value={channelUrl}
              className="grow"
              endContent={
                <div className="flex items-center">
                  <CopyWidget getCopyContent={() => channelUrl} />
                  <QRCodeWidget label="Channel link" getContent={() => channelUrl} />
                </div>
              }
            />
            <Button variant="ghost" onPress={onNewChannel} className="shrink-0">
              New Channel
            </Button>
          </div>
          {channel.error && <p className="mt-2 text-sm text-danger">{channel.error}</p>}
        </CardBody>
        <Divider />
        <CardBody className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <Input
            label="Nickname"
            value={nickname}
            onValueChange={setNickname}
            maxLength={64}
            className="sm:w-64"
            endContent={
              <Button
                isIconOnly
                size="sm"
                variant="light"
                aria-label="Roll a new nickname"
                title="Roll a new nickname"
                className="focus:ring-0 hover:bg-default-200"
                onPress={() => setNickname(genNickname())}
              >
                <RefreshIcon className="size-5" />
              </Button>
            }
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {isDraftTooLarge && (
              <span className="text-xs text-danger">Too large (max {formatSize(LIVE_MAX_BODY_BYTES)})</span>
            )}
            <Button onPress={onSend} isDisabled={!canSend} title="Ctrl+Enter">
              {isSending ? "Posting" : "Post"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )

  const posts = (
    <div className="flex flex-col gap-3 mx-2 lg:mx-0 mt-4 mb-4">
      {channel.messages.length === 0 ? (
        <p className="text-center text-default-500 my-8">No posts yet. Share the link and start posting.</p>
      ) : (
        <div className="flex items-center justify-between mx-2">
          <h2 className="text-xl">Posts</h2>
          <Button size="sm" variant="light" onPress={channel.clear} title="Remove all posts from this page">
            Clear posts
          </Button>
        </div>
      )}
      {[...channel.messages].reverse().map((msg) => (
        <LivePostCard key={msg.id} msg={msg} isOwn={msg.isOwn} />
      ))}
    </div>
  )

  const footer = (
    <footer className="px-3 my-4 text-center">
      <p>
        <Link href={`${config.DEPLOY_URL}/doc/tos`} className={`d-inline-block ${tst}`}>
          Terms & Conditions
        </Link>
        {" / "}
        <Link href={config.REPO} className={`d-inline-block ${tst}`}>
          Repository
        </Link>
      </p>
    </footer>
  )

  return (
    <main className={`flex flex-col items-center min-h-screen font-sans ${tst} bg-background text-foreground`}>
      <div className="grow w-full max-w-[64rem]">
        {info}
        {composer}
        {posts}
      </div>
      {footer}
      <ErrorModal />
    </main>
  )
}
