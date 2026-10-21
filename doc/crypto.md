# Live Pastebin Cryptography

This document describes how the live pastebin at [{{BASE_URL}}/live]({{BASE_URL}}/live) encrypts posts, and what that does and does not protect against. The implementation is in `frontend/utils/live.ts` and `frontend/utils/liveSession.ts`; the server side (`worker/live.ts`) is a relay that never sees a key.

## Goals

- **Confidentiality against the server.** The relay, and anyone who can read its traffic or logs, learns nothing about the content of posts.
- **Forward secrecy.** A post recorded while it was relayed cannot be decrypted later, even by someone who then learns the room link, once the pages that sent and received it are closed or have reconnected.
- **Posts reach the pages that are online.** A post is readable only by the pages that completed the key exchange before it was sent. Nothing is stored.

Nicknames are deliberately **not** authenticated: anyone in the room can post under any name, so no part of the design tries to bind a post to a person.

## Limitations

- **The page is served by the same server.** An operator who wants to read posts can serve a page that sends the room link and the plaintext elsewhere. End-to-end encryption delivered by a website protects against a server that is honest when the page is loaded, and against later leaks of its logs and recordings; it cannot protect against a server that is malicious at that time.
- **Device compromise** while the page is open exposes everything shown on it.
- Participants can copy, save or screenshot posts.
- **No post-quantum cryptography.** The key exchange is ECDH on P-256, which a large quantum computer could break, and WebCrypto in browsers offers no post-quantum key exchange such as ML-KEM yet. Since every pairwise key also depends on a pre-shared key derived from the room link, recorded posts stay safe against such an adversary as long as the link stays secret, but forward secrecy does not hold against an adversary who records traffic now, learns the link, and has a quantum computer later. The symmetric parts (AES-256, HMAC-SHA256, HKDF-SHA256) are not affected in a meaningful way.

## Notation

- $a \Vert b$ is concatenation, $a[i..j)$ is a byte range, $\varepsilon$ is the empty string, and $v \leftarrow_R V$ picks $v$ uniformly at random from $V$.
- $\mathsf{H}$ is SHA-256, $\mathsf{HMAC}_K$ is HMAC-SHA256, and $\mathsf{HKDF}(k, s, i)$ is HKDF-SHA256 with input key $k$, salt $s$ and info $i$, producing 32 bytes.
- $\mathsf{DH}(x, Y)$ is P-256 ECDH: the 32-byte x-coordinate of $xY$, where $G$ is the generator of the group of prime order $q$.
- $\mathsf{Seal}_K(m; a) = \mathsf{iv} \Vert \mathsf{AES\text{-}GCM}_K(\mathsf{iv}, m, a)$ with a fresh $\mathsf{iv} \leftarrow_R \{0,1\}^{96}$ and additional data $a$. $\mathsf{Open}_K$ reverses it and fails if the tag does not match.
- Fixed strings are written as $\textsf{“pb-live-…”}$; when identifiers follow a fixed string in the encoding, they are separated by `|`.

## Opening a room

### The room link

When someone opens `/live` with an empty fragment, the page picks a room secret $S \leftarrow_R \{0,1\}^{256}$ and rewrites the URL to `/live#<S>`, with $S$ in base64 (`/` replaced by `_`, no padding). Sharing that URL is how people are invited. The fragment is never sent to the server.

Every page with the link derives three values from $S$:

$$
\begin{aligned}
\mathsf{roomId} &= \mathsf{HKDF}(S, \varepsilon, \textsf{“pb-live-room-v1”})[0..16) \\
K_\text{room} &= \mathsf{HKDF}(S, \varepsilon, \textsf{“pb-live-key-v1”}) \\
\mathsf{psk} &= \mathsf{HKDF}(S, \varepsilon, \textsf{“pb-live-psk-v2”})
\end{aligned}
$$

- $\mathsf{roomId}$, hex encoded, is the only one that leaves the browser: the page connects to `/live/ws/<roomId>`, and the server puts all connections with the same id in one room.
- $K_\text{room}$ is an AES-256-GCM key that encrypts the outer layer of every frame, so the server cannot see who talks to whom.
- $\mathsf{psk}$ is mixed into every pairwise key below, so that knowing the public keys of a pair is not enough to compute its keys.

