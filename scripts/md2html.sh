#!/usr/bin/env bash

md_file="$1"
html_file="$2"
title="$3"

cat > "$html_file" <<-EOF
<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='UTF-8'>
  <title>$title</title>
  <link rel="stylesheet" href="https://pages.github.com/assets/css/style.css"/>
  <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>
  <link rel="icon" href="{{FAVICON}}" type="image/png"/>
</head>
<body>
<div class="container-lg px-3 my-5 markdown-body">
EOF

yarn -s remark "$md_file" --use remark-html >> "$html_file"

cat >> "$html_file" <<-EOF
</div>
</body>
</html>
EOF
