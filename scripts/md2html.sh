#!/bin/bash

md_file="$1"
html_file="$2"

cat > "$html_file" <<-EOF
<!DOCTYPE html>
<head>
  <meta charset='UTF-8'>
  <title>Yet another pastebin</title>
  <link rel="stylesheet" href="https://pages.github.com/assets/css/style.css"/>
  <link rel="icon" href="${FAVICON_URL}" type="image/png"/>
</head>
<div class="container-lg px-3 my-5 markdown-body">
EOF

pandoc "$md_file" -o - >> "$html_file"

cat >> "$html_file" <<-EOF
</div>
</body>
EOF

