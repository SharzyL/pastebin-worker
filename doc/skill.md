---
name: shz-al
description: Upload, fetch, update, or delete text/binary content via {{BASE_URL}}, a pastebin with a command-line client. Use when you need a quick URL for sharing long output, hosting a small file, shortening a URL, or rendering markdown as HTML.
---

# shz.al

A pastebin hosted on Cloudflare Workers at `{{BASE_URL}}`. Use the `pb`
command-line client: it encrypts pastes on the client by default, remembers the
passwords and keys of your uploads, and splits large files automatically. If
`pb` is not available or you need plain HTTP, use `curl` as described in
`{{BASE_URL}}/doc/curl.md`.

## Install `pb`

`pb` needs `python3` with the `requests` and `cryptography` packages
(`cryptography` is only needed for encryption, so `pb post -u` works without it).

```shell
curl -fsSL https://raw.githubusercontent.com/SharzyL/pastebin-worker/goshujin/scripts/pb -o ~/.local/bin/pb
chmod +x ~/.local/bin/pb
pip install requests cryptography    # or the python3-requests / python3-cryptography system packages
export PB_DOMAIN={{BASE_URL}}    # not needed for https://shz.al, the default; or pass --base-url to every command
```

With Nix, skip `pip` and replace the first line of `pb` with the following, so
that it runs in a Python environment with both packages (requires the
`nix-command` and `flakes` experimental features):

```shell
#!/usr/bin/env -S nix run --impure --expr '(import (builtins.getFlake "nixpkgs") {}).python3.withPackages (ps: [ ps.requests ps.cryptography ])' '' --
```

## Upload

```shell
pb post -c 'hello, world'        # text
pb post file.png                 # file, stored with its filename
<cmd> | pb post                  # stdin
pb post -u -c 'hello, world'     # without encryption
```

The response is JSON:

```json
{
  "url": "{{BASE_URL}}/abcd",
  "manageUrl": "{{BASE_URL}}/abcd:<password>",
  "decryptionUrl": "{{BASE_URL}}/d/abcd#<key>",
  "expireAt": "2026-05-21T10:33:06.114Z"
}
```

Pastes are encrypted by default, so:

- **Share `decryptionUrl`.** It opens the paste in a browser, which decrypts it
  with the key after `#`; the key never reaches the server.
- `url` returns the ciphertext only. Upload with `-u/--unencrypted` when the
  paste must be readable by plain HTTP clients such as `curl`, or when it is
  used as a URL shortener.

`pb` records the manage URL and the key in its history file
(`~/.local/state/pb/history.jsonl`), so later `update`, `get` and `delete`
calls on the same machine only need the paste name, and `pb list` shows the
pastes uploaded from there. Keep `manageUrl` yourself if the paste may be
managed from elsewhere — it is the only way to authenticate as the owner.

## Upload options

- `-n <name>` — custom name (≥3 chars, returned prefixed with `~`).
- `-e <expire>` — expiration: integer/float with unit `s`/`m`/`h`/`d`
  (default seconds). E.g. `-e 30m`, `-e 14d`.
- `-s <password>` — set a specific management password.
- `-p` — private mode: 24-char unguessable random name.
- `-F <filename>` — filename stored with the paste.

## Fetch

```shell
pb get <name>                    # content, decrypted with the key from history
pb get <name> -K <key>           # decrypt with an explicit key
pb get <decryptionUrl>           # any paste URL works; the endpoint and key come from it
pb get <name> --save [DIR]       # save with the server-provided filename
pb get <name> --meta             # JSON metadata (size, dates, …)
```

## Update / delete

```shell
pb update <name> -c 'new content'   # password looked up from history
pb update <manageUrl> -f file      # endpoint and password come from the URL
pb delete <name>
pb list                             # pastes uploaded from here, with their URLs
```

`update` accepts `-e`, `-s`, `-F` and `-u` like `post`; `-e` recalculates the
expiration from now. An encrypted update uses a fresh key, so it prints a new
`decryptionUrl` and the old one stops working.

## Other URL forms

- `/d/<name>` — display code with syntax highlighting. Append `?lang=<lang>` to override
  the highlighting language.
- `/a/<name>` — render a markdown paste as HTML (GitHub-flavored Markdown + MathJax).
  For an encrypted paste, append `#<key>` like the decryption URL.
- `/u/<name>` — redirect to the URL stored in an unencrypted paste (URL shortener).
- `/m/<name>` — JSON metadata.

## Limitations

- Default expiration is `{{DEFAULT_EXPIRATION}}`, max `{{MAX_EXPIRATION}}`. Pastes are deleted on expiry.
- Max upload size is `{{R2_MAX_ALLOWED}}`.
- Only the content is encrypted; the name, filename, size and timestamps are
  visible to the server.
- Treat the service as ephemeral storage — do not rely on it for archival.

## Full docs

- `{{BASE_URL}}/doc/curl.md` — comprehensive curl guide.
- `{{BASE_URL}}/doc/api.md` — HTTP API reference.
- `{{BASE_URL}}/doc/paste-crypto.md` — how paste encryption works.
