import React from "react"

import type { CardProps } from "./ui/index.js"
import { Card, CardBody, CardHeader, CircularProgress, Divider, Input, mergeClasses } from "./ui/index.js"

import type { PasteResponse } from "../../shared/interfaces.js"
import { tst } from "../utils/overrides.js"
import { CopyWidget } from "./CopyWidget.js"

interface UploadedPanelProps extends CardProps {
  isLoading: boolean
  loadingProgress?: number
  pasteResponse?: PasteResponse
  encryptionKey?: string
}

const makeDecryptionUrl = (url: string, key?: string) => {
  const urlParsed = new URL(url)
  urlParsed.pathname = "/d" + urlParsed.pathname
  if (key) {
    return urlParsed.toString() + "#" + key
  } else {
    return urlParsed.toString()
  }
}

export function UploadedPanel({
  isLoading,
  loadingProgress,
  pasteResponse,
  className,
  encryptionKey,
  ...rest
}: UploadedPanelProps) {
  const copyWidgetClassNames = `${tst}`
  const inputProps = {
    readOnly: true,
    className: "mb-2",
  }

  return (
    <Card classNames={mergeClasses({ base: tst }, { base: className })} {...rest}>
      <CardHeader className="text-2xl pl-4 pb-2">Uploaded Paste</CardHeader>
      <Divider />
      <CardBody>
        {isLoading ? (
          <div className={"min-h-[5rem] w-full relative"}>
            <CircularProgress
              aria-label={"Loading..."}
              value={loadingProgress}
              className={"absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"}
            />
          </div>
        ) : (
          pasteResponse && (
            <>
              <Input
                {...inputProps}
                label={"Display URL"}
                color={encryptionKey ? "success" : "default"}
                className={encryptionKey ? "mb-2 [&_input]:bg-success-50" : "mb-2"}
                value={makeDecryptionUrl(pasteResponse.url, encryptionKey)}
                endContent={
                  <CopyWidget
                    className={encryptionKey ? `${copyWidgetClassNames} hover:bg-success-100` : copyWidgetClassNames}
                    getCopyContent={() => makeDecryptionUrl(pasteResponse.url, encryptionKey)}
                  />
                }
              />
              <Input
                {...inputProps}
                label={"Raw URL"}
                value={pasteResponse.url}
                endContent={<CopyWidget className={copyWidgetClassNames} getCopyContent={() => pasteResponse.url} />}
              />
              <Input
                {...inputProps}
                label={"Manage URL"}
                value={pasteResponse.manageUrl}
                endContent={
                  <CopyWidget className={copyWidgetClassNames} getCopyContent={() => pasteResponse.manageUrl} />
                }
              />
              <Input {...inputProps} label={"Expiration"} value={new Date(pasteResponse.expireAt).toLocaleString()} />
            </>
          )
        )}
      </CardBody>
    </Card>
  )
}
