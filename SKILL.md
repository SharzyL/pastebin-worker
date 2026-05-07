---
name: shz-al
description: Upload, fetch, update, or delete text/binary content via shz.al, a curl-friendly pastebin. Use when you need a quick public URL for sharing long output, hosting a small file, shortening a URL, or rendering markdown as HTML.
---

# shz.al

A pastebin hosted on Cloudflare Workers at `https://shz.al`. Every operation is
plain HTTP and works with `curl`. Random paste names appear bare (e.g. `abcd`);
custom names are returned with a leading `~` (e.g. `~hitagi`).

## Upload

```shell
curl -Fc='hello, world' https://shz.al        # text
curl -Fc=@file.png      https://shz.al        # file
<cmd> | curl -Fc=@-     https://shz.al        # stdin
```

Response:

```json
{
  "url": "https://shz.al/abcd",
  "manageUrl": "https://shz.al/abcd:<password>",
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
curl https://shz.al/<name>                    # raw content
curl -OJ https://shz.al/~<name>               # save with server filename
curl https://shz.al/m/<name>                  # JSON metadata (size, dates, …)
curl -I https://shz.al/<name>                 # HEAD only
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

## Full docs

- `https://shz.al/doc/curl.md` — comprehensive curl guide.
- `https://shz.al/doc/api.md` — HTTP API reference.