The three outputs are independent, so the server learns nothing about $K_\text{room}$ or $\mathsf{psk}$ from $\mathsf{roomId}$.

### Connecting

Every WebSocket connection, including every reconnect, begins a new session. For a page A:

$$
x_A \leftarrow_R \mathbb{Z}_q, \quad X_A = x_A G, \quad \mathsf{sid}_A = \mathsf{H}(X_A)[0..16), \quad n_A \leftarrow_R \{0,1\}^{128}, \quad \mathsf{seq}_A = 0
$$

- $x_A$ is a non-extractable WebCrypto key: scripts cannot read it, and it is gone once the session is dropped.
- $X_A$ is encoded as an uncompressed point (65 bytes), and $\mathsf{sid}_A$, the session id, is hex encoded. Since the id is a hash of the public key, nobody can claim the id of another key.
- $n_A$ is a challenge that other peers must answer to prove they are online.
- $\mathsf{seq}_A$ increases with every proof and alive frame A sends, so receivers can tell old frames from new ones.

### Frames

From now on, everything passes through the relay as binary frames of the same shape:

$$
\mathsf{frame} = \mathsf{len}(o) \Vert o \Vert b, \qquad o = \mathsf{Seal}_{K_\text{room}}(\mathsf{msg}; \varepsilon)
$$

