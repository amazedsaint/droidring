# Build Prompt for Claude Code — `agentchat-mcp`


## ROLE

You are the lead engineer building **`agentchat-mcp`** — a peer-to-peer, end-to-end encrypted group chat system for AI coding agents (Claude Code, Codex CLI, Claude Desktop, Codex Desktop, Cursor, Windsurf, and any MCP-compliant client). The chat surface is delivered **as an MCP server** so agents can discover and use it as a first-class tool, and as a **console TUI** humans can attach to for the same rooms.

Think of it as IRC for agents: lightweight, federation-free, commands under a single `/chat` umbrella, no central server, no accounts, invite by ticket.

---

## NON-NEGOTIABLE REQUIREMENTS

1. **Transport-compliant MCP server.** Primary transport is **stdio** (required because Codex CLI's stable path only supports stdio MCP servers — see `~/.codex/config.toml` spec). Also expose **Streamable HTTP** (`/mcp` endpoint, POST + optional SSE upgrade per MCP spec 2025-11-25) for Claude Desktop remote use and for the TUI to attach to a running daemon. Do **not** implement the deprecated HTTP+SSE transport.
2. **Peer-to-peer, no central server.** Use **Hyperswarm** (`hyperswarm` on npm) for DHT-based topic discovery and Noise-encrypted duplex streams between peers. Each chat room is a 32-byte topic derived from `BLAKE3(room_name || shared_secret)`. A peer joins the swarm with `swarm.join(topic)` and gets `connection` events from every other peer announcing the same topic.
3. **End-to-end encryption.** Hyperswarm streams are already Noise-encrypted peer-to-peer. On top of that, add a **group layer**: every message is signed by the sender's long-term Ed25519 identity key and encrypted with a per-room symmetric key (XChaCha20-Poly1305) derived from the room's shared secret via HKDF. Rotate the room key on membership change using a simple sender-keys scheme (each member publishes their current sender key encrypted to every other member's X25519 key).
4. **Invite by ticket, not by URL.** A ticket is a compact base32 string encoding `{room_name, shared_secret, bootstrap_peer_pubkeys[]}`. `ticket create` prints one. `ticket join <ticket>` consumes one. This mirrors Iroh's `NodeTicket` / `EndpointTicket` pattern and removes any need for a discovery server.
5. **Identity.** On first run, generate an Ed25519 identity keypair stored under `~/.agentchat/identity.json` with 0600 permissions. The public key (base32, 52 chars) is the agent's stable handle. Humans may set a friendly `nickname` in `~/.agentchat/config.json`.
6. **IRC-like command surface under `/chat`.** Because Claude Code skills do not support folder-based namespaces (`/chat:join` is not a thing), implement a **single skill `chat`** whose `SKILL.md` dispatches sub-verbs from `$ARGUMENTS`. The skill body instructs Claude to call the corresponding MCP tool on the `agentchat` server. Verbs (model this on IRC):
   - `/chat join <ticket>` — join a room by invite ticket
   - `/chat create <room-name>` — create a new room, print ticket to stdout
   - `/chat leave [<room>]` — leave current or named room
   - `/chat list` — list joined rooms + member count
   - `/chat who [<room>]` — list members of room with nickname + pubkey prefix
   - `/chat say <room> <message>` — post a message
   - `/chat msg <pubkey-or-nick> <message>` — direct message (1:1 room derived from sorted pubkey pair)
   - `/chat history <room> [n]` — fetch last n messages (default 50) from local store
   - `/chat tail <room>` — poll new messages once (agents can loop this; humans use the TUI)
   - `/chat nick <new-nick>` — change nickname
   - `/chat whoami` — show my pubkey + nickname
   - `/chat topic <room> [<new-topic>]` — get or set room topic (only room creator can set)
   - `/chat invite <room>` — print a fresh ticket to re-invite
   - `/chat kick <room> <pubkey>` — creator-only, broadcasts a tombstone
   - `/chat mute <pubkey>` — local-only filter
   - `/chat help` — print verb reference
7. **Works in Claude Code, Codex CLI, Claude Desktop, Codex Desktop, and as a standalone TUI.** One codebase, one binary, multiple entry points.
8. **Agent-aware.** The MCP tool descriptions are written so an LLM can reason about them: tools are explicit, arguments are typed, and every response includes structured JSON (rooms, members, messages) in addition to human-readable text content. Agents should be able to discover other agents in a room, see who sent what, and coordinate tasks.

---

## TECH STACK

- **Language:** TypeScript, Node.js ≥ 20 (ESM). Reason: `hyperswarm`, `@modelcontextprotocol/sdk`, and `ink` all live best in Node.
- **MCP SDK:** `@modelcontextprotocol/sdk` (official TypeScript SDK). Use its `Server`, `StdioServerTransport`, and `StreamableHTTPServerTransport`.
- **P2P:** `hyperswarm` (topic-based DHT + Noise streams) and `b4a` for buffer utilities. Optionally `hypercore-crypto` for Ed25519/X25519 primitives — or use Node's built-in `crypto.sign` / `crypto.createPublicKey` with `ed25519` and `x25519`.
- **Crypto for group layer:** `@stablelib/xchacha20poly1305`, `@stablelib/hkdf`, `@stablelib/blake3`. Ed25519/X25519 via Node `crypto`.
- **Storage:** `better-sqlite3` under `~/.agentchat/store.db` for message history, room metadata, contact book.
- **TUI:** `ink` + `ink-text-input` + `chalk` for a readable 3-pane view (room list / message log / input).
- **CLI framework:** `commander` for the console entrypoint.
- **Lint/format:** `biome`. **Test:** `vitest`. **Build:** `tsup` producing a single CJS + ESM bundle and a `bin/agentchat` shebang script.

---

## PROJECT LAYOUT

```
agentchat-mcp/
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
├── src/
│   ├── bin/
│   │   ├── agentchat.ts         # main CLI: `agentchat mcp | tui | daemon | ticket ...`
│   │   └── agentchat-mcp.ts     # thin wrapper = `agentchat mcp --stdio`
│   ├── mcp/
│   │   ├── server.ts            # builds MCP Server instance, registers tools
│   │   ├── tools.ts             # tool schemas + handlers
│   │   ├── prompts.ts           # registers MCP prompts (surface as /mcp__agentchat__*)
│   │   └── http.ts              # Streamable HTTP transport wiring
│   ├── p2p/
│   │   ├── swarm.ts             # hyperswarm wrapper, topic management
│   │   ├── room.ts              # Room class: members, key schedule, message fanout
│   │   ├── identity.ts          # keypair load/generate, signing
│   │   ├── ticket.ts            # encode/decode base32 tickets
│   │   └── crypto.ts            # HKDF, XChaCha20, sender keys
│   ├── store/
│   │   ├── db.ts                # sqlite schema + migrations
│   │   └── repo.ts              # typed repo for messages/rooms/contacts
│   ├── tui/
│   │   ├── app.tsx              # ink root
│   │   ├── panes/
│   │   └── client.ts            # talks to local daemon over Streamable HTTP
│   ├── daemon/
│   │   └── index.ts             # long-running process hosting swarm + HTTP MCP
│   └── skill/
│       └── chat/
│           └── SKILL.md         # the Claude Code skill (/chat dispatcher)
└── tests/
    ├── ticket.test.ts
    ├── crypto.test.ts
    ├── room.test.ts             # two-peer loopback integration test
    └── tools.test.ts            # MCP tool contract tests
```

---

## MCP TOOL SURFACE (exact specs)

Register these tools on the MCP server. All tools return `{ content: [{ type: "text", text: <human-readable> }], structuredContent: <json> }`.

| Tool name | Input (zod schema) | Returns `structuredContent` |
|---|---|---|
| `chat_whoami` | `{}` | `{ pubkey, nickname, joined_rooms: string[] }` |
| `chat_create_room` | `{ name: string, topic?: string }` | `{ room_id, name, ticket }` |
| `chat_join_room` | `{ ticket: string, nickname?: string }` | `{ room_id, name, members: Member[] }` |
| `chat_leave_room` | `{ room: string }` | `{ ok: true }` |
| `chat_list_rooms` | `{}` | `{ rooms: RoomSummary[] }` |
| `chat_list_members` | `{ room: string }` | `{ members: Member[] }` |
| `chat_send_message` | `{ room: string, text: string, reply_to?: string }` | `{ message_id, ts }` |
| `chat_direct_message` | `{ peer: string, text: string }` | `{ message_id, room_id }` |
| `chat_fetch_history` | `{ room: string, limit?: number, before?: string }` | `{ messages: Message[] }` |
| `chat_tail` | `{ room: string, since?: string, wait_ms?: number }` | `{ messages: Message[] }` (long-poll up to `wait_ms`, default 0 = immediate) |
| `chat_set_nickname` | `{ nickname: string }` | `{ ok: true }` |
| `chat_set_topic` | `{ room: string, topic: string }` | `{ ok: true }` |
| `chat_create_invite` | `{ room: string }` | `{ ticket }` |
| `chat_kick` | `{ room: string, pubkey: string }` | `{ ok: true }` |

Types:

```ts
type Member   = { pubkey: string; nickname: string; online: boolean; joined_at: string };
type Message  = { id: string; room_id: string; sender: string; nickname: string;
                  text: string; ts: string; reply_to?: string; signature: string };
type RoomSummary = { id: string; name: string; topic: string; members: number; unread: number };
```

Tool **descriptions** (the `description` field) must be written for an LLM audience: say explicitly *"Use this to coordinate with other AI agents or humans in the same room. Messages are broadcast to all room members."*

Also register two **MCP prompts** (so Claude Code exposes them as `/mcp__agentchat__*`):
- `agent_handoff` — templated prompt that summarizes current task state and posts to a room.
- `standup` — templated prompt that posts a structured status update.

---

## WIRE PROTOCOL ON HYPERSWARM

Over each peer connection (Noise-encrypted duplex stream), frame length-prefixed CBOR messages:

```
Envelope = {
  v: 1,
  type: "hello" | "members" | "msg" | "key_update" | "kick" | "ping" | "pong",
  room: <room_id, 32B>,
  from: <sender_pubkey, 32B>,
  ts: <unix_ms>,
  nonce: <24B>,
  payload: <ciphertext>,   // XChaCha20-Poly1305 over the inner JSON
  sig: <Ed25519 sig, 64B>  // over (v||type||room||from||ts||nonce||payload)
}
```

Inner payloads:
- `hello` → `{ nickname, client: "claude-code" | "codex-cli" | ... , version }`
- `msg`   → `{ id, text, reply_to? }`
- `members` → `{ members: Member[] }` (gossiped on join, reconciled via LWW by `joined_at`)
- `key_update` → `{ new_epoch, sender_key_shares: { <recipient_pubkey>: <x25519-sealed> } }`

On receive: verify signature → decrypt → persist to sqlite → emit on internal `EventEmitter` the MCP tool handlers subscribe to for `chat_tail` long-poll.

---

## KEY SCHEDULE (keep it simple, not MLS)

1. Room creator generates a 32-byte `root_secret`. The ticket carries `root_secret`.
2. Epoch 0 room key: `K0 = HKDF(root_secret, salt=room_id, info="agentchat v1 epoch 0")`.
3. On join, the newcomer proves possession of the ticket by sending a `hello` encrypted with `K_current`. Existing members reply with `members` + current epoch number.
4. On `leave`/`kick`, any remaining member initiates `key_update`: new 32B `sender_key`, sealed to each remaining member's X25519 key (derived from their Ed25519 identity via `crypto_sign_ed25519_pk_to_curve25519` equivalent). Members adopt `K_{n+1} = HKDF(sender_key, ...)`.
5. Document clearly that **compromise of a member before rotation leaks prior epoch messages** — this is not MLS, it is a pragmatic tradeoff. Add a TODO referencing MLS / Messaging Layer Security for a future upgrade.

---

## THE CLAUDE CODE SKILL (`src/skill/chat/SKILL.md`)

```markdown
---
name: chat
description: Peer-to-peer group chat with other agents and humans. Use this to coordinate tasks, hand off work, ask another agent a question, or post a status update. Sub-verbs follow IRC conventions.
argument-hint: <verb> [args...]
---

You are dispatching an agentchat command. The first argument is the verb.

Verb: $0
Rest: $ARGUMENTS

Available verbs and their MCP tool mappings on the `agentchat` server:

- `join <ticket>`            → call tool `chat_join_room` with `{ ticket: $1 }`
- `create <name>`            → call tool `chat_create_room` with `{ name: $1 }`, then print the returned ticket
- `leave [<room>]`           → call tool `chat_leave_room`
- `list`                     → call tool `chat_list_rooms`
- `who [<room>]`             → call tool `chat_list_members`
- `say <room> <message...>`  → call tool `chat_send_message` with `{ room: $1, text: <rest> }`
- `msg <peer> <message...>`  → call tool `chat_direct_message`
- `history <room> [n]`       → call tool `chat_fetch_history`
- `tail <room>`              → call tool `chat_tail` with `{ room: $1, wait_ms: 5000 }`
- `nick <new>`               → call tool `chat_set_nickname`
- `whoami`                   → call tool `chat_whoami`
- `topic <room> [<text...>]` → call tool `chat_set_topic` or `chat_list_rooms` (for read)
- `invite <room>`            → call tool `chat_create_invite`
- `kick <room> <pubkey>`     → call tool `chat_kick`
- `mute <pubkey>`            → record locally (no network call)
- `help`                     → print this verb table

Rules:
1. Parse `$0` as the verb. If it is unrecognized or empty, print the `help` table and stop.
2. Quote-aware argument splitting — treat the argument string after the verb as IRC-style: first token is the room or peer, remainder is free text.
3. After any tool call, render the `structuredContent` as a concise human summary. For `history` and `tail`, format as `[HH:MM] @nickname: text`.
4. Never invent room names or tickets — if a required argument is missing, ask the user for it once.
```

A legacy duplicate at `.claude/commands/chat.md` with the same body makes `/chat` work in older installs.

---

## CONSOLE TUI

`agentchat tui` opens an Ink app that **talks to a running daemon over Streamable HTTP MCP** (so the TUI and an attached agent see the same rooms and messages consistently). Layout:

```
┌─ Rooms ────────┬──────────────────────────────────────────────────────────┐
│ #general   (3) │ [14:22] @alice-bot (claude-code): pushed the refactor    │
│ #review    (2) │ [14:22] @bob (human):             lgtm, merging          │
│ dm:@carol  (1) │ [14:23] @codex-agent (codex-cli): running tests now...   │
├────────────────┼──────────────────────────────────────────────────────────┤
│                │ > type here, Enter to send, /help for commands           │
└────────────────┴──────────────────────────────────────────────────────────┘
```

Keybindings: `Ctrl+N` next room, `Ctrl+P` prev, `Ctrl+J` join by ticket (paste prompt), `Ctrl+C` quit. Slash commands in the input line mirror the skill verbs exactly.

---

## CLI ENTRYPOINTS

```
agentchat mcp                  # start stdio MCP server (for Claude Code / Codex CLI)
agentchat mcp --http :7777     # start Streamable HTTP MCP server on port 7777
agentchat daemon               # start long-running daemon (swarm + HTTP MCP on a unix socket)
agentchat tui                  # attach Ink TUI to running daemon (auto-starts if missing)
agentchat ticket create <name> # print a fresh ticket for a new room
agentchat ticket show <room>   # re-print a room's ticket
agentchat doctor               # verify config, keys, connectivity (hyperswarm DHT bootstrap)
```

The stdio MCP server (`agentchat mcp`) must itself spawn / connect to the daemon's swarm — either in-process (if no daemon running) or as a client of the daemon's local HTTP MCP. Default: in-process when launched by an MCP client, so installing is one step.

---

## INSTALL INSTRUCTIONS (ship these in README.md)

### Claude Code
```bash
npm install -g agentchat-mcp
claude mcp add agentchat -s user -- npx -y agentchat-mcp
mkdir -p ~/.claude/skills/chat
curl -fsSL https://raw.githubusercontent.com/<you>/agentchat-mcp/main/src/skill/chat/SKILL.md \
  -o ~/.claude/skills/chat/SKILL.md
```
Then `/chat help` inside Claude Code.

### Codex CLI
Edit `~/.codex/config.toml`:
```toml
[mcp_servers.agentchat]
command = "npx"
args = ["-y", "agentchat-mcp"]
```
Codex CLI's stable MCP client is stdio-only, which is why our primary transport is stdio.

### Claude Desktop
Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the Windows/Linux equivalent:
```json
{
  "mcpServers": {
    "agentchat": {
      "command": "npx",
      "args": ["-y", "agentchat-mcp"]
    }
  }
}
```

### Codex Desktop (VS Code extension)
Settings → MCP Servers → Add → STDIO → command `npx`, args `-y agentchat-mcp`.

### Standalone TUI
`npx agentchat-mcp tui` — no MCP client required.

---

## ACCEPTANCE TESTS (must all pass before you declare done)

1. **Two-peer loopback** (`tests/room.test.ts`): spin up two in-process swarms on a local DHT bootstrap, create a room on A, join from B using the ticket, send 10 messages from each side, assert both stores contain all 20 in order and signatures verify.
2. **Membership churn**: A creates room, B joins, A kicks B, A rotates key, C joins with a fresh invite, A sends message, assert C decrypts and B (still connected) cannot.
3. **MCP tool contract** (`tests/tools.test.ts`): start stdio MCP server in a subprocess, drive it over JSON-RPC, assert every tool's schema matches its zod definition and that error responses use the MCP-spec error shape.
4. **Streamable HTTP transport**: `POST /mcp` with a `tools/list` JSON-RPC request returns the full tool list; `GET /mcp` opens an SSE stream that emits a heartbeat every 30s.
5. **Claude Code skill dry-run**: parse `$ARGUMENTS = "say #general hello world"` from the SKILL.md substitution rules and assert the dispatcher picks `chat_send_message` with `{ room: "#general", text: "hello world" }`.
6. **Ticket roundtrip**: random room, encode ticket, decode, assert `room_id`, `root_secret`, and bootstrap peer list match.
7. **Doctor**: `agentchat doctor` exits 0 on a healthy install and prints a checklist (keys present, sqlite writable, DHT reachable, MCP stdio handshake OK).

---

## DELIVERABLES

- Full source tree as above, all tests passing under `pnpm test`.
- `README.md` with the install instructions above plus a "How it works" section (Hyperswarm topic → Noise stream → signed+encrypted envelope → sqlite → MCP tool).
- A `SECURITY.md` that is honest about the threat model: E2E between current members, forward secrecy only across epoch rotations, IP addresses are visible to peers you connect to (standard for any P2P system), no anonymity.
- A short `DEMO.md` showing a scripted 3-agent session: Claude Code agent, Codex CLI agent, and a human in the TUI collaborating on a refactor.
- `CHANGELOG.md` starting at `0.1.0`.
- An npm-publishable `package.json` with `"bin": { "agentchat": "./dist/bin/agentchat.js", "agentchat-mcp": "./dist/bin/agentchat-mcp.js" }`.

---

## WORKING STYLE

1. Start by writing `README.md` and `SECURITY.md` to lock the design, then scaffold.
2. Implement bottom-up: `crypto.ts` → `ticket.ts` → `identity.ts` → `store` → `p2p/swarm.ts` → `p2p/room.ts` → `mcp/tools.ts` → `mcp/server.ts` → stdio transport → HTTP transport → CLI → TUI → skill.
3. Write the two-peer loopback test the moment `p2p/room.ts` compiles — do not defer it.
4. Every tool handler must have at least one unit test.
5. Use `biome check --write` before every commit. Use conventional-commit messages.
6. When any spec ambiguity arises, prefer the MCP spec dated 2025-11-25 and the Hyperswarm README as canonical.

Now: produce a plan, confirm the plan, then build it end-to-end.
