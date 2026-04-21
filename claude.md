# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`droingring-mcp` is a peer-to-peer, end-to-end encrypted group chat system for AI agents and humans. It ships as:

- an **MCP server** (stdio + Streamable HTTP)
- a **web UI** (HTTP + WebSocket, bearer-token auth)
- an **Ink-based TUI**
- a unified **CLI** (`droingring` with `web`, `tui`, `mcp`, `ticket`, `url`, `doctor` subcommands)

Peers find each other via Hyperswarm (DHT), exchange signed+encrypted envelopes over Noise streams, and persist everything in sqlite at `~/.droingring/store.db` (override with `DROINGRING_HOME`).

The human-facing install guide + Codex/Claude Desktop registration steps live in `README.md`.

## Commands

```bash
pnpm build                                # tsup bundle → dist/bin/*.js
pnpm test                                 # vitest full suite (~5–15s)
pnpm test tests/foo.test.ts               # single file
pnpm test -t "approval"                   # tests matching a name
pnpm exec tsc --noEmit                    # typecheck only
pnpm exec biome check --write src tests   # lint + format (auto-fix)
```

Built binaries: `dist/bin/droingring-mcp.js` (stdio MCP entrypoint) and `dist/bin/droingring.js` (CLI).

## Architecture (outside-in)

1. **Transports** — stdio MCP via `@modelcontextprotocol/sdk`, Streamable HTTP MCP, HTTP+WebSocket for the web UI. All thin shells around:
2. **Tool / API handlers** (`src/mcp/tools.ts`, `src/web/api.ts`) — zod-validate, route to the manager, format responses. **Security-critical input validation lives here.**
3. **`RoomManager`** (`src/p2p/manager.ts`) — owns the set of Rooms, wires swarm events, persists state, handles startup rehydration + cross-process pickup.
4. **`Room`** (`src/p2p/room.ts`) — group crypto, key schedule, message dispatch, membership. Emits events the manager forwards.
5. **`Swarm`** (`src/p2p/swarm.ts`) — thin Hyperswarm wrapper. Noise-encrypted duplex streams carry length-prefixed CBOR frames (`src/p2p/frame.ts`).
6. **Storage** (`src/store/repo.ts` + `src/store/db.ts`) — `better-sqlite3` with WAL. **Migrations are additive only**, guarded by `PRAGMA table_info` checks (see the existing pattern in `db.ts`).

### Crypto model

- Identity: Ed25519 keypair at `~/.droingring/identity.json` (mode 0600). X25519 key is deterministically derived from the same seed via HKDF.
- Every envelope is Ed25519-signed over metadata + ciphertext; payload is sealed with XChaCha20-Poly1305.
- Per-room keys:
  - `metaKey` = epoch-0 key derivable from the ticket's `rootSecret`. Used for `hello`, `members`, `key_update`, `kick`, `close` — anyone with the ticket can decrypt these envelope types.
  - `msgKey` = current-epoch key. Used for `msg`, `note_*`, `graph_*`. Rotated on kick / approve via a creator-signed `key_update` that seals the new sender key to each remaining member's X25519 pubkey.
- `Room.candidateKeys()` tries msgKey first, then meta, then any remembered prior epochs — so in-flight messages across rotations still decode.
- **Creator-only envelope types: `members`, `kick`, `close`, `key_update`.** Non-creator signatures on these types are rejected on **receive**, not just guarded at the sender's local API. If you add a new admin-style envelope, add the same guard in `handleEnvelope`.

### Room types

1. **Ticket-based** (`createRoom` / `joinByTicket`) — one creator, random `rootSecret` at creation, invite by compact base32 ticket. Supports `open` and `approval` admission.
2. **Leaderless repo rooms** (`joinOrCreateLeaderlessRoom`) — `rootSecret` deterministic from the canonical GitHub URL:
   `BLAKE3("droingring v1 repo-room" || github.com/owner/repo)`. Creator pubkey is all-zeros, so no admin envelope ever validates. Auto-joined when `droingring` starts inside a git repo with a github.com origin (see `src/bin/repo-detect.ts`). Opt out with `DROINGRING_NO_REPO_ROOM=1`.
3. **DMs** (`openDM`) — deterministic room id from the sorted pair of pubkeys; creator is the alphabetically-lower pubkey so both sides agree.

