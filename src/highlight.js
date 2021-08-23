String.prototype.escapeHtml = function () {
  const tagsToReplace = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot",
    "'": "&#x27"
  }
  return this.replace(/[&<>]/g, function (tag) {
    return tagsToReplace[tag] || tag
  })
}

export function makeHighlight(content, lang) {
  return `<!DOCTYPE html>
<html lang='en'>
<head>
  <title>Yet another pastebin</title>
  <meta charset='utf-8'>
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/themes/prism.css' rel='stylesheet' />
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/line-numbers/prism-line-numbers.css' rel='stylesheet' />
</head>
<body class='line-numbers'>
<pre><code class='language-${lang.escapeHtml()}'>${content.escapeHtml()}</code></pre>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/components/prism-core.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/line-numbers/prism-line-numbers.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/autoloader/prism-autoloader.min.js'></script>
</body>
</html>
`
}
