import type { CardProps } from "./ui/index.js"
import { Card, CardBody, CardHeader, Divider, Input, Switch, Tooltip } from "./ui/index.js"
import type { NameAvailability } from "../utils/useNameAvailability.js"
import React from "react"
import { CheckIcon, QuestionMarkCircleIcon, SpinnerIcon, XIcon } from "./icons.js"
import { cardOverrides, inputOverrides, switchOverrides, tst } from "../utils/overrides.js"
import { PASTE_NAME_LEN, PRIVATE_PASTE_NAME_LEN } from "../../shared/constants.js"
import type { PublicEnv } from "../../shared/interfaces.js"
import { InfoTooltip } from "./InfoTooltip.js"
import {
  validatePasteSetting,
  type PasteSetting,
  type UploadKind,
  type ValidationResult,
} from "../utils/pasteSetting.js"

export type { PasteSetting } from "../utils/pasteSetting.js"

interface PasteSettingPanelProps extends CardProps {
  setting: PasteSetting
  onSettingChange: (setting: PasteSetting) => void
  config: PublicEnv
  nameAvailability: NameAvailability
  footer?: React.ReactNode
}

const URL_KIND_OPTIONS: { value: UploadKind; label: string }[] = [
  { value: "short", label: "short" },
  { value: "long", label: "long" },
  { value: "custom", label: "custom" },
  { value: "manage", label: "manage" },
]

function urlKindDescription(kind: UploadKind): string {
  switch (kind) {
    case "short":
      return `Random ${PASTE_NAME_LEN}-character name`
    case "long":
      return `Random ${PRIVATE_PASTE_NAME_LEN}-character name`
    case "custom":
      return "Pick your own name (prefixed with ~)"
    case "manage":
      return "Update or delete an existing paste"
  }
}

function urlKindExample(kind: UploadKind, deployUrl: string): string | null {
  switch (kind) {
    case "short":
      return `${deployUrl}/BxWH2a`
    case "long":
      return `${deployUrl}/5HQWYNmjA4h44SmybeThXXAm`
    case "custom":
      return `${deployUrl}/~stocking`
    case "manage":
      return null
  }
}

interface CustomNameUI {
  isInvalid: boolean
  errorMessage?: string
  warningMessage?: string
  successMessage?: string
  description?: string
  endContent: React.ReactNode
}

function customNameUI([ok, msg]: ValidationResult, availability: NameAvailability): CustomNameUI {
  if (!ok) return { isInvalid: true, errorMessage: msg, endContent: null }

  switch (availability.status) {
    case "idle": // debouncing — treat as checking for the user
    case "checking":
      return {
        isInvalid: false,
        description: "Checking availability…",
        endContent: <SpinnerIcon className="size-4 text-default-400" aria-label="Checking availability" />,
      }
    case "available":
      return {
        isInvalid: false,
        successMessage: "Name available",
        endContent: <CheckIcon className="size-4 text-success" aria-label="Name available" />,
      }
    case "taken":
      return {
        isInvalid: true,
        errorMessage: "Name already taken",
        endContent: <XIcon className="size-4 text-danger" aria-label="Name taken" />,
      }
    case "error":
      return {
        isInvalid: false,
        warningMessage: `Could not check availability: ${availability.message}`,
        endContent: <QuestionMarkCircleIcon className="size-4 text-yellow-600" aria-label="Availability unknown" />,
      }
  }
}

