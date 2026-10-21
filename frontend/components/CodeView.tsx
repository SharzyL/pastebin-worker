import { highlightHTML, useHljsForLang } from "../utils/highlight.js"

interface CodeViewProps {
  content: string
  lang?: string
  className?: string
}

// Read-only, syntax highlighted code with line numbers
export function CodeView({ content, lang, className = "" }: CodeViewProps) {
  const hljs = useHljsForLang(lang)
  const highlightedHTML = highlightHTML(hljs, lang, content)
  const lineCount = (highlightedHTML.match(/\n/g)?.length || 0) + 1
  const lineNumOffset = `${Math.floor(Math.log10(lineCount)) + 3}ch`

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
