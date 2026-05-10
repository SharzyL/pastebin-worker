---
name: shz-al
description: Upload, fetch, update, or delete text/binary content via {{BASE_URL}}, a curl-friendly pastebin. Use when you need a quick public URL for sharing long output, hosting a small file, shortening a URL, or rendering markdown as HTML.
---

# shz.al

A pastebin hosted on Cloudflare Workers at `{{BASE_URL}}`. Every operation is
plain HTTP and works with `curl`. Random paste names appear bare (e.g. `abcd`);
custom names are returned with a leading `~` (e.g. `~hitagi`).

## Upload

```shell
curl -Fc='hello, world' {{BASE_URL}}        # text
curl -Fc=@file.png      {{BASE_URL}}        # file
<cmd> | curl -Fc=@-     {{BASE_URL}}        # stdin
```

Response:

```json
{
  "url": "{{BASE_URL}}/abcd",
  "manageUrl": "{{BASE_URL}}/abcd:<password>",
  "expireAt": "2026-05-21T10:33:06.114Z"
}
```

Persist `manageUrl` if the paste may need to be updated or deleted later — it
is the only way to authenticate as the owner.

## Optional upload fields

- `-Fn=<name>` — custom name (≥3 chars, returned prefixed with `~`).
- `-Fe=<expire>` — expiration: integer/float with unit `s`/`m`/`h`/`d`
  (default seconds). E.g. `-Fe=30m`, `-Fe=14d`.
- `-Fs=<password>` — set a specific management password.
- `-Flang=<lang>` — mark for syntax highlighting on the display page.
- `-Fp=1` — private mode: 24-char unguessable random name.

## Fetch

```shell
curl {{BASE_URL}}/<name>                    # raw content
curl -OJ {{BASE_URL}}/~<name>               # save with server filename
curl {{BASE_URL}}/m/<name>                  # JSON metadata (size, dates, …)
curl -I {{BASE_URL}}/<name>                 # HEAD only
```

Append `?a` for `Content-Disposition: attachment`, `?mime=<mime>` to override
the response Content-Type, or append `.<ext>` to the path to set Content-Type
by extension.

## Update / delete

```shell
curl -X PUT    -Fc='new content' <manageUrl>
curl -X DELETE                   <manageUrl>
```

`PUT` accepts the same fields as upload; `e` recalculates expiration from now.

## Other URL forms

- `/d/<name>` — display page with syntax highlighting.
- `/a/<name>` — render the paste as HTML (GitHub-flavored Markdown + MathJax).
- `/u/<name>` — redirect to the URL stored in the paste (URL shortener).

## Limitations

- Default expiration is `{{DEFAULT_EXPIRATION}}`, max `{{MAX_EXPIRATION}}`. Pastes are deleted on expiry.
- Max upload size is `{{R2_MAX_ALLOWED}}`.
- Treat the service as ephemeral storage — do not rely on it for archival.

## Full docs

- `{{BASE_URL}}/doc/curl.md` — comprehensive curl guide.
- `{{BASE_URL}}/doc/api.md` — HTTP API reference.
