# Pastebin Worker

This is a pastebin running on Cloudflare workers. Try it on [shz.al](https://shz.al).

**Philosophy**: effortless deployment, friendly CLI usage, rich functionality.

**Features**:

1. Share your paste with as short as 4 characters, or even customized URL.
1. **Syntax highlighting** powered by highlight.js.
1. Client-side encryption.
1. Share **markdown** file with rendered HTML.
1. URL shortener.
1. Smart and tweakable handling for `Content-Type` and `Content-Disposition`.
1. Direct P2P file transfer with verification, pause/resume, and crash-safe browser checkpoints when OPFS is available.

## Usage

1. You can post, update, delete your paste directly on the website (such as [shz.al](https://shz.al)).

2. It also provides a convenient HTTP API to use. See [API reference](doc/api.md) for details. You can easily call API via command line (using `curl` or similar tools). Note that a single request body is capped at 100 MB by Cloudflare (the platform returns HTTP `413` for larger bodies before the worker runs) — for larger files, use the website or the `pb` CLI below, which transparently chunk the upload.

3. [pb](/scripts) is a Python script (requires Python 3.9+ with the `requests` package) to make it easier to use on command line; it automatically switches to multipart upload above 5 MiB and shows a progress bar.

4. [doc/skill.md](doc/skill.md) is a concise, AI-agent-oriented packaging of the API. Make it available to your coding agent so it can upload, fetch, and manage pastes via this service.

## Deploy

You are free to deploy the pastebin on your own domain if you host your domain on Cloudflare.

1. Install `node` and `pnpm`.

2. Clone the repository and enter the directory.

3. Create a KV namespace and R2 bucket, fill the KV namespace ID and R2 bucket name in `wrangler.toml`.

```console
$ pnpm wrangler kv namespace create PB
$ pnpm wrangler r2 bucket create <name>
```

4. Modify entries in `wrangler.toml`. Its comments will tell you how.

5. Login to Cloudflare and deploy with the following steps:

```console
$ pnpm install
$ pnpm wrangler login
$ pnpm build:frontend
$ pnpm deploy
```

6. Enjoy!

## Cost

The service runs on Cloudflare Workers, Workers KV, R2, and Durable Objects. Each has a free tier; beyond it you pay only for what you use. Figures below are accurate as of writing — **prices change, so confirm against the official pricing pages before relying on them**:

- **[Workers](https://developers.cloudflare.com/workers/platform/pricing/)** — request routing and execution. Egress is free.
  - Free plan: 100 k requests/day, 10 ms CPU per invocation.
  - Paid plan ($5/mo base): 10 M requests/month + 30 M ms CPU/month included, then $0.30 per additional M requests and $0.02 per additional M CPU-ms. Also unlocks the higher KV limits below (KV has no separate paid plan).
- **[Workers KV](https://developers.cloudflare.com/kv/platform/pricing/)** — small pastes and per-paste metadata.
  - Free plan (daily, resets 00:00 UTC): 100 k reads, 1 k writes, 1 k deletes, 1 k list ops, 1 GB storage.
  - Paid plan (monthly + overage): 10 M reads ($0.50/M extra), 1 M writes ($5/M), 1 M deletes ($5/M), 1 M list ops ($5/M), 1 GB storage ($0.50/GB-month extra).
- **[R2](https://developers.cloudflare.com/r2/pricing/)** — paste content above `R2_THRESHOLD`. Egress is free. Class A op = upload (`PutObject`); Class B op = fetch (`GetObject`). Cloudflare rounds storage up to the next GB-month.
  - Free: 10 GB-month storage, 1 M Class A ops/month, 10 M Class B ops/month.
  - Standard paid: $0.015/GB-month storage, $4.50/M Class A ops, $0.36/M Class B ops.
- **[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)** — P2P room state and signaling, plus atomic read counters for pastes with a read limit. Ordinary pastes without a read limit do not use them.
  - Free (daily): 100 k requests, 13 k GB-s duration, 5 M rows read, 100 k rows written, and 5 GB stored data.
  - Paid (monthly): 1 M requests and 400 k GB-s included, then $0.15/M requests and $12.50/M GB-s. SQLite storage includes 25 B rows read, 50 M rows written, and 5 GB-month, then $0.001/M rows read, $1/M rows written, and $0.20/GB-month.
  - An incoming WebSocket connection counts as a request; incoming WebSocket messages are billed at a 20:1 ratio, while outgoing messages are not charged.
- **[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)** — optional, off unless enabled in `wrangler.toml`.
  - Free: 200 k events/day, 3-day retention.
  - Paid: 20 M events/month included + $0.60 per additional million, 7-day retention.

Costs scale primarily with: large file traffic (R2 ops + storage), high-volume reads (Workers requests + KV reads), P2P signaling or read-limited paste access (Durable Objects), and verbose logging (Workers Logs events). P2P file bytes travel directly between browsers, or through the configured TURN service, rather than through Durable Objects.

**Bottom line — what each tier comfortably handles**:

- **Free tier — a personal pastebin.** Binding limits are KV writes (**1 k uploads/day**), Workers requests and KV reads (**100 k each/day**), and Durable Object requests (**100 k/day**), with **1 GB** small-paste storage, **10 GB** large-paste storage on R2, and **5 GB** Durable Object storage. Plenty for individual or small-team use.
- **$5/month Paid — a small public or community service.** Roughly **~33 k uploads/day** and **~333 k ordinary fetches/day** stay within the included monthly KV and Workers allotments. P2P signaling and read-limited paste access additionally use the Durable Objects allowance of 1 M requests/month before overage. R2 storage and ops come out of R2's own free tier first, then a few cents per GB-month and per million ops — adding only a few dollars even at moderate traffic.

> [!NOTE]
> Small pastes go to KV (not R2) to keep garbage collection cheap. KV honors per-key expiration natively, so expired pastes vanish on their own. R2 has no built-in expiration, so cleaning up expired objects would require periodically listing and scanning every object in the bucket — costly in Class A/B ops as the bucket grows.

## P2P file transfer

P2P mode transfers files directly between browsers over WebRTC without storing them in KV or R2. Select **P2P
transfer**, share the generated six-character URL, and keep the sender page open until the transfer finishes. It
supports transfer verification, pause/resume, receiver limits, and receive checkpoints when OPFS is available.

P2P uses public STUN by default. For more reliable connections across restrictive NATs and firewalls, configure
Cloudflare Realtime TURN or a self-hosted coturn server.

### Cloudflare Realtime TURN

Set the TURN key ID under `[vars]`:

```toml
CF_TURN_ID = "your-turn-key-id"
```

Store the API secret as a Wrangler secret:

```console
$ pnpm wrangler secret put CF_TURN_API_SECRET
```

### Self-hosted coturn

Add the below config in coturn conf:

```ini
use-auth-secret
static-auth-secret=replace-with-a-long-random-secret
realm=turn.example.com
```

Store the same shared auth secret:

```console
$ pnpm wrangler secret put TURN_SHARED_SECRET
```

Set the coturn URLs under `[vars]`:

```toml
TURN_URLS = [
  "stun:turn.example.com:3478",
  "turn:turn.example.com:3478?transport=tcp",
  "turn:turn.example.com:3478?transport=udp",
]
```

At least one TURN URL must use `?transport=tcp` for health checks; UDP URLs may still be included for browsers.
Checks run only on cache misses, and credentials are cached after any TCP endpoint succeeds. The hostname must be
reachable through [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).
On failure, the room is created without `iceServers`.

## Auth

If you want a private deployment (only you can upload paste, but everyone can read the paste), add the following entry to your `wrangler.toml`.

```toml
BASIC_AUTH = {user1 = "$argon2id$v=19$m=8192,t=2,p=1$9z/txTGDTK0XI9Vefm87Eg$+M3UZWmmI8UlHzmeqxPKRt8rPhtN8P7JaSlC7wpBqHg" , user2 = "$argon2id$v=19$m=8192,t=2,p=1$UMRu+cwClTko2t8W5m5sJg$rKb6LN0npE4PTzQPB4dP7Y3HVvV4F36RpPVRpB8xm5Q"}
```

Passwords are hashed with Argon2id using a unique 16-byte random salt, 8192 KiB of memory, two iterations, and one
lane. Generate each password hash by running `pnpm password`. Existing bcrypt, scrypt, and PBKDF2 hashes are not
accepted.

Building the Worker and generating hashes require Rust with the `wasm32-unknown-unknown` target. Install that target
with `rustup target add wasm32-unknown-unknown`; `pnpm install` installs the pinned `wasm-pack` build tool.

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
