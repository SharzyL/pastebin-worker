# CLI Usage with `curl`

A comprehensive guide to using this pastebin from the command line. For the
full HTTP API reference, see [api.md]({{BASE_URL}}/doc/api).

## Conventions

- `<name>` — the random name (e.g. `abcd`) or custom name (prefixed with `~`,
  e.g. `~hitagi`) of a paste.
- `<passwd>` — the password returned at upload time, used to update or delete
  the paste.
- `<expire>` — an expiration period: an integer or float, optionally suffixed
  with `s` (seconds, default), `m` (minutes), `h` (hours), or `d` (days). For
  example, `300`, `30m`, `25d`.

## Uploading

### Upload text content

```shell
$ curl -Fc='hello, world' {{BASE_URL}}
{
  "lastModifiedAt": "2026-11-10T03:08:13.000Z",
  "createdAt": "2026-11-10T03:08:13.000Z",
  "expireAt": "2026-11-17T03:08:13.000Z",
  "sizeBytes": 12,
  "location": "KV",
  "url": "{{BASE_URL}}/sCMi",
  "manageUrl": "{{BASE_URL}}/sCMi:x7wkFAHpyspi2PcxRaN7Shrh",
  "expirationSeconds": 604800
}
```

Save `url` for sharing and `manageUrl` for later updates or deletion. The
other fields are the paste's metadata, the same as `/m/<name>` returns; a
`filename`, `highlightLanguage` or `encryptionScheme` field shows up when the
upload set one.

### Upload a file

```shell
$ curl -Fc=@panty.jpg {{BASE_URL}}
{
  "lastModifiedAt": "2026-11-10T03:08:13.000Z",
  "createdAt": "2026-11-10T03:08:13.000Z",
  "expireAt": "2026-11-17T03:08:13.000Z",
  "sizeBytes": 48812,
  "location": "R2",
  "filename": "panty.jpg",
  "url": "{{BASE_URL}}/Vk3d",
  "manageUrl": "{{BASE_URL}}/Vk3d:3EtywPhWs3MhtcEsiH338CmX",
  "expirationSeconds": 604800
}
```

The original filename will be sent back as the `Content-Disposition` header
when the paste is fetched.

### Upload from stdin

```shell
$ echo 'hello' | curl -Fc=@- {{BASE_URL}}
$ cat panty.jpg | curl -Fc=@- {{BASE_URL}}
```

### Set an expiration

```shell
$ curl -Fc='kawaii' -Fe=300 {{BASE_URL}}      # 300 seconds
$ curl -Fc='kawaii' -Fe=2h  {{BASE_URL}}      # 2 hours
$ curl -Fc=@big.bin -Fe=30d {{BASE_URL}}      # 30 days
```

If `e` is not specified, the default expiration of the deployment is used. The
maximum expiration is also enforced by the deployment.

### Use a custom name

```shell
$ curl -Fc='kawaii' -Fn=hitagi {{BASE_URL}}
{
  ...
  "url": "{{BASE_URL}}/~hitagi",
  "manageUrl": "{{BASE_URL}}/~hitagi:WRQfDZnR7GX5ZAJshs5cz84W",
  "expirationSeconds": 604800
}
```

The custom name is at least 3 characters long and may consist of letters,
digits, and `+_-[]*$@,;`. Note the leading `~` in the returned URL. A name
that is taken returns `409`.

Because `curl` uses `;` and `,` as field separators, names containing those
characters need to be wrapped in extra quotes:

```shell
$ curl -Fc=@panty.jpg -Fn='"hi;hello,good"' {{BASE_URL}}
```

### Set a custom password

```shell
$ curl -Fc='kawaii' -Fs=12345678 {{BASE_URL}}
```

If `s` is omitted, a random password is generated and returned in `manageUrl`.

### Private mode (longer random name)

```shell
$ curl -Fc='secret' -Fp=1 {{BASE_URL}}
```

Without a custom name (`n`), `p` produces a 24-character random name, making
the paste effectively unguessable.

### Mark a paste as syntax-highlighted

```shell
$ curl -Fc=@main.rs -Flang=rust {{BASE_URL}}
{
  ...
  "highlightLanguage": "rust",
  ...
}
```

The `lang` field is sent back as the `X-PB-Highlight-Language` header on
fetching the paste, and is used by the display page (`/d/<name>`).

## Fetching

### Fetch raw content

```shell
$ curl {{BASE_URL}}/abcd
hello, world
```

### Save the response to a file

```shell
$ curl {{BASE_URL}}/~panty.jpg -o panty.jpg
$ curl -OJ {{BASE_URL}}/~panty               # use server-supplied filename
```

`-J` honors the `Content-Disposition` header set from the original filename.
Headers of a paste look like this:

```shell
$ curl -I {{BASE_URL}}/~panty
HTTP/2 200
content-type: image/jpeg
content-length: 48812
content-disposition: inline; filename*=UTF-8''panty.jpg
last-modified: Tue, 10 Nov 2026 03:08:13 GMT
cache-control: public, max-age=600
x-content-type-options: nosniff
access-control-allow-origin: *
access-control-expose-headers: Content-Disposition
```

A text paste also carries `content-security-policy: sandbox ...`, so that a
browser opening it directly cannot touch the site's data; see `api.md`.

### Force download (attachment)

```shell
$ curl '{{BASE_URL}}/abcd?a' -OJ
```

The `?a` query string sets `Content-Disposition: attachment`.

### Override mime type

```shell
$ curl '{{BASE_URL}}/~panty.jpg?mime=image/png' \
    -w '%{content_type}\n' -o /dev/null -sS
image/png
```

Or via path extension:

```shell
$ curl '{{BASE_URL}}/abcd.json' -i
```

