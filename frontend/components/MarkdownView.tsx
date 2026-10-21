import type React from "react"
import { useEffect, useRef, useState } from "react"

import { highlightCodeBlocks } from "../utils/highlight-client.js"

import "../styles/markdown.css"
import "../styles/highlight-theme-light.css"
import "../styles/highlight-theme-dark.css"

interface MarkdownViewProps {
  content: string
  className?: string
}

// Clicking a link must not navigate this page: an in-page `#anchor` would
// replace the URL fragment, and leaving the page loses its content
function openLinksElsewhere(e: React.MouseEvent<HTMLDivElement>) {
  const link = (e.target as Element).closest("a")
  if (link === null) return
  e.preventDefault()
  const href = link.getAttribute("href")
  if (href && !href.startsWith("#")) window.open(link.href, "_blank", "noopener,noreferrer")
}

// Sanitized markdown rendering; the renderer is loaded on first use
export function MarkdownView({ content, className = "" }: MarkdownViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setHtml(undefined)
    import("../../shared/markdown.js")
      .then(({ renderMarkdown }) => {
        if (!cancelled) setHtml(renderMarkdown(content, { headingAnchors: false, untrusted: true }).html)
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [content])

  useEffect(() => {
    if (html !== undefined && ref.current) highlightCodeBlocks(ref.current).catch(console.error)
  }, [html])

  if (html === undefined) {
    return <div className={`text-default-500 ${className}`}>Rendering…</div>
  }
  return (
    <div
      ref={ref}
      className={`markdown-view ${className}`}
      onClick={openLinksElsewhere}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
