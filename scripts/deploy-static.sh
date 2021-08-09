#!/bin/bash
# deploy the static pages on Cloudflare workers
# add argument --preview to deploy on preview namespace

declare -a files=('tos' 'index')

declare -a args=('wrangler' 'kv:key' 'put' '--binding=PB')

if [ "$1" == '--preview' ]; then
	args+=('--preview')
	shift
fi

[ $# -gt 0 ] && files=("$@")

for file in "${files[@]}"; do
	echo "${args[@]}" "$file" -p "static/$file.html"
done
