# API Reference

## GET `/`

Return the index page.

## **GET** `/<name>[.<ext>]` or `/<name>/<filename>[.<ext>]`

Fetch the paste with name `<name>`. By default, it will return the raw content of the paste.

The `Content-Type` header is set to `text/plain;charset=UTF-8`. If `<ext>` is given, the worker will infer mime-type from `<ext>` and change `Content-Type`. This method accepts the following query string parameters:

The `Content-Disposition` header is set to `inline` by default. But can be overriden by `?a` query string. If the paste is uploaded with filename, or `<filename>` is set in given request URL, `Content-Disposition` is appended with `filename*` indicating the filename (with `<ext>` if it exists).

- `?a=`: optional. Set `Content-Disposition` to `attachment` if present.

- `?lang=<lang>`: optional. Returns a web page with syntax highlight powered by prism.js.

- `?mime=<mime>`: optional. Specify the mime-type, suppressing the effect of `<ext>`. No effect if `lang` is specified (in which case the mime-type is always `text/html`).

Examples: `GET /abcd?lang=js`, `GET /abcd?mime=application/json`.

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ curl https://shz.al/i-p-
https://web.archive.org/web/20210328091143/https://mp.weixin.qq.com/s/5phCQP7i-JpSvzPEMGk56Q

$ curl https://shz.al/~panty.jpg | feh -

$ firefox 'https://shz.al/kf7z?lang=nix'

$ curl 'https://shz.al/~panty.jpg?mime=image/png' -w '%{content_type}' -o /dev/null -sS
image/png;charset=UTF-8
```

## GET `/<name>:<passwd>`

Return the web page to edit the paste of name `<name>` and password `<passwd>`.

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

## GET `/u/<name>`

Redirect to the URL recorded in the paste of name `<name>`.

If error occurs, the worker returns status code different from `302`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ firefox https://shz.al/u/i-p-

$ curl -L https://shz.al/u/i-p-
```

## GET `/a/<name>`

