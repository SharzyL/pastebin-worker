import {
  Card,
  CardBody,
  CardHeader,
  CardProps,
  Divider,
  Input,
  mergeClasses,
  Radio,
  RadioGroup,
  Switch,
  Tooltip,
} from "@heroui/react"
import { BaseUrl, verifyExpiration, verifyManageUrl, verifyName } from "../utils/utils.js"
import React from "react"
import { InfoIcon } from "./icons.js"
import { cardOverrides, inputOverrides, radioOverrides, switchOverrides, tst } from "../utils/overrides.js"

export type UploadKind = "short" | "long" | "custom" | "manage"

export type PasteSetting = {
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
}

export function PanelSettingsPanel({ setting, onSettingChange, ...rest }: PasteSettingPanelProps) {
  const radioClassNames = mergeClasses(radioOverrides, { labelWrapper: "ml-2.5" })
  return (
    <Card aria-label="Pastebin setting panel" classNames={cardOverrides} {...rest}>
      <CardHeader className="text-2xl pl-4 pb-2">Settings</CardHeader>
      <Divider className={tst} />
      <CardBody>
        <div className="gap-4 mb-3 flex flex-row">
          <Input
            type="text"
            label="Expiration"
            // to avoid duplicated name, see https://github.com/adobe/react-spectrum/discussions/8037
            aria-labelledby=""
            classNames={{
              base: "basis-80",
              ...inputOverrides,
            }}
            defaultValue="7d"
            value={setting.expiration}
            isRequired
            onValueChange={(e) => onSettingChange({ ...setting, expiration: e })}
            isInvalid={!verifyExpiration(setting.expiration)[0]}
            errorMessage={verifyExpiration(setting.expiration)[1]}
            description={verifyExpiration(setting.expiration)[1]}
          />
          <Input
            type="password"
            label="Password"
            aria-labelledby=""
            value={setting.password}
            onValueChange={(p) => onSettingChange({ ...setting, password: p })}
            classNames={inputOverrides}
            placeholder={"Generated randomly"}
            description="Used to update/delete your paste"
          />
        </div>
        <RadioGroup
          className="gap-4 mb-3 w-full"
          value={setting.uploadKind}
          onValueChange={(v) => onSettingChange({ ...setting, uploadKind: v as UploadKind })}
        >
          <Radio value="short" description={`Example: ${BaseUrl}/BxWH`} classNames={radioClassNames}>
            Generate a short random URL
          </Radio>
          <Radio
            value="long"
            description={`Example: ${BaseUrl}/5HQWYNmjA4h44SmybeThXXAm`}
            classNames={{
              description: "text-ellipsis max-w-[calc(100vw-5rem)] whitespace-nowrap overflow-hidden",
              ...radioClassNames,
            }}
          >
            Generate a long random URL
          </Radio>
          <Radio value="custom" classNames={radioClassNames} description={`Example: ${BaseUrl}/~stocking`}>
            Set by your own
          </Radio>
          {setting.uploadKind === "custom" ? (
            <Input
              value={setting.name}
              onValueChange={(n) => onSettingChange({ ...setting, name: n })}
              type="text"
              classNames={radioClassNames}
              isInvalid={!verifyName(setting.name)[0]}
              errorMessage={verifyName(setting.name)[1]}
              startContent={
                <div className="pointer-events-none flex items-center">
                  <span className="text-default-500 text-small w-max">{`${BaseUrl}/~`}</span>
                </div>
              }
            />
          ) : null}
          <Radio value="manage" classNames={radioClassNames}>
            <div className="">Update or delete</div>
          </Radio>
          {setting.uploadKind === "manage" ? (
            <Input
              value={setting.manageUrl}
              onValueChange={(m) => onSettingChange({ ...setting, manageUrl: m })}
              type="text"
              className="shrink"
              isInvalid={!verifyManageUrl(setting.manageUrl)[0]}
              errorMessage={verifyManageUrl(setting.manageUrl)[1]}
              placeholder={`Manage URL`}
            />
          ) : null}
        </RadioGroup>
        <Divider className={tst} />
        <div className="mt-3 flex flex-row items-center">
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
            <InfoIcon className="inline size-5 ml-2" />
          </Tooltip>
        </div>
      </CardBody>
    </Card>
  )
}
