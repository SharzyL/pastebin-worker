# Pastebin-worker

This is a pastebin that can be deployed on Cloudflare workers. Try it on [shz.al](https://shz.al). 

**Philosophy**: effortless deployment, friendly CLI usage, rich functionality. 

**Features**:

1. Share your paste with as short as 4 characters
2. Customize the paste URL
4. **Update** and **delete** your paste as you want
5. **Expire** your paste after a period of time
6. **Syntax highlighting** powered by PrismJS
7. Display **markdown** file as HTML
8. Used as a URL shortener
9. Customize returned mimetype

## Usage

1. You can post, update, delete your paste directly on the website (such as [shz.al](https://shz.al)). 

2. It also provides a convenient HTTP API to use. See [API reference](doc/api.md) for details. You can easily call API via command line (using `curl` or similar tools). 

3. [pb](/scripts) is a bash script to make it easier to use on command line.

## Limitations

1. If deployed on Cloudflare Worker free-tier plan, the service allows at most 5 million reads and 100000 writes per day.
2. Due to the size limit of Cloudflare D1 storage, the size of each basic paste is bounded under 1 MB.
3. Big files (more than 0.95 MB) are storaged in KV (metadata in D1), the size limit is 25 MB. 100000 reads per day. 1000 writes per day.
4. To save KV writes, we do not actively delete expired big files in KV, we just overwrite them in need.

## Deploy

You are free to deploy the pastebin on your own domain if you host your domain on Cloudflare. 

1. Install `node` and `yarn`.

2. Create a D1 Database on Cloudflare workers dashboard, run `schema.sql` in it, remember its ID. Please notice that executing `schema.sql` in the DB will reset all data in the DB.

3. Create a KV on Cloudflare workers dashboard, remember its ID.

4. Clone the repository and enter the directory. Login to your Cloudflare account with `wrangler login`.

5. Modify entries in `wrangler.toml`. Its comments will tell you how.

6. Deploy and enjoy!

```shell
$ yarn install
$ yarn deploy
```

## Auth

If you want a private deployment (only you can upload paste, but everyone can read the paste), add the following entry to your `wrangler.toml`.

```toml
[vars.BASIC_AUTH]
user1 = "passwd1"
user2 = "passwd2"
```

Now every access to POST request, and every access to static pages, requires an HTTP basic auth with the user-password pair listed above. For example:

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

## Administration
Delete a paste:
```console
$ yarn delete-paste <name-of-paste>
```

List pastes:
```console
$ yarn wrangler kv:key list --binding PB > kv_list.json
```

## Development

Run a local simulator:
```console
$ yarn dev
```

Run tests:
```console
$ yarn test
```

Run tests with coverage report:
```console
$ yarn coverage
```
