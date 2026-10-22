# Paste Cryptography

This document describes how pastes are encrypted on the client, and what that does and does not protect against. The implementation is in `frontend/utils/encryption.ts` and `frontend/utils/uploader.ts` for the web page, and `frontend/pages/DisplayPaste.tsx` for decryption. The server never encrypts or decrypts anything: it stores what it is given, together with a label saying which scheme was used. The cryptography of the live pastebin is described separately in [{{BASE_URL}}/doc/live-crypto]({{BASE_URL}}/doc/live-crypto).

## Goals

- **Confidentiality against the server.** The server, its storage, and anyone who can read its logs or backups, learns nothing about the content of an encrypted paste.
- **Integrity of the content.** Anyone with the link either sees exactly what was uploaded, or an error.
- **Sharing with a single link.** Whoever holds the link can read the paste, with no account, key exchange, or software beyond a browser.

Encryption is on by default on the web page. Uploads made directly with `curl` are not encrypted, since the server never encrypts.

## Limitations

- **The link is the key.** Anyone who gets the link, now or later, can read the paste for as long as the server keeps it. There is no forward secrecy: a paste is stored, so its key must stay usable for as long as the paste does. Expiration and deletion are the only ways to end access.
- **Only the content is encrypted.** The filename, highlight language, size, and timestamps are visible to the server, and so is the custom name, if one is chosen.
- **The page is served by the same server.** An operator who wants to read pastes can serve a page that sends keys elsewhere. Encryption delivered by a website protects against a server that is honest when the page is loaded, and against later leaks of its storage and logs; it cannot protect against a server that is malicious at that time.
- **Device compromise** of the uploader or of a reader exposes the paste, and readers can copy or save it.

## Notation

- $a \Vert b$ is concatenation, $\varepsilon$ is the empty string, and $v \leftarrow_R V$ picks $v$ uniformly at random from $V$.
- $\mathsf{Seal}_K(m) = \mathsf{iv} \Vert \mathsf{AES\text{-}GCM}_K(\mathsf{iv}, m, \varepsilon)$ with a fresh $\mathsf{iv} \leftarrow_R \{0,1\}^{96}$. The AES-GCM output is the ciphertext followed by a 128-bit tag. $\mathsf{Open}_K$ reverses $\mathsf{Seal}_K$ and fails if the tag does not match.
- $\mathsf{b64}$ is base64 with `/` replaced by `_` and padding removed.

## Uploading

Suppose someone uploads a paste with content $m$ (UTF-8 text from the editor, or the bytes of a file):

$$
\begin{aligned}
K &\leftarrow_R \{0,1\}^{256} \\
c &= \mathsf{Seal}_K(m)
\end{aligned}
$$

The client uploads $c$ in place of $m$ with the form field `encryption-scheme` set to $\textsf{“AES-GCM”}$, together with the usual metadata such as the filename and highlight language. Large pastes go through a multipart upload, which splits $c$ into parts; the server joins them back and never sees anything but $c$. The server stores $c$ and the scheme label, and answers with the paste URL, say `{{BASE_URL}}/abcd`, and a manage URL.

The client then builds the decryption link, `{{BASE_URL}}/d/abcd#` followed by $\mathsf{b64}(K)$. $K$ only exists in the browser and in this link, which the page shows as the display URL.

## Reading

Someone opens the decryption link. The browser does not send the fragment after `#` to the server, so the request is for `/d/abcd` only.

1. The server answers with the display page. It finds $c$ and the scheme label, and embeds $c$ in the page or lets the page fetch it from `/abcd`. On `/abcd`, the server marks an encrypted paste with the header `X-PB-Encryption-Scheme: AES-GCM`, serves it as `application/octet-stream` with `.encrypted` appended to the filename, and sends the type the plaintext would have in `X-PB-Decrypted-Content-Type`.
2. The page reads $\mathsf{b64}(K)$ from the fragment, decodes it, and computes $m = \mathsf{Open}_K(c)$.
3. If the tag does not match, because the key is wrong or $c$ was changed, the page shows an error instead of any content. Otherwise it shows $m$ like any other paste.

Without a fragment, the page reports that the paste is encrypted and offers the ciphertext for download.

## Updating and deleting

