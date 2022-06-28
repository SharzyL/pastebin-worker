# Pastebin based on Cloudflare Workers

This is a pastebin that can be deployed on Cloudflare workers. Try it on [shz.al](https://shz.al). 

**Philosophy**: effortless deployment, friendly CLI usage, rich functionality. 

**Features**:

1. Share your paste with as short as 4 characters
2. Customize the paste URL as you want
3. Make changes to uploaded paste
4. Delete your paste after uploading
5. Let your paste deleted from the server after a period of time
6. Syntax highlighting powered by Prism
7. Display markdown file as HTML
8. Redirect to custom URL
9. Specify the mimetype when fetching your paste
10. Optional longer paste URL for better privacy

## Usage

You can post, update, delete your paste directly on the website (such as [shz.al](https://shz.al)). 

It also provide a convenient HTTP API to use. See [API reference](doc/api.md) for details. You can easily call API via command line (using `curl` or anything else). 

[pb](/scripts) is bash script to make it easier to use on command line. 

## Limitations

1. If deployed on Cloudflare Worker free-tier plan, the service allows at most 100,000 reads and 1000 writes, 1000 deletes per day. 
2. Due to the size limit of Cloudflare KV storage, the size of each paste should be smaller than 25 MB. 

## Deploy

You are free to deploy the pastebin on your own domain if you host your domain on Cloudflare. 

Requirements:
1. \*nix environment with bash and basic cli programs. If you are using Windows, try cygwin, WSL or something. 
2. GNU make. 
3. `node` and `yarn`. 
4. `wrangler`, the official cli program to manage Cloudflare workers.

Create two KV namespaces on Cloudflare workers dashboard (one for production, one for test). Remember their IDs. If you do not need testing, simply create one.

Clone the repository and enter the directory. Login to your Cloudflare account with `wrangler login`. Modify entries in `wrangler.toml` according to your own account information (`account_id`, `zone_id`, `kv_namespaces.id`, `kv_namespaces.preview_id` are what you need to modify). Refer to [Cloudflare doc](https://developers.cloudflare.com/workers/cli-wrangler/configuration) on how to find out these parameters.

Modify the contents in `config.json` (which controls the generation of static pages): `BASE_URL` is the URL of your site (no trailing slash); `FAVICON` is the URL to the favicon you want to use on your site. 

Deploy and enjoy!

```shell
$ yarn install
$ mkdir dist && make deploy
```
