import type { CardProps } from "./ui/index.js"
import { Card, CardBody, CardHeader, Divider, Input, Switch, Tooltip } from "./ui/index.js"
import { verifyExpiration, verifyManageUrl } from "../utils/utils.js"
import { verifyName, verifyPassword } from "../../shared/verify.js"
import React from "react"
import { InfoIcon } from "./icons.js"
import { cardOverrides, inputOverrides, switchOverrides, tst } from "../utils/overrides.js"
import { PASTE_NAME_LEN, PRIVATE_PASTE_NAME_LEN } from "../../shared/constants.js"

export type UploadKind = "short" | "long" | "custom" | "manage"

export interface PasteSetting {
  uploadKind: UploadKind
  expiration: string
  password: string
  name: string
  manageUrl: string

  doEncrypt: boolean
}

interface PasteSettingPanelProps extends CardProps {
  setting: PasteSetting
  onSettingChange: (setting: PasteSetting) => void
  config: Env
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
      return `${deployUrl}/BxWH`
    case "long":
      return `${deployUrl}/5HQWYNmjA4h44SmybeThXXAm`
    case "custom":
      return `${deployUrl}/~stocking`
    case "manage":
      return null
  }
}

export function PanelSettingsPanel({ setting, onSettingChange, config, footer, ...rest }: PasteSettingPanelProps) {
  return (
    <Card aria-label="Pastebin setting panel" classNames={cardOverrides} {...rest}>
      <CardHeader className="text-2xl pl-4 pb-2">Settings</CardHeader>
      <Divider className={tst} />
      <CardBody>
        <div className="gap-4 flex flex-row">
          <Input
            type="text"
            label="Expiration"
            classNames={{
              base: "basis-40",
              ...inputOverrides,
            }}
            defaultValue="7d"
            value={setting.expiration}
            isRequired
            onValueChange={(e) => onSettingChange({ ...setting, expiration: e })}
            isInvalid={!verifyExpiration(setting.expiration, config)[0]}
            errorMessage={verifyExpiration(setting.expiration, config)[1]}
            description={verifyExpiration(setting.expiration, config)[1]}
          />
          <Input
            type="password"
            label="Password"
            labelExtra={
              <Tooltip
                content={
                  <div className="px-1 py-1 text-small max-w-[18rem]">
                    Used to update/delete your paste. Randomly generated if left empty.
                  </div>
                }
              >
                <button
                  type="button"
                  aria-label="More information about Password"
                  className="inline-flex items-center ml-1 text-default-400 hover:text-default-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded"
                >
                  <InfoIcon className="size-3" />
                </button>
              </Tooltip>
            }
            value={setting.password}
            onValueChange={(p) => onSettingChange({ ...setting, password: p })}
            isClearable
            classNames={{
              base: "flex-1",
              ...inputOverrides,
            }}
            placeholder={"Generated randomly"}
            isInvalid={!verifyPassword(setting.password)[0]}
            errorMessage={verifyPassword(setting.password)[1]}
          />
        </div>
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
                      <div className="px-1 py-1 text-small">
                        <div>{urlKindDescription(opt.value)}</div>
                        {urlKindExample(opt.value, config.DEPLOY_URL) && (
                          <div className="mt-1 font-mono text-xs opacity-80">
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
                        (selected ? "bg-primary-50 text-primary font-medium" : "text-default-600 hover:bg-default-200")
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

          {setting.uploadKind === "custom" && (
            <Input
              value={setting.name}
              onValueChange={(n) => onSettingChange({ ...setting, name: n })}
              type="text"
              className="mt-2"
              isInvalid={!verifyName(setting.name)[0]}
              errorMessage={verifyName(setting.name)[1]}
              startContent={
                <div className="pointer-events-none flex items-center">
                  <span className="text-default-500 text-sm w-max">{`${config.DEPLOY_URL}/~`}</span>
                </div>
              }
            />
          )}
          {setting.uploadKind === "manage" && (
            <Input
              value={setting.manageUrl}
              onValueChange={(m) => onSettingChange({ ...setting, manageUrl: m })}
              type="text"
              className="mt-2"
              isInvalid={!verifyManageUrl(setting.manageUrl, config)[0]}
              errorMessage={verifyManageUrl(setting.manageUrl, config)[1]}
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
          <Tooltip
            content={
              <div className="px-1 py-2 max-w-[20rem]">
                <h3 className="text-normal font-bold mb-2">Client-side encryption</h3>
                <div className="text-small">
                  Your paste is shared via a URL containing the decryption key in the URL hash, which is never sent to
                  the server. Decryption happens in the browser, so only those with the key (not the server) can view
                  the decrypted content.
                </div>
              </div>
            }
          >
            <button
              type="button"
              aria-label="More information about client-side encryption"
              className="inline-flex items-center ml-2 text-default-500 hover:text-default-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded"
            >
              <InfoIcon className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </CardBody>
      {footer}
    </Card>
  )
}
