# Pastebin Worker

A pastebin running on Cloudflare Workers. Visit {{BASE_URL}} in a browser for the full UI, or use
`curl` from the terminal.

## Quick start

```shell
$ curl -Fc='hello, world' {{BASE_URL}}        # upload text
$ curl -Fc=@file.txt      {{BASE_URL}}        # upload a file
$ echo 'hello' | curl -Fc=@- {{BASE_URL}}     # upload from stdin
```

The response includes a `url` to share and a `manageUrl` for updates and
deletion.

## More

```shell
$ curl {{BASE_URL}}/doc/curl.md    # comprehensive curl usage
$ curl {{BASE_URL}}/doc/api.md     # HTTP API reference
$ curl {{BASE_URL}}/doc/skill.md   # AI agent skill (concise, ready to feed into a coding agent)
$ curl {{BASE_URL}}/doc/tos.md     # terms of service
```

Source: {{REPO}}
