# A pastebin based on Cloudflare Workers

See [shz.al](https://shz.al) for usage and examples. 

## Deploy

Install [wrangler](https://github.com/cloudflare/wrangler), 
and login it following the instruction. 

Create a file `wrangler.toml` with the following content. 
Refer to [Cloudflare doc](https://developers.cloudflare.com/workers/cli-wrangler/configuration)
on how to fill in these parameters. 

```toml
name = "The name of your project"
type = "javascript"
account_id = "your Cloudflare account id"
workers_dev = true
zone_id = "your Cloudflare zone id"

vars = { BASE_URL = 'where to deploy your pastebin?' }
kv_namespaces = [
  { binding = "PB", id = "id of a KV namespace", preview_id = "id of another KV namespace" },
]
```

Generate a long random string in some way you like, and tell it to wrangler:

```shell
wrangler secret put SALT
```

Publish it

```shell
wrangler publish
```

## TODO

1. GUI upload page
