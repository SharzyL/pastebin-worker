import {unified} from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

export async function makeMarkdown(content) {
  const convertedHtml = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(content)

  return `<!DOCTYPE html>
<html lang='en'>
<head>
  <title>Yet another pastebin</title>
  <meta charset='utf-8'>
  <link rel='stylesheet' href='https://pages.github.com/assets/css/style.css'>
</head>
<body class='line-numbers'>
<article class='container-lg px-3 my-5 markdown-body'>
${convertedHtml}
</article>
</html>
`
}
