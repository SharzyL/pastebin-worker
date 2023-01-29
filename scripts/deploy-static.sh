#!/usr/bin/env bash
# deploy the static pages on Cloudflare workers
# add argument --preview to deploy on preview namespace

set -e

declare -a args=('yarn' 'wrangler' 'kv:key' 'put' '--binding=PB')

if [ "$1" == '--preview' ]; then
	args+=('--env' 'preview')
	shift
fi

declare -a files=("$@")

set -x
for file in "${files[@]}"; do
	file_base=$(basename "$file")
	"${args[@]}" "${file_base%.html}" --path "$file"
done