Return the HTML converted from the markdown file stored in the paste of name `<name>`. The markdown conversion follows GitHub Flavored Markdown (GFM) Spec, supported by [remark-gfm](https://github.com/remarkjs/remark-gfm).

Syntax highlighting is supported by [prims.js](https://prismjs.com/). LaTeX mathematics is supported by [MathJax](https://www.mathjax.org).

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```md
# Header 1
This is the content of `test.md`

<script>
alert("Script should be removed")
</script>

## Header 2

| abc | defghi |
:-: | -----------:
bar | baz

**Bold**, `Monospace`, *Italics*, ~~Strikethrough~~, [URL](https://github.com)

- A
 - A1
 - A2
- B

![Panty](https://shz.al/~panty.jpg)

1. first
2. second

> Quotation

$$
\int_{-\infty}^{\infty} e^{-x^2} = \sqrt{\pi}
$$

```

```shell
$ curl -Fc=@test.md -Fn=test-md https://shz.al

$ firefox https://shz.al/a/~test-md
```

## **POST** `/`

Upload your paste. It accept parameters in form-data:

- `c`: mandatory. The **content** of your paste, text of binary. It should be no larger than 10 MB. The `filename` in its `Content-Disposition` will be present when fetching the paste.

- `e`: optional. The **expiration** time of the paste. After this period of time, the paste is permanently deleted. It should be an integer or a float point number suffixed with an optional unit (seconds by default). Supported units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `M` (months). For example, `360.24` means 360.25 seconds; `25d` is interpreted as 25 days. The actual expiration might be shorter than specified expiration due to limitations imposed by the administrator. If unspecified, a default expiration time setting is used.

- `s`: optional. The **password** which allows you to modify and delete the paste. If not specified, the worker will generate a random string as password.

- `n`: optional. The customized **name** of your paste. If not specified, the worker will generate a random string (4 characters by default) as the name. You need to prefix the name with `~` when fetching the paste of customized name. The name is at least 3 characters long, consisting of alphabet, digits and characters in `+_-[]*$=@,;/`.

- `p`: optional. The flag of **private mode**. If specified to any value, the name of the paste is as long as 24 characters. No effect if `n` is used.

`POST` method returns a JSON string by default, if no error occurs, for example:

```json
{
    "url": "https://shz.al/abcd",
    "manageUrl": "https://shz.al/abcd:w2eHqyZGc@CQzWLN=BiJiQxZ",
    "expirationSeconds": 1209600,
    "expireAt": "2025-05-05T10:33:06.114Z"
}
```

Explanation of the fields:

- `url`: String. The URL to fetch the paste. When using a customized name, it looks like `https//shz.al/~myname`.
- `suggestedUrl`: String or null. The URL that may carry filename or URL redirection.
- `manageUrl`: String. The URL to update and delete the paste, which is `url` suffixed by `~` and the password.
- `expirationSeconds`: String. The expiration seconds.
- `expireAt`: String. An ISO String representing when the paste will expire.

If error occurs, the worker returns status code different from `200`:

- `400`: your request is in bad format.
- `409`: the name is already used.
- `413`: the content is too large.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ curl -Fc="kawaii" -Fe=300 -Fn=hitagi https://shz.al  # uploading some text
{
  "url": "https://shz.al/~hitagi",
  "manageUrl": "https://shz.al/~hitagi:22@-OJWcTOH2jprTJWYadmDv",
  "expirationSeconds": 300,
  "expireAt": "2025-05-05T10:33:06.114Z"
}

$ curl -Fc=@panty.jpg -Fn=panty -Fs=12345678 https://shz.al   # uploading a file
{
  "url": "https://shz.al/~panty",
  "manageUrl": "https://shz.al/~panty:12345678",
  "expirationSeconds": 1209600,
  "expireAt": "2025-05-05T10:33:06.114Z"
}

# because `curl` takes some characters as filed separator, the fields should be
# quoted by double-quotes if the field contains semicolon or comma
$ curl -Fc=@panty.jpg -Fn='"hi/hello;g,ood"' -Fs=12345678 https://shz.al
{
  "url": "https://shz.al/~hi/hello;g,ood",
  "manageUrl": "https://shz.al/~hi/hello;g,ood:QJhMKh5WR6z36QRAAn5Q5GZh",
  "expirationSeconds": 1209600,
  "expireAt": "2025-05-05T10:33:06.114Z"
}
```

## **PUT** `/<name>:<passwd>`

Update you paste of the name `<name>` and password `<passwd>`. It accept the parameters in form-data:

- `c`: mandatory. Same as `POST` method.
- `e`: optional. Same as `POST` method. Note that the deletion time is now recalculated.
- `s`: optional. Same as `POST` method.

The returning of `PUT` method is the same as `POST` method.

If error occurs, the worker returns status code different from `200`:

- `400`: your request is in bad format.
- `403`: your password is not correct.
- `404`: the paste of given name is not found.
- `413`: the content is too large.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ curl -X PUT -Fc="kawaii~" -Fe=500 https://shz.al/~hitagi:22@-OJWcTOH2jprTJWYadmDv
{
  "url": "https://shz.al/~hitagi",
  "manageUrl": "https://shz.al/~hitagi:22@-OJWcTOH2jprTJWYadmDv",
  "expirationSeconds": 500,
  "expireAt": "2025-05-05T10:33:06.114Z"
}

$ curl -X PUT -Fc="kawaii~" https://shz.al/~hitagi:22@-OJWcTOH2jprTJWYadmDv
{
  "url": "https://shz.al/~hitagi",
  "manageUrl": "https://shz.al/~hitagi:22@-OJWcTOH2jprTJWYadmDv",
  "expirationSeconds": 500,
  "expireAt": "2025-05-05T10:33:06.114Z"
}
```

## DELETE `/<name>:<passwd>`

Delete the paste of name `<name>` and password `<passwd>`. It may take seconds to synchronize the deletion globally.

If error occurs, the worker returns status code different from `200`:

- `403`: your password is not correct.
- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ curl -X DELETE https://shz.al/~hitagi:22@-OJWcTOH2jprTJWYadmDv
the paste will be deleted in seconds

$ curl https://shz.al/~hitagi
not found
```
