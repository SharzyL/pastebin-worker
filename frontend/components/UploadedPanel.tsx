import { Card, CardBody, CardHeader, CardProps, Divider, mergeClasses, Skeleton, Snippet } from "@heroui/react"
import React from "react"
import { PasteResponse } from "../../shared/interfaces.js"
import { tst } from "../utils/overrides.js"

interface UploadedPanelProps extends CardProps {
  isLoading: boolean
  pasteResponse: PasteResponse | null
  encryptionKey: string | null
}

const makeDecryptionUrl = (url: string, key: string) => {
  const urlParsed = new URL(url)
  urlParsed.pathname = "/d" + urlParsed.pathname
  return urlParsed.toString() + "#" + key
}

export function UploadedPanel({ isLoading, pasteResponse, className, encryptionKey, ...rest }: UploadedPanelProps) {
  const snippetClassNames = {
    pre: `overflow-scroll leading-[2.5] font-sans ${tst}`,
    base: `w-full py-1/3 ${tst}`,
    copyButton: `relative ml-[-12pt] left-[5pt] ${tst}`,
  }
  const firstColClassNames = "w-[8rem] mr-4 whitespace-nowrap"
  return (
    <Card classNames={mergeClasses({ base: tst }, { base: className })} {...rest}>
      <CardHeader className="text-2xl">Uploaded Paste</CardHeader>
      <Divider />
      <CardBody>
        <table className="border-spacing-2 border-separate table-fixed w-full">
          <tbody>
            <tr>
              <td className={firstColClassNames}>Paste URL</td>
              <td className="w-full">
                <Skeleton isLoaded={!isLoading} className="rounded-2xl grow">
                  <Snippet hideSymbol variant="bordered" classNames={snippetClassNames}>
                    {pasteResponse?.url}
                  </Snippet>
                </Skeleton>
              </td>
            </tr>
            <tr>
              <td className={firstColClassNames}>Manage URL</td>
              <td className="w-full">
                <Skeleton isLoaded={!isLoading} className="rounded-2xl grow">
                  <Snippet hideSymbol variant="bordered" classNames={snippetClassNames}>
                    {pasteResponse?.manageUrl}
                  </Snippet>
                </Skeleton>
              </td>
            </tr>
            {encryptionKey ? (
              <tr>
                <td className={firstColClassNames}>Decryption URL</td>
                <td className="w-full">
                  <Skeleton isLoaded={!isLoading} className="rounded-2xl grow">
                    <Snippet hideSymbol variant="bordered" classNames={snippetClassNames}>
                      {pasteResponse && makeDecryptionUrl(pasteResponse.url, encryptionKey)}
                    </Snippet>
                  </Skeleton>
                </td>
              </tr>
            ) : null}
            <tr>
              <td className={firstColClassNames}>Expire At</td>
              <td className="w-full py-2">
                <Skeleton isLoaded={!isLoading} className="rounded-2xl">
                  {pasteResponse && new Date(pasteResponse.expireAt).toLocaleString()}
                </Skeleton>
              </td>
            </tr>
          </tbody>
        </table>
      </CardBody>
    </Card>
  )
}
