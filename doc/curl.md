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
  "url": "{{BASE_URL}}/abcd",
  "manageUrl": "{{BASE_URL}}/abcd:w2eHqyZGc@CQzWLN=BiJiQxZ",
  "expirationSeconds": 1209600,
  "expireAt": "2026-05-21T10:33:06.114Z"
}
```

Save `url` for sharing and `manageUrl` for later updates or deletion.

### Upload a file

```shell
$ curl -Fc=@panty.jpg {{BASE_URL}}
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
  "url": "{{BASE_URL}}/~hitagi",
  ...
}
```

The custom name is at least 3 characters long and may consist of letters,
digits, and `+_-[]*$=@,;/`. Note the leading `~` in the returned URL.

Because `curl` uses `;` and `,` as field separators, names containing those
characters need to be wrapped in extra quotes:

```shell
$ curl -Fc=@panty.jpg -Fn='"hi/hello;g,ood"' {{BASE_URL}}
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
$ curl -i -H 'If-Modified-Since: Wed, 01 May 2026 00:00:00 GMT' \
    {{BASE_URL}}/~hitagi
HTTP/2 304
```

## Inspecting metadata

```shell
$ curl {{BASE_URL}}/m/abcd
{
  "lastModifiedAt": "2026-05-05T10:33:06.114Z",
  "createdAt": "2026-05-01T10:33:06.114Z",
  "expireAt": "2026-05-08T10:33:06.114Z",
  "sizeBytes": 4096,
  "location": "KV",
  "filename": "a.jpg"
}
```

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
    {{BASE_URL}}/~hitagi:22@-OJWcTOH2jprTJWYadmDv
```

`PUT` accepts the same fields as `POST` (`c`, `e`, `s`). Note that `e`
recalculates the expiration starting from the update time.

## Deleting a paste

```shell
$ curl -X DELETE {{BASE_URL}}/~hitagi:22@-OJWcTOH2jprTJWYadmDv
the paste will be deleted in seconds
```

Deletion may take a few seconds to propagate globally.

## Tips

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
