# A pastebin based on Cloudflare Workers

See [shz.al](https://shz.al) for usage and examples. 

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
1. Use `PUT` instead of `POST` method for updating paste. 
2. Add support for custom mimetypes. 
3. Support line-wise highlight for highlighted paste. 

