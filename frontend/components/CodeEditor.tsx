// inspired by https://css-tricks.com/creating-an-editable-textarea-that-supports-syntax-highlighted-code/

import React, { useEffect, useRef, useState } from "react"
import { Autocomplete, AutocompleteItem, Input, Select, SelectItem } from "@heroui/react"

import { autoCompleteOverrides, inputOverrides, selectOverrides, tst } from "../utils/overrides.js"
import { useHLJS, highlightHTML } from "../utils/HighlightLoader.js"

import "../styles/highlight-theme-light.css"
import "../styles/highlight-theme-dark.css"

// TODO:
// - line number
// - clear button
interface CodeInputProps extends React.HTMLProps<HTMLDivElement> {
  content: string
  setContent: (code: string) => void
  lang?: string
  setLang: (lang?: string) => void
  filename?: string
  setFilename: (filename?: string) => void
  placeholder?: string
  disabled?: boolean
}

interface TabSetting {
  char: "tab" | "space"
  width: 2 | 4 | 8
}

function formatTabSetting(s: TabSetting, forHuman: boolean) {
  if (forHuman) {
    if (s.char === "tab") {
      return `Tab: ${s.width}`
    } else {
      return `Spaces: ${s.width}`
    }
  } else {
    return `${s.char} ${s.width}`
  }
}

function parseTabSetting(s: string): TabSetting | undefined {
  const match = s.match(/^(tab|space) ([24])$/)
  if (match) {
    return { char: match[1] as TabSetting["char"], width: parseInt(match[2]) as TabSetting["width"] }
  } else {
    return undefined
  }
}

const tabSettings: TabSetting[] = [
  { char: "tab", width: 2 },
  { char: "tab", width: 4 },
  { char: "tab", width: 8 },
  { char: "space", width: 2 },
  { char: "space", width: 4 },
  { char: "space", width: 8 },
]

function handleNewLines(str: string): string {
  if (str.at(-1) === "\n") {
    str += " "
  }
  return str
}

export function CodeEditor({
  content,
  setContent,
  lang,
  setLang,
  filename,
  setFilename,
  placeholder,
  disabled,
  className,
  ...rest
}: CodeInputProps) {
  const refHighlighting = useRef<HTMLPreElement | null>(null)
  const refTextarea = useRef<HTMLTextAreaElement | null>(null)
  const refLineNumbers = useRef<HTMLSpanElement | null>(null)

  const [heightPx, setHeightPx] = useState<number>(0)
  const hljs = useHLJS()
  const [tabSetting, setTabSettings] = useState<TabSetting>({ char: "space", width: 2 })

  const lineCount = (content?.match(/\n/g)?.length || 0) + 1

  function syncScroll() {
    refHighlighting.current!.scrollLeft = refTextarea.current!.scrollLeft
    refHighlighting.current!.scrollTop = refTextarea.current!.scrollTop
    if (refLineNumbers.current) {
      refLineNumbers.current.scrollTop = refTextarea.current!.scrollTop
    }
  }

  function handleInput(_: React.FormEvent<HTMLTextAreaElement>) {
    const editing = refTextarea.current!
    setContent(editing.value)
    syncScroll()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const element = refTextarea.current!
    if (event.key === "Tab") {
      event.preventDefault() // stop normal
      const beforeTab = content.slice(0, element.selectionStart)
      const afterTab = content.slice(element.selectionEnd, element.value.length)
      const insertedString = tabSetting.char === "tab" ? "\t" : " ".repeat(tabSetting.width)
      const curPos = element.selectionStart + insertedString.length
      setContent(beforeTab + insertedString + afterTab)
      // move cursor
      element.selectionStart = curPos
      element.selectionEnd = curPos
    } else if (event.key === "Escape") {
      element.blur()
    }
  }

  useEffect(() => {
    setHeightPx(refTextarea.current!.clientHeight)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setHeightPx(entry.contentRect.height)
        }
      }
    })

    observer.observe(refTextarea.current!)

    return () => {
      observer.disconnect()
    }
  }, [])

  const lineNumOffset = `${Math.floor(Math.log10(lineCount)) + 3}ch`

  return (
    <div className={className} {...rest}>
      <div className={"mb-2 gap-2 flex flex-row" + " "}>
        <Input
          classNames={inputOverrides}
          type={"text"}
          label={"File name"}
          size={"sm"}
          value={filename || ""}
          onValueChange={setFilename}
        />
        <Autocomplete
          className={"max-w-[10em]"}
          classNames={autoCompleteOverrides}
          label={"Language"}
          size={"sm"}
          defaultItems={hljs ? hljs.listLanguages().map((lang) => ({ key: lang })) : []}
          // we must not use undefined here to avoid conversion from uncontrolled component to controlled component
          selectedKey={hljs && lang && hljs.listLanguages().includes(lang) ? lang : ""}
          onSelectionChange={(key) => {
            setLang((key as string) || undefined) // when key is empty string, convert back to undefined
          }}
        >
          {(language) => <AutocompleteItem key={language.key}>{language.key}</AutocompleteItem>}
        </Autocomplete>
        <Select
          size={"sm"}
          label={"Indent With"}
          className={"max-w-[10em] text-foreground"}
          classNames={selectOverrides}
          selectedKeys={[formatTabSetting(tabSetting, false)]}
          onSelectionChange={(s) => {
            setTabSettings(parseTabSetting(s.currentKey as string)!)
          }}
        >
          {tabSettings.map((s) => (
            <SelectItem key={formatTabSetting(s, false)}>{formatTabSetting(s, true)}</SelectItem>
          ))}
        </Select>
      </div>
      <div className={`w-full bg-default-100 ${tst} rounded-xl p-2 relative`}>
        <div
          className={`relative w-full`}
          style={{ tabSize: tabSetting.char === "tab" ? tabSetting.width : undefined }}
        >
          <div className={"w-full font-mono top-0 left-0 absolute"}>
            <pre
              ref={refHighlighting}
              className={`text-foreground ${tst} w-full overflow-x-hidden`}
              style={{ marginLeft: lineNumOffset, width: `calc(100% - ${lineNumOffset})`, height: `${heightPx}px` }}
              dangerouslySetInnerHTML={{ __html: highlightHTML(hljs, lang, handleNewLines(content)) }}
            ></pre>
            <span
              ref={refLineNumbers}
              className={
                "line-number-rows font-mono absolute pointer-events-none text-default-500 top-0 left-1 " +
                `border-solid border-default-300 border-r-1 ${tst}`
              }
              style={{ height: `${heightPx}px`, overflow: "hidden" }}
            >
              {Array.from({ length: lineCount }, (_, idx) => {
                return <span key={idx} />
              })}
            </span>
          </div>
          <textarea
            className={`w-full font-mono min-h-[20em] text-transparent placeholder-default-400 
             caret-foreground bg-transparent outline-none relative overflow-x-auto`}
            style={{ marginLeft: lineNumOffset, width: `calc(100% - ${lineNumOffset})` }}
            wrap={"off"}
            ref={refTextarea}
            readOnly={disabled}
            placeholder={placeholder}
            onScroll={syncScroll}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            value={content}
            spellCheck={false}
            aria-label={"Paste editor"}
          ></textarea>
        </div>
      </div>
    </div>
  )
}
