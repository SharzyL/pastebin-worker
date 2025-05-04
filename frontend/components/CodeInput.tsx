// based on vanilla https://css-tricks.com/creating-an-editable-textarea-that-supports-syntax-highlighted-code/

import React, { useEffect, useRef, useState } from "react"

import "../styles/highlight-theme-light.css"
import { tst } from "../utils/overrides.js"
import { escapeHtml } from "../../worker/common.js"
import { usePrism } from "../utils/HighlightLoader.js"
import { Autocomplete, AutocompleteItem, Input, Select, SelectItem } from "@heroui/react"

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
  width: 2 | 4
}

function formatTabSetting(s: TabSetting) {
  return `${s.char} ${s.width}`
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
  { char: "space", width: 2 },
  { char: "space", width: 4 },
]

function handleNewLines(str: string): string {
  if (str.at(-1) === "\n") {
    str += " "
  }
  return str
}

export function CodeInput({
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

  const [heightPx, setHeightPx] = useState<number>(0)
  const prism = usePrism()
  const [tabSetting, setTabSettings] = useState<TabSetting>({ char: "space", width: 2 })

  function syncScroll() {
    refHighlighting.current!.scrollLeft = refTextarea.current!.scrollLeft
    refHighlighting.current!.scrollTop = refTextarea.current!.scrollTop
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

  function highlightedHTML() {
    if (prism && lang && prism.listLanguages().includes(lang) && lang !== "plaintext") {
      const highlighted = prism.highlight(handleNewLines(content), { language: lang })
      return highlighted.value
    } else {
      return escapeHtml(content)
    }
  }

  return (
    <div className={className} {...rest}>
      <div className={"mb-2 gap-4 flex flex-row" + " "}>
        <Input type={"text"} label={"File name"} size={"sm"} key={filename} onValueChange={setFilename} />
        <Autocomplete
          className={"max-w-[10em]"}
          label={"Language"}
          size={"sm"}
          defaultItems={prism ? prism.listLanguages().map((lang) => ({ key: lang })) : []}
          selectedKey={lang}
          onSelectionChange={(key) => {
            setLang((key as string | null) || undefined)
          }}
        >
          {(language) => <AutocompleteItem key={language.key}>{language.key}</AutocompleteItem>}
        </Autocomplete>
        <Select
          size={"sm"}
          label={"Tabs"}
          className={"max-w-[10em]"}
          selectedKeys={[formatTabSetting(tabSetting)]}
          onSelectionChange={(s) => {
            setTabSettings(parseTabSetting(s.currentKey as string)!)
          }}
        >
          {tabSettings.map((s) => (
            <SelectItem key={formatTabSetting(s)}>{formatTabSetting(s)}</SelectItem>
          ))}
        </Select>
      </div>
      <div className={`w-full bg-default-100 ${tst} rounded-xl p-2`}>
        <div className={"relative w-full"}>
          <pre
            className={"w-full font-mono overflow-auto text-foreground top-0 left-0 absolute"}
            ref={refHighlighting}
            dangerouslySetInnerHTML={{ __html: highlightedHTML() }}
            style={{ height: `${heightPx}px` }}
          ></pre>
          <textarea
            className={`w-full font-mono min-h-[20em] text-[transparent] placeholder-default-400 ${tst} caret-foreground bg-transparent outline-none relative`}
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