Updating a paste through its manage URL encrypts the new content under a **fresh** key $K'$, and the server replaces $c$ with $c'$. The old decryption link stops working: $\mathsf{Open}_K(c')$ fails, so its holders see an error rather than the new content. The new link has to be shared again.

When managing a paste on the web page, the encryption switch follows the paste being replaced, so updating a plain paste does not silently turn it into an encrypted one.

Deleting a paste, or letting it expire, removes $c$ from the server's storage. Without $c$, the key alone reveals nothing.

## Analysis

### Adversaries

| Adversary                 | Capabilities                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Honest-but-curious server | Reads everything it stores and logs: ciphertext, metadata, IP addresses, access times |
| Malicious server          | Also changes stored ciphertext and metadata, serves old versions, or refuses to serve |
| Late link holder          | Learns the link after the fact (chat history, browser history, screenshots)           |
| Network observer          | Sees TLS traffic between clients and the server                                       |
| Reader                    | Legitimately holds the link                                                           |

### Confidentiality against the server

The server only ever holds $c$. Reading $m$ without $K$ means breaking AES-256-GCM, whose key is chosen uniformly at random for each paste and never sent to the server. Since each key encrypts exactly one message, the IV is never repeated under a key, so the main way to misuse AES-GCM does not arise. Leaked storage or backups contain $c$ only.

A network observer sees TLS traffic only, and the fragment is not part of any request, so it is not in server logs, proxy logs, or `Referer` headers either.

### Integrity

AES-GCM authenticates the ciphertext, so a server that changes $c$ makes decryption fail rather than showing altered content. A server cannot replace the content with another paste's ciphertext either, since that was encrypted under another key. It can serve an **old** version, but only to holders of the old link, who were given that version; holders of the current link only accept $c'$.

The metadata is not authenticated. A malicious server can change the filename, highlight language, and the type in `X-PB-Decrypted-Content-Type`, which affect how the page presents $m$ (for example whether an image is previewed or a text is highlighted), but not the bytes of $m$, which can always be downloaded unchanged.

AES-GCM is not key-committing: a malicious uploader can craft one ciphertext that decrypts under two different keys to two different plaintexts. Two readers given different keys for the same paste can then see different content. This only matters if a paste name is treated as identifying one content, for instance when reporting abuse; an uploader can always give different readers different pastes anyway.

### The link

The link carries the key, so everything that can see the link can read the paste:

- **Late link holders.** There is no forward secrecy (see [limitations](#limitations)): a link that leaks before the paste expires or is deleted gives full access.
- **Where links end up.** Browser history and synced tabs, chat logs, link previews of messaging apps (which see the full URL even though they cannot send the fragment), and browser extensions with access to the page.
- **Readers** can forward the link to anyone; nothing ties it to the people it was first given to.

To limit exposure, set a short expiration, delete the paste once it has been read, or share the paste URL and the key over different channels, and let the reader put them together as `/d/<name>#<key>`.

### Metadata

The server learns, for every paste: its name, the exact size of the content (the size of $c$ minus 28 bytes), the filename and the type inferred from it, the highlight language, upload, update and expiration times, and access counts; Cloudflare, which runs the server, also sees the IP addresses of uploaders and readers. Choose a neutral filename, or none, when it would reveal too much.

### Quantum adversaries

No public-key cryptography is involved. AES-256 keeps a security level of about 128 bits against Grover's algorithm, so recorded ciphertext stays safe against a quantum adversary who does not get the link.

### Summary

| Scenario                                         | Plain paste      | Encrypted paste                |
| ------------------------------------------------ | ---------------- | ------------------------------ |
| Server, its storage or backups read the paste    | content readable | content safe, metadata visible |
| Server changes the stored content                | undetected       | detected, decryption fails     |
| Server changes filename, language or type        | undetected       | undetected                     |
| Link leaks before the paste expires              | readable         | readable                       |
| Link leaks after the paste expires or is deleted | gone             | gone                           |
| Ciphertext leaks without the link                | —                | content safe                   |
| Malicious page served by the operator            | not protected    | not protected                  |

## Primitives

All operations in the browser use WebCrypto: AES-256-GCM with a random 96-bit IV and a 128-bit tag. Keys are drawn from the cryptographically secure random generator of the browser (`crypto.subtle.generateKey`). For compatibility with older links, the page also accepts 128- and 192-bit keys.