where $\mathsf{len}$ is a 4-byte big-endian length, $\mathsf{msg}$ is a JSON control message (listed in the [message reference](#message-reference)), and the body $b$ is only present in posts. The server forwards each frame to every other connection in the room and sees nothing but its size.

## Joining

Suppose B and C are in the room and A connects.

1. A sends $\mathsf{hello}(X_A, n_A)$.
2. B receives it. If $\mathsf{sid}_A$ is new, B imports $X_A$ (WebCrypto rejects points that are not on the curve) and derives two pairwise keys:

   $$
   \begin{aligned}
   T_{AB} &= \min(X_A, X_B) \Vert \max(X_A, X_B) \\
   K^\text{wrap}_{AB} &= \mathsf{HKDF}(\mathsf{DH}(x_B, X_A), \mathsf{psk}, \textsf{“pb-live-pair-wrap-v2”} \Vert T_{AB}) \\
   K^\text{proof}_{AB} &= \mathsf{HKDF}(\mathsf{DH}(x_B, X_A), \mathsf{psk}, \textsf{“pb-live-pair-proof-v2”} \Vert T_{AB})
   \end{aligned}
   $$

   The minimum and maximum compare bytes, and $\mathsf{DH}(x_B, X_A) = \mathsf{DH}(x_A, X_B)$, so A will compute the same keys. $K^\text{wrap}_{AB}$ is an AES-256-GCM key for wrapping content keys, and $K^\text{proof}_{AB}$ an HMAC key for proofs. Including $T_{AB}$ binds the keys to this pair of public keys.

   B records A as **pending** and answers with $\mathsf{proof}(X_B, n_B, \mathsf{seq}_B, \mathsf{sid}_A, \pi_{B \to A})$, where a proof from P to Q is

   $$
   \pi_{P \to Q} = \mathsf{HMAC}_{K^\text{proof}_{PQ}}(\textsf{“pb-live-proof-v2”} \Vert \mathsf{sid}_P \Vert \mathsf{sid}_Q \Vert n_Q \Vert n_P)
   $$

   C does the same.

3. A receives B's proof. It learns $X_B$, derives the same pairwise keys, and checks $\pi_{B \to A}$. The proof covers $n_A$, which A has just picked, so only someone who holds $x_B$ (and $\mathsf{psk}$) right now could have computed it. A marks B as **confirmed**, and since it has not sent B a proof yet, it answers with $\mathsf{proof}(X_A, n_A, \mathsf{seq}_A, \mathsf{sid}_B, \pi_{A \to B})$.
4. B checks $\pi_{A \to B}$, which covers $n_B$, and marks A as confirmed.

A and C go through the same steps. The rule on both sides is the same: **a peer is confirmed when it sends a valid proof over my challenge.** Each side sends one proof to each peer, so two pages joining at the same time also end up confirming each other. Proofs addressed to another session, and proofs whose sequence number is not above the last one seen from that peer, are ignored.

The page shows "N online", where N is 1 plus the number of confirmed peers, rather than the connection count reported by the server.

## Posting

Now A posts. With $p$ the post plaintext and $\mathcal{P}$ the peers A has confirmed at that moment:

$$
\begin{aligned}
\mathsf{CK} &\leftarrow_R \{0,1\}^{256} \\
b &= \mathsf{Seal}_{\mathsf{CK}}(p;\ \textsf{“pb-live-body-v2”}) \\
w_P &= \mathsf{Seal}_{K^\text{wrap}_{AP}}(\mathsf{CK};\ \textsf{“pb-live-wrap-v2”} \Vert \mathsf{sid}_A \Vert \mathsf{sid}_P) \quad \text{for each } P \in \mathcal{P}
\end{aligned}
$$

A sends $\mathsf{post}(\mathsf{sid}_A, \{(\mathsf{sid}_P, w_P)\}_{P \in \mathcal{P}})$ with body $b$. The body is encrypted once, whatever the number of recipients, and $\mathsf{CK}$ is used for this post only. The wrapping is done with WebCrypto `wrapKey`, so $\mathsf{CK}$ never needs to be read by scripts. If $\mathcal{P}$ is empty, nobody could read the post, so it is only shown locally and nothing is sent.

B opens the outer layer, finds $w_B$, computes $\mathsf{CK} = \mathsf{Open}_{K^\text{wrap}_{AB}}(w_B)$ as a non-extractable key, and then $p = \mathsf{Open}_{\mathsf{CK}}(b)$. A post with no wrap for B, because it was sent before A confirmed B, is dropped silently. Receiving needs only the pairwise key, which B has had since it handled A's hello or proof. The relay keeps the order of frames from one connection, so a peer's proof always arrives before its posts.

Each wrap adds about 130 bytes to the outer layer, so a post to 63 peers stays well inside the 64 KiB allowance that frames have on top of the 10 MiB body limit.

## Staying and leaving

- Every 30 seconds each page sends $\mathsf{alive}(\mathsf{sid}, \mathsf{seq})$. An alive refreshes a confirmed peer only if its sequence number is above every one seen from that peer, so a replayed alive cannot keep a departed peer listed.
- Peers not refreshed for 75 seconds, confirmed or not, are forgotten.
- On `pagehide` and when leaving the room, the page sends $\mathsf{bye}(\mathsf{sid})$ and closes the connection, which drops the session and its keys. A page restored from the back/forward cache reconnects with a new session.

## Message reference

Every control message is a JSON object with `v: 2` and a type `t`. Binary fields are encoded in the base64 variant above.

| `t`     | Fields                                                  | Purpose                                    |
| ------- | ------------------------------------------------------- | ------------------------------------------ |
| `hello` | `pub` ($X$), `nonce` ($n$)                              | announce a new session                     |
| `proof` | `pub`, `nonce`, `seq`, `to` (session id), `tag` ($\pi$) | prove possession of the private key        |
| `alive` | `from` (session id), `seq`                              | stay in the other peers' lists             |
| `bye`   | `from`                                                  | leave the room                             |
| `post`  | `from`, `wraps`: a list of `{to, key}` ($w_P$)          | the content key wrapped for each recipient |

The post plaintext $p$ is a 4-byte big-endian header length, a JSON header (`id`, `ts`, `author`, `kind`, and optional `filename`, `lang`, `mime`), then the body (UTF-8 text or raw file content).

## Analysis

### Adversaries

| Adversary         | Capabilities                                                                         |
| ----------------- | ------------------------------------------------------------------------------------ |
| Passive server    | Records every frame and connection metadata (IP addresses, timing, sizes)            |
| Active server     | Also drops, delays, replays, injects frames, separates peers, lies about peer counts |
| Late link holder  | Learns $S$ after the fact (chat history, browser history, screenshots)               |
| Room member       | Legitimately holds $S$ and takes part in the room                                    |
| Device compromise | Reads the memory or page of a participant                                            |

### Confidentiality against the server

Without $S$, the server cannot open the outer layer under $K_\text{room}$, and it cannot compute pairwise keys because they depend on $\mathsf{psk}$. An injected hello or proof fails to decrypt. Even if it could insert its own public key $X_E$, the derived key $\mathsf{HKDF}(\mathsf{DH}(x_E, X_A), \mathsf{psk}, \dots)$ would still be unknown to it. Content is protected under the security of AES-GCM and HKDF.

### Forward secrecy

Consider an adversary who recorded every frame and later learns $S$. It can open every outer layer, and so learns every public key, every session id, and every list of wrap recipients. To read a post from A to B, it needs $\mathsf{CK}$, so $K^\text{wrap}_{AB}$, so $\mathsf{DH}(x_A, X_B)$ given only $X_A$ and $X_B$. That is the computational Diffie-Hellman problem in P-256, and $x_A$ and $x_B$ are gone once the pages closed or reconnected. With HKDF modelled as a random oracle, the post stays confidential under the gap Diffie-Hellman assumption.

The forward secrecy window is one connection: while a page is open and connected, its private key and pairwise keys are in memory, and a compromise at that point exposes the posts of that connection. Those posts are on that page anyway. Reconnecting starts a new window.

"Gone" means the browser no longer references the keys. A non-extractable key cannot be read by scripts, but copies may survive in process memory until it is reused, in swap, in hibernation images or in crash dumps. This is the same limit that every browser based messenger has.

### A link that leaks during a session

- **Passive eavesdropper with $S$**, such as someone who sees the link in a chat but cannot change traffic: it reads hellos, but cannot compute any pairwise key, so it reads no post. To read posts it must join the room, and then it appears in everyone's peer count.
- **Active server with $S$**: it can replace public keys in hellos and proofs with its own and relay between both sides, a man-in-the-middle that the pages cannot detect without comparing key fingerprints out of band. We do not offer fingerprint comparison, because an operator willing to do this can more easily serve a modified page (see [limitations](#limitations)).

### Room members

A member can read every post sent while it is confirmed; that is the point of the room. Compared with a single shared key, it can no longer read posts sent while it was away, even with frames recorded by the server, because those posts have no wrap for it. As decided above, a member can post under any nickname, including the nickname of someone else.

Pairwise keys are symmetric, so B can create a wrap that seems to come from A. Posts are therefore deniable: no recipient can prove to a third party who sent a post.

### Replay, injection, and availability

- A **replayed hello** of a departed peer is answered, but nobody can produce a proof over the fresh challenge, so it stays pending, is never sent posts, and expires after 75 seconds.
- **Replayed proofs and alives** carry old sequence numbers and are ignored.
- A **replayed post** within the same connection is dropped by its message id. After a reconnect, its wraps are for an old session id and cannot be opened.
- A **replayed bye** can only remove a peer that has already left.
- The server can always drop frames, separate peers, or close connections. These attacks only affect availability. The count of confirmed peers cannot be inflated by the server, since confirmation requires the pairwise key.
- Frames that fail to decrypt are cheap to reject (one AES-GCM operation). A room member could flood hellos to make others run ECDH, which costs well under a millisecond each; the server rate limits frames by size, and a page keeps at most 64 peers.

### Metadata

The server sees who connects, when, how often, and the size of every frame. The number of recipients of a post can be estimated from its size. Someone who learns $S$ later can also see the session ids, the recipient lists, and the times of every recorded frame, but not the content, nicknames, filenames or languages, which are in the post plaintext.

### Summary

| Scenario                                          | Single room key (v1) | Per-connection keys (v2)       |
| ------------------------------------------------- | -------------------- | ------------------------------ |
| Link leaks later, frames were recorded            | all posts readable   | content safe, metadata visible |
| Link leaks during a session, passive eavesdropper | all posts readable   | content safe                   |
| Link leaks during a session, active server        | all posts readable   | man-in-the-middle possible     |
| Member reads posts sent while away                | yes, with recordings | no                             |
| Replayed post to a new page                       | readable             | cannot be opened               |
| Peer count                                        | reported by server   | confirmed with keys            |
| Malicious page served by the operator             | not protected        | not protected                  |

## Primitives

All operations use WebCrypto: ECDH on P-256 (available in all browsers, with on-curve checks on import), HKDF-SHA256, HMAC-SHA256, AES-256-GCM with random 96-bit IVs, and `wrapKey`/`unwrapKey` for content keys. Every key is used with one algorithm and for one purpose. No key is used anywhere near the AES-GCM limit of $2^{32}$ random IVs.
