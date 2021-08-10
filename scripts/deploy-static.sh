#!/bin/bash
# deploy the static pages on Cloudflare workers
# add argument --preview to deploy on preview namespace

declare -a args=('wrangler' 'kv:key' 'put' '--binding=PB')

if [ "$1" == '--preview' ]; then
	args+=('--preview')
	shift
fi

declare -a files=("$@")

for file in "${files[@]}"; do
	file_base=$(basename "$file")
	"${args[@]}" "${file_base%.html}" -p "$file"
done
