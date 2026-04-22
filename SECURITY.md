# Security model — droidring-mcp

This document is honest about what `droidring-mcp` does and does not protect against. Read it before using it for anything sensitive.

## What is protected

- **Message confidentiality between current room members.** Every message is XChaCha20-Poly1305-encrypted with the room's current symmetric key, framed inside a Noise-encrypted duplex stream (Hyperswarm). A network observer sees only ciphertext.
- **Authenticity.** Every envelope is Ed25519-signed by its sender. Forging a message requires compromising the sender's identity key.
- **Invite-only membership.** Rooms are gated by a 32-byte shared secret carried in the ticket. A peer that does not know the secret cannot derive the room's topic id, cannot decrypt messages, and cannot forge signed envelopes that existing members will accept.
- **Forward secrecy across epoch rotations.** Kicking a member triggers a new epoch key, sealed individually to each remaining member's X25519 key. The kicked peer cannot decrypt messages after the rotation.

## What is *not* protected

- **Compromise of a current member leaks the current epoch.** If an attacker obtains a current member's identity key or current room key, they can decrypt all messages in the current epoch and any epoch they still hold keys for.
- **Forward secrecy only across rotations.** Unlike MLS (Messaging Layer Security), we do not rotate keys on every message. Messages sent in the same epoch share a key. A key schedule closer to MLS is a known future upgrade.
- **IP address leakage.** This is a peer-to-peer system. Anyone you connect to sees your IP address. This is inherent to Hyperswarm / any direct P2P protocol. If you need anonymity, run it over a transport that provides it (e.g. inside a VPN, a Tor-routed socket, or a Yggdrasil tunnel — none of which this project sets up for you).
- **Metadata leakage to the DHT.** The mainline DHT learns that some peer is announcing the 32-byte topic id. The topic id is `BLAKE3(name || secret)`, so it does not reveal the name. But someone who knows the name *and* the secret can verify your presence.
- **No anonymity.** Your Ed25519 public key is your stable handle and is visible to every room you ever join.
- **No spam protection beyond per-sender muting.** Anyone with a ticket can send messages.
- **No traffic analysis protection.** Message sizes, timings, and connection patterns are all observable on-wire to a sufficiently motivated observer (even though payloads are encrypted).
- **No out-of-band identity verification.** The first time you see a pubkey with a given nickname, you have no way to know it's who you think it is. Do your own OOB key verification (TOFU + side-channel fingerprint check) if it matters.

## Key storage

Identity keys live in `~/.droidring/identity.json` with mode `0600`. The SQLite database at `~/.droidring/store.db` contains decrypted message history and current room keys. Protect both with filesystem permissions.

## Upgrading the key schedule

The current key rotation is "sender keys sealed to each remaining member" — a pragmatic approximation of MLS. A real MLS tree-based key schedule with per-message ratcheting is a roadmap item. PRs welcome.

## Web UI threat model

The `droidring web` subcommand exposes an HTTP + WebSocket server. The
default posture is single-user, local-only:

- **Bearer-token authentication.** A 32-byte random token is generated on
  first run and stored at `~/.droidring/web-token` with mode 0600. All
  `/api/*` and `/ws` requests require `Authorization: Bearer <token>`. The
  WebSocket upgrade accepts the same token via a `?token=` query param
  because browsers can't set headers on WS handshakes.
- **No cookies, no CSRF.** Because we authenticate with a custom header
  and not a cookie, a cross-origin website loaded in the same browser
  cannot forge requests — it has no way to read the token from
  `sessionStorage` of another origin.
- **Localhost bind by default.** `--host 0.0.0.0` is required to expose
  the UI to the LAN. If you do expose it, use a reverse proxy that
  terminates TLS — the built-in server speaks plain HTTP.
- **Constant-time token compare.** Prevents timing-oracle token recovery.
- **CSP.** The HTML response carries a strict `Content-Security-Policy`:
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'
  'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors
  'none'`. `'unsafe-inline'` is required for the embedded script + styles;
  the script is shipped by the server itself, so the risk is inward-facing.
- **XSS-safe rendering.** The UI never assigns to `innerHTML`. All
  user-supplied text (messages, nicknames, topics, note bodies) is written
  via `textContent`. Links are not auto-hyperlinked to avoid URL
  smuggling.
- **JSON body cap.** 256 KB per request. Oversized bodies are rejected.
- **Per-endpoint validation.** The REST handlers enforce the same caps as
  the MCP tool layer and the inbound envelope validators.

**What is not protected:**

- If you run `droidring web --host 0.0.0.0` without a TLS proxy, the token
  travels in the clear on your network. Treat it like an SSH key — use a
  tunnel or HTTPS proxy if exposing beyond localhost.
- The web UI trusts the daemon it's attached to. It is not a zero-trust
  client — it renders whatever the daemon sends it. Since both are owned
  by the same user this is fine, but don't point the UI at a daemon you
  don't control.
- Browser extensions with access to localhost can read the token from
  sessionStorage. Standard browser sandboxing applies.

## Reporting vulnerabilities

Open a GitHub security advisory. Do not file public issues for security bugs.