export function PanelSettingsPanel({
  setting,
  onSettingChange,
  config,
  nameAvailability,
  footer,
  ...rest
}: PasteSettingPanelProps) {
  const isP2P = setting.isP2P
  const validation = validatePasteSetting(setting, config)
  const [isExpirationValid, expirationMessage] = validation.expiration
  const [isReadLimitValid, readLimitMessage] = validation.readLimit
  const [isManageUrlValid, manageUrlMessage] = validation.manageUrl
  const [isPasswordValid, passwordMessage] = validation.password
  const expirationDescription =
    isP2P && isExpirationValid ? expirationMessage.replace(/^Expires/, "Pair link expires") : expirationMessage
  const setP2PMode = (v: boolean) => {
    const [isNextExpirationValid] = validatePasteSetting({ ...setting, isP2P: v }, config).expiration
    onSettingChange({
      ...setting,
      isP2P: v,
      expiration: v
        ? isNextExpirationValid
          ? setting.expiration
          : config.DEFAULT_P2P_EXPIRATION
        : config.DEFAULT_EXPIRATION,
      readLimit: String(v ? config.DEFAULT_P2P_TRANSFERS : config.DEFAULT_READS),
      doEncrypt: v ? false : setting.doEncrypt,
      verifyP2P: v ? config.DEFAULT_P2P_VERIFY : false,
    })
  }

  return (
    <Card aria-label="Pastebin setting panel" classNames={cardOverrides} {...rest}>
      <CardHeader className="flex items-center justify-between gap-3 pl-4 pb-2">
        <span className="text-2xl">Settings</span>
        <div className="flex items-center">
          <Switch classNames={switchOverrides} isSelected={setting.isP2P} onValueChange={setP2PMode}>
            P2P transfer
          </Switch>
          <InfoTooltip label="More information about P2P transfer">
            File data is sent browser-to-browser with WebRTC. The server only creates the short display URL and relays
            pairing messages.
          </InfoTooltip>
        </div>
      </CardHeader>
      <Divider className={tst} />
      <CardBody>
        <div className="flex flex-row flex-wrap gap-4">
          <Input
            type="text"
            label="Expiration"
            labelExtra={
              <InfoTooltip label="More information about Expiration" compact>
                {isP2P
                  ? "Pair link available for new receivers before expired. Active transfers can continue after expired."
                  : "Available before it expires."}
              </InfoTooltip>
            }
            classNames={{
              base: isP2P ? "min-w-0 flex-1 basis-[calc(50%-0.5rem)]" : "basis-32",
              ...inputOverrides,
            }}
            value={setting.expiration}
            isRequired
            onValueChange={(e) => onSettingChange({ ...setting, expiration: e })}
            isInvalid={!isExpirationValid}
            errorMessage={expirationMessage}
            description={expirationDescription}
          />
          <Input
            type="number"
            min={0}
            step={1}
            label={isP2P ? "Transfers" : "Reads"}
            labelExtra={
              <InfoTooltip label={isP2P ? "More information about Transfers" : "More information about Reads"} compact>
                {isP2P
                  ? "Maximum receivers that may successfully receive files from this P2P session. Updated versions received by the same receiver do not use another slot. 0 allows unlimited receivers."
                  : "Maximum reads before the paste expires. 0 allows unlimited reads."}
              </InfoTooltip>
            }
            value={setting.readLimit}
            onValueChange={(v) => onSettingChange({ ...setting, readLimit: v })}
            isInvalid={!isReadLimitValid}
            errorMessage={readLimitMessage}
            description={readLimitMessage}
            classNames={{
              base: isP2P ? "min-w-0 flex-1 basis-[calc(50%-0.5rem)]" : "basis-32",
              ...inputOverrides,
            }}
          />
          {!isP2P && (
            <Input
              type="password"
              label="Password"
              labelExtra={
                <InfoTooltip label="More information about Password" compact>
                  Used to update/delete your paste. Randomly generated if left empty.
                </InfoTooltip>
              }
              value={setting.password}
              onValueChange={(p) => onSettingChange({ ...setting, password: p })}
              isClearable
              classNames={{
                base: "flex-1",
                ...inputOverrides,
              }}
              placeholder={"Generated randomly"}
              isInvalid={!isPasswordValid}
              errorMessage={passwordMessage}
            />
          )}
        </div>
        {isP2P ? (
          <>
            <Divider className={`my-4 ${tst}`} />
            <div className="pl-1 flex flex-row items-center">
              <Switch
                classNames={switchOverrides}
                isSelected={setting.verifyP2P}
                onValueChange={(v) => onSettingChange({ ...setting, verifyP2P: v })}
              >
                Verify transfer
              </Switch>
              <InfoTooltip label="More information about transfer verification">
                Compare every 4 MB block hashes after transfer and resend any mismatched blocks.
              </InfoTooltip>
            </div>
          </>
        ) : (
          <>
            <Divider className={`my-4 ${tst}`} />
            <div className="pl-1">
              <div className="flex flex-row items-center flex-wrap gap-x-2 gap-y-2 text-sm">
                <span className="text-default-700">Use</span>
                <div
                  role="radiogroup"
                  aria-label="URL kind"
                  className="inline-flex rounded-lg border border-default-200 bg-default-100"
                >
                  {URL_KIND_OPTIONS.map((opt, idx) => {
                    const selected = setting.uploadKind === opt.value
                    const isFirst = idx === 0
                    const isLast = idx === URL_KIND_OPTIONS.length - 1
                    return (
                      <Tooltip
                        key={opt.value}
                        content={
                          <div className="px-1 py-1 text-small max-w-[22rem]">
                            <div>{urlKindDescription(opt.value)}</div>
                            {urlKindExample(opt.value, config.DEPLOY_URL) && (
                              <div className="mt-1 font-mono text-xs opacity-80 break-all">
                                e.g. {urlKindExample(opt.value, config.DEPLOY_URL)}
                              </div>
                            )}
                          </div>
                        }
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => onSettingChange({ ...setting, uploadKind: opt.value })}
                          className={
                            `px-3 py-1 cursor-pointer ${tst} ` +
                            (isFirst ? "rounded-l-lg " : "border-l border-default-200 ") +
                            (isLast ? "rounded-r-lg " : "") +
                            (selected
                              ? "bg-primary-50 text-primary font-medium"
                              : "text-default-600 hover:bg-default-200")
                          }
                        >
                          {opt.label}
                        </button>
                      </Tooltip>
                    )
                  })}
                </div>
                <span className="text-default-700">URL</span>
              </div>

              {setting.uploadKind === "custom" &&
                (() => {
                  const ui = customNameUI(validation.name, nameAvailability)
                  return (
                    <Input
                      value={setting.name}
                      onValueChange={(n) => onSettingChange({ ...setting, name: n })}
                      type="text"
                      className="mt-2"
                      isInvalid={ui.isInvalid}
                      errorMessage={ui.errorMessage}
                      warningMessage={ui.warningMessage}
                      successMessage={ui.successMessage}
                      description={ui.description}
                      startContent={
                        <div className="pointer-events-none flex items-center">
                          <span className="text-default-500 text-sm w-max">{`${config.DEPLOY_URL}/~`}</span>
                        </div>
                      }
                      endContent={ui.endContent}
                    />
                  )
                })()}
              {setting.uploadKind === "manage" && (
                <Input
                  value={setting.manageUrl}
                  onValueChange={(m) => onSettingChange({ ...setting, manageUrl: m })}
                  type="text"
                  className="mt-2"
                  isInvalid={!isManageUrlValid}
                  errorMessage={manageUrlMessage}
                  placeholder="Manage URL"
                />
              )}
            </div>
            <Divider className={`my-4 ${tst}`} />
            <div className="pl-1 flex flex-row items-center">
              <Switch
                classNames={switchOverrides}
                isSelected={setting.doEncrypt}
                onValueChange={(v) => onSettingChange({ ...setting, doEncrypt: v })}
              >
                Client-side encryption
              </Switch>
              <InfoTooltip label="More information about client-side encryption">
                <h3 className="text-normal font-bold mb-2">Client-side encryption</h3>
                <div>
                  Your paste is shared via a URL containing the decryption key in the URL hash, which is never sent to
                  the server. Decryption happens in the browser, so only those with the key (not the server) can view
                  the decrypted content.
                </div>
                <div className="mt-2 text-yellow-600">
                  Only the paste content is encrypted. The filename and its inferred mime type remain visible to the
                  server and anyone with the URL.
                </div>
              </InfoTooltip>
            </div>
          </>
        )}
      </CardBody>
      {footer}
    </Card>
  )
}
