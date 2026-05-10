# Pastebin-worker

This is a pastebin running on Cloudflare workers. Try it on [shz.al](https://shz.al).

**Philosophy**: effortless deployment, friendly CLI usage, rich functionality.

**Features**:

1. Share your paste with as short as 4 characters, or even customized URL.
1. **Syntax highlighting** powered by highlight.js.
1. Client-side encryption.
1. Render **markdown** file as HTML.
1. URL shortener.
1. Smart and tweakable handling for `Content-Type` and `Content-Disposition`.

## Usage

1. You can post, update, delete your paste directly on the website (such as [shz.al](https://shz.al)).

2. It also provides a convenient HTTP API to use. See [API reference](doc/api.md) for details. You can easily call API via command line (using `curl` or similar tools).

3. [pb](/scripts) is a bash script to make it easier to use on command line.

4. [doc/skill.md](doc/skill.md) is a concise, AI-agent-oriented packaging of the API. Make it available to your coding agent so it can upload, fetch, and manage pastes via this service.

## Cost

The service runs on Cloudflare Workers, Workers KV, and R2. Each has a free tier; beyond it you pay only for what you use. Figures below are accurate as of writing — **prices change, so confirm against the official pricing pages before relying on them**:

- **[Workers](https://developers.cloudflare.com/workers/platform/pricing/)** — Free plan: 100,000 requests/day, 10 ms CPU per invocation. Paid plan: $5/mo base, includes 10 M requests/month + 30 M ms CPU/month, then $0.30 per additional million requests and $0.02 per additional million CPU-ms. Egress is free. The $5/mo Paid plan also unlocks the higher KV limits below (KV does not have a separate paid plan).
- **[Workers KV](https://developers.cloudflare.com/kv/platform/pricing/)** (small pastes and per-paste metadata) — Free plan (daily, resets 00:00 UTC): 100 k reads, 1 k writes, 1 k deletes, 1 k list ops, 1 GB storage. Paid plan (monthly + overage): 10 M reads ($0.50/M extra), 1 M writes ($5/M), 1 M deletes ($5/M), 1 M list ops ($5/M), 1 GB storage ($0.50/GB-month extra).
- **[R2](https://developers.cloudflare.com/r2/pricing/)** (paste content above `R2_THRESHOLD`) — Free: 10 GB-month storage, 1 M Class A ops/month, 10 M Class B ops/month, **egress free**. Standard paid: $0.015/GB-month storage, $4.50 per million Class A ops (writes/lists), $0.36 per million Class B ops (reads). Class A op = upload (`PutObject`); Class B op = fetch (`GetObject`). Cloudflare rounds storage up to the next GB-month.
- **[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)** (optional, off unless enabled in `wrangler.toml`) — Free: 200 k events/day, 3-day retention. Paid: 20 M events/month included + $0.60 per additional million, 7-day retention.

For a personal deployment the free tier is typically sufficient. Costs scale primarily with: large file traffic (R2 ops + storage), high-volume reads (Workers requests + KV reads), and verbose logging (Workers Logs events).

**Bottom line — what each tier comfortably handles**:

- **Free tier**: a personal pastebin. The binding limits are KV writes (**1,000 uploads/day**) and KV/Workers reads (**~100,000 fetches/day**), with **1 GB** of small-paste storage and **10 GB** of large-paste storage on R2. Plenty for individual or small-team use.
- **$5/month Paid**: a small public or community service. Roughly **~33,000 uploads/day** and **~333,000 fetches/day** stay within the included monthly KV allotment; Workers requests included to ~10 M/month (~333 k/day). R2 storage and ops come out of R2's separate free tier first, then a few cents per GB-month and per million ops — adding only a few dollars even at moderate traffic.

## Deploy

You are free to deploy the pastebin on your own domain if you host your domain on Cloudflare.

1. Install `node` and `pnpm`.

2. Create a KV namespace and R2 bucket on Cloudflare workers dashboard, remember its ID.

3. Clone the repository and enter the directory.

4. Modify entries in `wrangler.toml`. Its comments will tell you how.

5. Login to Cloudflare and deploy with the following steps:

```console
$ pnpm install
$ pnpm wrangler login
$ pnpm build:frontend
$ pnpm deploy
```

6. Enjoy!

## Auth

If you want a private deployment (only you can upload paste, but everyone can read the paste), add the following entry to your `wrangler.toml`.

```toml
[vars.BASIC_AUTH]
user1 = "$2b$08$i/yH1TSIGWUNQVsxPrcVUeR0hsGioFNf3.OeHdYzxwjzLH/hzoY.i"
user2 = "$2b$08$KeVnmXoMuRjNHKQjDHppEeXAf5lTLv9HMJCTlKW5uvRcEG5LOdBpO"
```

Passwords here are hashed by bcrypt2 algorithm. You can generate the hashed password by running `./scripts/bcrypt.js`.

Now every access to POST request, and every access to static pages, requires an HTTP basic auth with the user-password pair listed above. For example:

```console
$ curl example-pb.com
HTTP basic auth is required

$ curl -Fc=@/path/to/file example-pb.com
HTTP basic auth is required

$ curl -u admin1:wrong-passwd -Fc=@/path/to/file example-pb.com
Error 401: incorrect passwd for basic auth

$ curl -u admin1:this-is-passwd-1 -Fc=@/path/to/file example-pb.com
{
  "url": "https://example-pb.com/YCDX",
  "admin": "https://example-pb.com/YCDX:Sij23HwbMjeZwKznY3K5trG8",
  "isPrivate": false
}
```

## Administration

Delete a paste:

```console
$ pnpm delete-paste <name-of-paste>
```

List pastes:

```console
$ pnpm -s wrangler kv key list --binding PB > kv_list.json
```

## Development

Note that the frontend and worker code are built separatedly. To start a Vite development server of the frontend,

```console
$ pnpm dev:frontend
```

To develop the backend worker, we must build a develop version of frontend,

```console
$ pnpm build:frontend:dev
```

Then starts a local worker,

```console
$ pnpm dev
```

The difference between `build:frontend:dev` and `build:frontend` is that the former will points the API endpoint to your deployment URL, while the later points to `http://localhost:8787`, the address of a local worker.

Run tests:

```console
$ pnpm test
```

Run tests with coverage report:

```console
$ pnpm coverage
```

Remember to run eslint checks and prettier before commiting your code.

```console
$ pnpm fmt
$ pnpm lint
$ pnpm typecheck
```
