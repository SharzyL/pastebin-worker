# Pastebin based on Cloudflare Workers

This is a pastebin that can be deployed on Cloudflare workers. Try it on [shz.al](https://shz.al). 

**Philosophy**: effortless deployment, friendly CLI usage, rich functionality. 

**Features**:

1. Share your paste with as short as 4 characters
2. Customize the paste URL
4. **Update** and **delete** your paste as you want
5. **Expire** your paste after a period of time
6. **Syntax highlighting** powered by PrismJS
7. Display **markdown** file as HTML
8. Customizable 302 redirection
9. Specify mimetype

## Usage

1. You can post, update, delete your paste directly on the website (such as [shz.al](https://shz.al)). 

2. It also provides a convenient HTTP API to use. See [API reference](doc/api.md) for details. You can easily call API via command line (using `curl` or anything else). 

3. [pb](/scripts) is bash script to make it easier to use on command line. 

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

Clone the repository and enter the directory. Login to your Cloudflare account with `wrangler login`. Modify entries in `wrangler.toml` according to your own account information (`account_id`, routes, kv namespace ids are what you need to modify). Refer to [Cloudflare doc](https://developers.cloudflare.com/workers/cli-wrangler/configuration) on how to find out these parameters.

Modify the contents in `config.json` (which controls the generation of static pages): `BASE_URL` is the URL of your site (no trailing slash); `FAVICON` is the URL to the favicon you want to use on your site. If you need testing, also modify `config.preview.json`.

Deploy and enjoy!

```shell
$ yarn install
$ mkdir dist && make deploy
```

## Auth

If you want a private deployment (only you can upload paste, but everyone can read the paste), add the following entry to your `config.json` (other configurations contained in the outmost brace):

```json
{
  "basicAuth": {
    "enabled": true,
    "passwd": {
      "admin1": "this-is-passwd-1",
      "admin2": "this-is-passwd-2"
    }
  }
}
```

Now every access to PUT or POST request, and every access to the index page, requires an HTTP basic auth with the user-password pair listed above. For example: 

```shell
$ curl example-pb.com
HTTP basic auth is required

$ curl -Fc=@/path/to/file example-pb.com
HTTP basic auth is required

$ curl -u admin1:wrong-passwd -Fc=@/path/to/file example-pb.com
Error 401: incorrect passwd for basic auth

$ curl -u admin1:this-is-passwd-1 -Fc=@/path/to/file example-pb.com
{
  "url": "https://example-pb.com/YCDX",
  "suggestUrl": null,
  "admin": "https://example-pb.com/YCDX:Sij23HwbMjeZwKznY3K5trG8",
  "isPrivate": false
}
```
