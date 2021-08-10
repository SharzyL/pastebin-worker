# Pastebin based on Cloudflare Workers

This is a pastebin that can be deployed on Cloudflare workers. Try it on [shz.al](https://shz.al). 

**Philosophy**: effortless deployment, friendly CLI usage, rich functionality. 

**Features**:

1. Share your paste with as short as 4 characters
1. Customize the paste URL as you want
1. Make changes to uploaded paste
1. Delete your paste after uploading
1. Let your paste deleted from the server after a period of time
1. Syntax highlighting powered by Prism
1. Redirect to custom URL
1. Specify the mimetype when fetching your paste
1. Optional longer paste URL for better privacy

## Usage

You can post, update, delete your paste directly on the website (such as [shz.al](https://shz.al)). 

It also provide a convenient HTTP API to use. See [API reference](doc/api.md) for details. You can easily call API via command line (using `curl` or anything else). 

[pb](/scripts) is bash script to make it easier to use on command line. 

## Deploy

You are free to deploy the pastebin on your own domain, if you host your domain on Cloudflare. 

First, install [wrangler](https://github.com/cloudflare/wrangler) and login your Cloudflare account.

Requirements:
1. *nix environment with bash and basic cli programs. If you are using Windows, try cygwin, WSL or something. 
2. GNU make. 
3. `pandoc` to convert Markdown to HTML. 
4. `node` and `yarn`. 
5. `wrangler`, the official cli program to manage Cloudflare workers.

Create two KV namespaces in Cloudflare workers (one for production, one for test). Remember their IDs. If you do not need testing, simply create one.

Modify IDs in `wrangler.toml` according to your own account information (`account_id`, `zone_id`, `kv_namespaces.id`, `kv_namespaces.preview_id` are what you need to modify). Refer to [Cloudflare doc](https://developers.cloudflare.com/workers/cli-wrangler/configuration) on how to find out these parameters.

Deploy!

```shell
$ yarn install                 # install necessary packages
$ mkdir dist && make deploy    # store the static pages on Cloudflare KV storage
```
