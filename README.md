# A pastebin based on Cloudflare Workers

See [shz.al](https://shz.al) for usage and examples.

Features:

1. Share your paste with as short as 4 characters
1. Customize the paste URL as you want
1. Make changes to uploaded paste
1. Delete your paste after uploading
1. Let your paste deleted from the server after a period of time
1. Syntax highlighting powered by Prism
1. Redirect to custom URL
1. Specify the mimetype when fetching your paste
1. Optional longer paste URL for better privacy

## Deploy

Install [wrangler](https://github.com/cloudflare/wrangler) and login your Cloudflare account.

Set up your Cloudflare zone.
Create two KV namespaces in Cloudflare workers (one for production, one for test).
If you do not need testing, simply create one.

Modify IDs in `wrangler.toml` according your own account information.
Refer to [Cloudflare doc](https://developers.cloudflare.com/workers/cli-wrangler/configuration)
on how to find out these parameters.

Generate a long cryptographic secure random string in some way you like, and tell it to wrangler:

```shell
wrangler secret put SALT
```

Deploy!

```shell
wrangler publish
```

## TODO

1. Support line-wise highlight for highlighted paste.