### Pipe to another tool

```shell
$ curl {{BASE_URL}}/~panty.jpg | feh -
$ curl {{BASE_URL}}/~config | jq .
```

### Conditional fetch with `If-Modified-Since`

```shell
$ curl -I -H 'If-Modified-Since: Wed, 11 Nov 2026 00:00:00 GMT' \
    {{BASE_URL}}/~hitagi
HTTP/2 304
```

## Inspecting metadata

```shell
$ curl {{BASE_URL}}/m/~panty
{
  "lastModifiedAt": "2026-11-10T03:08:13.000Z",
  "createdAt": "2026-11-10T03:08:13.000Z",
  "expireAt": "2026-11-17T03:08:13.000Z",
  "sizeBytes": 48812,
  "location": "R2",
  "filename": "panty.jpg"
}
```

`filename`, `highlightLanguage` and `encryptionScheme` are present only when
the upload set them. `location` tells whether the content lives in KV (small
pastes) or R2 (large ones).

A `HEAD` request returns the same headers as `GET` without the body, useful
for quickly checking size and `Content-Type`:

```shell
$ curl -I {{BASE_URL}}/abcd
```

## URL shortener

Upload a short URL, then redirect through `/u/<name>`:

```shell
$ curl -Fc='https://example.com/very/long/path' -Fn=ex {{BASE_URL}}
$ curl -L {{BASE_URL}}/u/~ex
```

## Markdown rendering

Upload a markdown file and render it as HTML via `/a/<name>`:

```shell
$ curl -Fc=@README.md -Fn=readme {{BASE_URL}}
$ firefox {{BASE_URL}}/a/~readme
```

GitHub-flavored Markdown is supported, along with syntax highlighting and
LaTeX math via MathJax.

## Updating an existing paste

Use the `manageUrl` returned at upload time:

```shell
$ curl -X PUT -Fc='kawaii~' \
    {{BASE_URL}}/~hitagi:WRQfDZnR7GX5ZAJshs5cz84W
{
  "lastModifiedAt": "2026-11-10T03:09:02.000Z",
  "createdAt": "2026-11-10T03:08:13.000Z",
  "expireAt": "2026-11-17T03:08:13.000Z",
  "sizeBytes": 7,
  "location": "KV",
  "url": "{{BASE_URL}}/~hitagi",
  "manageUrl": "{{BASE_URL}}/~hitagi:WRQfDZnR7GX5ZAJshs5cz84W",
  "expirationSeconds": 604800
}
```

`PUT` accepts the same fields as `POST` (`c`, `e`, `s`, `lang`,
`encryption-scheme`) except `n`, and answers like `POST`. Note that `e`
recalculates the expiration starting from the update time; without it the
expiration is kept.

## Deleting a paste

```shell
$ curl -X DELETE {{BASE_URL}}/~hitagi:WRQfDZnR7GX5ZAJshs5cz84W
the paste will be deleted in seconds
```

Deletion may take a few seconds to propagate globally.

With a wrong password, both `PUT` and `DELETE` answer `403`:

```shell
$ curl -X DELETE {{BASE_URL}}/~hitagi:wrongpassword
Error 403: incorrect password for paste '~hitagi'
```

## Tips

- Add this line to `~/.curlrc` so that URLs without a scheme, such as
  `curl shz.al/abcd`, use HTTPS rather than plain HTTP. Uploads then never
  leave your machine unencrypted, and you skip the redirect to HTTPS, which
  `curl` does not follow by default:

  ```
  proto-default = "https"
  ```

- Pipe long output through `jq` to inspect upload responses:

  ```shell
  $ curl -sFc='hi' {{BASE_URL}} | jq -r .url
  ```

- Save the management URL into a variable to chain commands:

  ```shell
  $ resp=$(curl -sFc=@notes.md {{BASE_URL}})
  $ url=$(jq  -r .url       <<<"$resp")
  $ mgmt=$(jq -r .manageUrl  <<<"$resp")
  ```

- For files larger than the `R2_THRESHOLD` of the deployment, content is
  stored in R2 instead of KV transparently — no client change is needed.

- The maximum allowed upload size is set per deployment via `R2_MAX_ALLOWED`.
  Exceeding it returns HTTP `413`.

- A single HTTP request body is capped at **100 MB** by Cloudflare Workers
  (HTTP `413 Payload Too Large` is returned before the request ever reaches
  the worker), regardless of the deployment's `R2_MAX_ALLOWED`. To upload
  larger files, use the web UI at `{{BASE_URL}}` or the
  [`pb`](https://github.com/SharzyL/pastebin-worker/tree/goshujin/scripts)
  CLI — both automatically switch to a multipart upload that streams 5 MiB
  chunks through the `/mpu/*` endpoints.

## Common errors

Errors come as plain text, `Error <status>: <message>`, for example
`Error 404: paste of name 'zzzz' not found` or
`Error 400: Name should have at least 3 characters`.

| Status | Meaning                                                                                                                                                 |
| -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  `400` | Malformed request (bad field, illegal name, bad expire).                                                                                                |
|  `403` | Wrong password when updating or deleting.                                                                                                               |
|  `404` | Paste not found, or already expired.                                                                                                                    |
|  `409` | Custom name is already in use.                                                                                                                          |
|  `413` | Request body exceeds 100 MB (platform cap, intercepted by Cloudflare before reaching the worker), or content exceeds the deployment's `R2_MAX_ALLOWED`. |
|  `500` | Unexpected server error — please report it.                                                                                                             |

For the full HTTP API including `HEAD`, `OPTIONS`, response headers, and edge
cases, see [api.md]({{BASE_URL}}/doc/api).
