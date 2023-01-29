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

  const match = /<h1>(.+?)<\/h1>/.exec(convertedHtml)
  const title = match ? match[1] : 'Untitled'

  return `<!DOCTYPE html>
<html lang='en'>
<head>
  <title>${title}</title>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/themes/prism.css' rel='stylesheet' />
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/line-numbers/prism-line-numbers.css' rel='stylesheet' />
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
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/components/prism-core.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/line-numbers/prism-line-numbers.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/autoloader/prism-autoloader.min.js'></script>
</html>
`
}
