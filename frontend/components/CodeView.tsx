import { Fragment } from "react"
import { highlightHTML, splitHighlightedLines, useHljsForLang } from "../utils/highlight.js"

interface CodeViewProps {
  content: string
  lang?: string
  className?: string
  wrap?: boolean
}

// Read-only, syntax highlighted code with line numbers. With `wrap`, long
// lines wrap instead of scrolling horizontally.
export function CodeView({ content, lang, className = "", wrap = false }: CodeViewProps) {
  const hljs = useHljsForLang(lang)
  const highlightedHTML = highlightHTML(hljs, lang, content)
  const lineCount = (highlightedHTML.match(/\n/g)?.length || 0) + 1
  const lineNumOffset = `${Math.floor(Math.log10(lineCount)) + 3}ch`

  if (wrap) {
    // the gap puts the code where the unwrapped view has it: the gutter there
    // is as wide as the widest number plus 0.5em, and the code `lineNumOffset` in
    return (
      <div className={`font-mono wrapped-lines grid grid-cols-[auto_minmax(0,1fr)] ${className}`} role="article">
        {splitHighlightedLines(highlightedHTML).map((line, idx) => (
          <Fragment key={idx}>
            <span className="line-number text-right pr-[0.5em] select-none text-default-500 border-solid border-default-300 border-r-1" />
            <div
              className="pl-[calc(2ch-0.5em)] min-h-lh whitespace-pre-wrap wrap-anywhere"
              dangerouslySetInnerHTML={{ __html: line }}
            />
          </Fragment>
        ))}
      </div>
    )
  }

  return (
    <div className={`font-mono relative ${className}`} role="article">
      <pre
        style={{ marginLeft: lineNumOffset, width: `calc(100% - ${lineNumOffset})` }}
        dangerouslySetInnerHTML={{ __html: highlightedHTML }}
        className={"overflow-x-auto"}
      />
      <span
        className={
          "line-number-rows absolute pointer-events-none text-default-500 top-0 left-0 " +
          "border-solid border-default-300 border-r-1"
        }
      >
        {Array.from({ length: lineCount }, (_, idx) => {
          return <span key={idx} />
        })}
      </span>
    </div>
  )
}