### Sessions + cross-process coordination

Multiple droingring processes on the same machine share `~/.droingring` (identity + sqlite). Each runs its own Hyperswarm instance — to external peers they all appear as one Ed25519 pubkey.

Every local process registers a session row with `{pid, client, kind, cwd, repo_room_id, repo_name, started_at, last_seen}` — heartbeat every 30s, stale-GC after 90s. The web UI's "My sessions" panel groups by repo so the user sees which agent is running where.

State sync between sibling processes relies on:

- **sqlite WAL** (concurrent readers/writers are safe).
- **`manager.rehydrateNewRooms()`** — polled every 5s by the web server; picks up rooms a sibling process created after it started.

A singleton-daemon + stdio-to-HTTP proxy would deduplicate swarms; it's a deliberate deferred item (see CHANGELOG 0.6.1 / 0.6.3).

### Web UI surfaces worth knowing about

- Bearer token auth; no cookies → no CSRF.
- Host header + WebSocket Origin checks on `/api` and `/ws` (DNS-rebind / CSWSH defense).
- `UI_HTML` is a single-file string with inline JS. **All user/peer-supplied text goes through `textContent` — no `innerHTML`.** Keep it that way.
- Session panel + profile dialog (`GET /api/profile/:pubkey`) let the user answer "which of my agents are online where?".

## Testing — four tiers

| Tier | File(s) | What it tests | Cost |
|---|---|---|---|
| Unit | `tests/{crypto,frame,ticket,repo}.test.ts` | pure functions, sqlite invariants | ms |
| In-process multi-peer | `tests/e2e-multi-agent.test.ts`, `tests/repo-room.test.ts` | N `RoomManager`s wired through an in-memory `SwarmNet`. Full tool-handler path, no DHT. | ~3s |
| Stdio subprocess | `tests/e2e-stdio.test.ts` | Spawns the real built `droingring-mcp.js`, drives JSON-RPC over pipes. Catches transport regressions. | ~5s |
| Real Hyperswarm | `tests/e2e-swarm.test.ts` | Spins up a local `hyperdht` testnet and runs real Swarms that discover each other via DHT. | ~4s boot + tests |

### Notes for writing new tests

- Use `makeIdentity()` + `tmpDb()` from `tests/helpers.ts`.
- For in-process multi-peer tests, copy the `SwarmNet` + `TestSwarm` classes at the top of `tests/e2e-multi-agent.test.ts`.
- For subprocess tests sharing a sqlite, **start children serially** (initialize the first before spawning the second) to avoid sqlite migration races.
- Subprocess tests should set `DROINGRING_NO_REPO_ROOM=1` and/or `DROINGRING_SWARM_DISABLE=1` unless they specifically need the DHT.
- **macOS `/tmp` → `/private/tmp` symlink**: when asserting a subprocess's cwd from a tmp dir, compare against `realpathSync(tmpDir)`.

## Non-obvious invariants / gotchas

- **`INBOUND_LIMITS` in `src/p2p/room.ts`** are authoritative. zod caps on outbound tool args only protect our own callers — a peer who already has the ticket can speak CBOR directly, so per-field length/shape checks on inbound envelopes are the real bound.
- **LWW merges** (notes + graph) clamp incoming `updated_at` to `Date.now() + FUTURE_SKEW_MS` (5 min). Without this, one `+Infinity` stamp wins forever.
- **Graceful shutdown** (`src/bin/mcp-runner.ts:registerShutdown`) fires on SIGINT, SIGTERM, `beforeExit`, **and `stdin 'end'`** — stdio MCP sessions end when the client closes stdin, not via a signal.
- **`RoomManager.setNickname` / `setBio`** re-broadcast `hello` to every active room. Peers learn updated fields from `hello`, not from `msg` envelopes.
- The `members` table carries `client` and `bio` columns so peer identity (agent vs human, self-declared context) survives restarts. Old rows get empty strings via default-on-insert + migration.

## Commit + changelog discipline

`CHANGELOG.md` is structured per-minor-version; new features / bug batches get their own entry with a short "why" note and a pointer to deferred work. Commits are conventionally single-concept with explanatory bodies (see `git log` for tone). `.claude/scheduled_tasks.lock` is session-local — never stage it.
