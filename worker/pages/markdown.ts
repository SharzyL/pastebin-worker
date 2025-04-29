import { unified } from "unified"
import { Root } from "mdast"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import { toString } from "mdast-util-to-string"

import { escapeHtml } from "../common.js"

const descriptionLimit: number = 200
const defaultTitle: string = "Untitled"

type DocMetadata = {
  title: string
  description: string
}

function getMetadata(options: { result: DocMetadata }): (_: Root) => void {
  return (tree: Root) => {
    if (tree.children.length === 0) return

    const firstChild = tree.children[0]
    // if the document begins with a h1, set its content as the title
    if (firstChild.type === "heading" && firstChild.depth === 1) {
      options.result.title = escapeHtml(toString(firstChild))

      if (tree.children.length > 1) {
        // description is set as the content of the second node
        const secondChild = tree.children[1]
        options.result.description = escapeHtml(toString(secondChild).slice(0, descriptionLimit))
      }
    } else {
      // no title is set
      // description is set as the content of the first node
      options.result.description = escapeHtml(toString(firstChild).slice(0, descriptionLimit))
    }
  }
}

export function makeMarkdown(content: string): string {
  const metadata: DocMetadata = { title: defaultTitle, description: "" }
  const convertedHtml = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(getMetadata, { result: metadata }) // result is written to `metadata` variable
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(content)
    .value.toString()

  return `<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>
  <title>${metadata.title}</title>
  ${metadata.description.length > 0 ? `<meta name='description' content='${metadata.description}'>` : ""}
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/themes/prism.css' rel='stylesheet' />
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/plugins/line-numbers/prism-line-numbers.css' rel='stylesheet' />
  <link rel='stylesheet' href='https://pages.github.com/assets/css/style.css'>
  <script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
  <script id="MathJax-script" async
          src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js">
  </script>
</head>
<body>
<article class='line-numbers container-lg px-3 my-5 markdown-body'>
${convertedHtml}
</article>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/components/prism-core.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/plugins/line-numbers/prism-line-numbers.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.30.0/plugins/autoloader/prism-autoloader.min.js'></script>
</html>
`
}
