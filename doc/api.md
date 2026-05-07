# HTTP API Reference

## GET `/`

Return the index page.

## **GET** `/<name>[.<ext>]` or `/<name>/<filename>`

Fetch the paste with name `<name>`. By default, it will return the raw content of the paste.

The `Content-Type` header is set to the mime type inferred from the filename of the paste, or `text/plain;charset=UTF-8` if no filename is present. If `<ext>` is given, the worker will infer mime-type from `<ext>` and change `Content-Type`. If the paste is uploaded with a filename, the worker will infer mime-type from the filename. This method accepts the following query string parameters:

The `Content-Disposition` header is set to `inline` by default. But can be overriden by `?a` query string. If the paste is uploaded with filename, or `<filename>` is set in given request URL, `Content-Disposition` is appended with `filename*` indicating the filename. If the paste is encrypted, the filename is appended with `.encrypted` suffix.

If the paste is encrypted, an `X-PB-Encryption-Scheme` header will be set to the encryption scheme.

If the paste is uploaded with a `lang` parameter, an `X-PB-Highlight-Language` header will be set to the highlight language.

- `?a=`: optional. Set `Content-Disposition` to `attachment` if present.

- `?mime=<mime>`: optional. Specify the mime-type, suppressing the effect of `<ext>`. No effect if `lang` is specified (in which case the mime-type is always `text/html`).

Examples: `GET /abcd?lang=js`, `GET /abcd?mime=application/json`.

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

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

## **GET** `/d/<name>[.<ext>]` or `/d/<name>/<filename>`

Return the web page that will display the content of the paste of name `<name>`. If the paste is encrypted, a key can be appended to the URL to decrypt the paste of name `<name>` in browser.

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

## GET `/m/<name>`

Get the metadata of the paste of name `<name>`.

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

The response body is a JSON object, for example:

```json
{
  "lastModifiedAt": "2025-05-05T10:33:06.114Z",
  "createdAt": "2025-05-01T10:33:06.114Z",
  "expireAt": "2025-05-08T10:33:06.114Z",
  "sizeBytes": 4096,
  "location": "KV",
  "filename": "a.jpg",
  "highlightLanguage": "rust",
  "encryptionScheme": "AES-GCM"
}
```

Explanation of the fields:

- `lastModifiedAt`: String. An ISO String representing the last modification time of the paste.
- `expireAt`: String. An ISO String representing when the paste will expire.
- `createdAt`: String. An ISO String representing when the paste was created.
- `sizeBytes`: Integer. The size of the content of the paste in bytes.
- `filename`: Optional string. The file name of the paste.
- `location`: String, either "KV" or "R2". Representing whether the paste content is stored in Cloudflare KV storage or R2 object storage.
- `highlightLanguage`: Optional string. The syntax highlighting language uploaded with the `lang` form field.
- `encryptionScheme`: Optional string. Currently only "AES-GCM" is possible. The encryption scheme used to encrypt the paste.

## GET `/a/<name>`

Return the HTML converted from the markdown file stored in the paste of name `<name>`. The markdown conversion follows GitHub Flavored Markdown (GFM) Spec, supported by [remark-gfm](https://github.com/remarkjs/remark-gfm).

Syntax highlighting is supported by [prism.js](https://prismjs.com/). LaTeX mathematics is supported by [MathJax](https://www.mathjax.org).

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
| :-: | -----: |
| bar |    baz |

**Bold**, `Monospace`, _Italics_, ~~Strikethrough~~, [URL](https://github.com)

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

## **HEAD** `/*`

Request a paste without returning the body. It accepts same parameters as all `GET` requests, and returns the same `Content-Type`, `Content-Disposition`, `Content-Length` and cache control headers with the corresponding `GET` request. Note that the `Content-Length` with `/a/<name>`, `?lang=<lang>` is the length of the paste instead of the length of the actual HTML page.

## **POST** `/`

Upload your paste. It accept parameters in form-data:

- `c`: mandatory. The **content** of your paste, text or binary. The maximum allowed size is set by the deployment (`R2_MAX_ALLOWED`). The `filename` in its `Content-Disposition` will be present when fetching the paste.

- `e`: optional. The **expiration** time of the paste. After this period of time, the paste is permanently deleted. It should be an integer or a float point number suffixed with an optional unit (seconds by default). Supported units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days). For example, `360.25` means 360.25 seconds, and `25d` means 25 days. The actual expiration might be shorter than specified expiration due to limitations imposed by the administrator. If unspecified, a default expiration time setting is used.

- `s`: optional. The **password** which allows you to modify and delete the paste. If not specified, the worker will generate a random string as password.

- `n`: optional. The customized **name** of your paste. If not specified, the worker will generate a random string (4 characters by default) as the name. You need to prefix the name with `~` when fetching the paste of customized name. The name is at least 3 characters long, consisting of alphabet, digits and characters in `+_-[]*$=@,;/`.

- `p`: optional. The flag of **private mode**. If specified to any value, the name of the paste is as long as 24 characters. No effect if `n` is used.

- `encryption-scheme`: optional. The encryption scheme used in the uploaded paste. It will be returned as `X-PB-Encryption-Scheme` header on fetching paste. Note that this is not the encryption scheme that the backend will perform.

- `lang`: optional. The language of the uploaded paste for syntax highlighting. Should be a lower-case name of language listed in [highlight.js documentation](https://github.com/highlightjs/highlight.js/blob/main/SUPPORTED_LANGUAGES.md). This will be returned as `X-PB-Highlight-Language` header on fetching paste.

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

- `url`: String. The URL to fetch the paste. When using a customized name, it looks like `https://shz.al/~myname`.
- `manageUrl`: String. The URL to update and delete the paste, which is `url` suffixed by `:` and the password.
- `expirationSeconds`: Number. The expiration seconds.
- `expireAt`: String. An ISO String representing when the paste will expire.

If error occurs, the worker returns status code different from `200`:

- `400`: your request is in bad format.
- `409`: the name is already used.
- `413`: the content is too large.
- `500`: unexpected exception. You may report this to the author to give it a fix.

## **PUT** `/<name>:<passwd>`

Update your paste of the name `<name>` and password `<passwd>`. It accepts the parameters in form-data:

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

## DELETE `/<name>:<passwd>`

Delete the paste of name `<name>` and password `<passwd>`. It may take seconds to synchronize the deletion globally.

If error occurs, the worker returns status code different from `200`:

- `403`: your password is not correct.
- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.
