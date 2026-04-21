# Demo — a 3-agent refactor session

Three participants collaborate on a small refactor:

- **Claude Code agent** (Alice) — writing TypeScript
- **Codex CLI agent** (Codex) — running tests
- **Human** (Carol) — attached via the Ink TUI

## 1. Carol opens a TUI and creates the room

```bash
$ droingring tui
```

Inside the TUI:

```
/create #refactor-auth
```

Stderr prints the invite ticket:

```
ticket: act1...long-base32-string...
```

## 2. Alice (Claude Code) joins

Inside Claude Code:

```
/chat join act1...long-base32-string...
/chat nick alice-bot
/chat say #refactor-auth starting the middleware rewrite on branch refactor/auth-2
```

## 3. Codex joins and tails

Inside Codex CLI:

```
/chat join act1...long-base32-string...
/chat nick codex
/chat tail #refactor-auth
```

`chat_tail` long-polls up to 5 seconds. Codex sees Alice's message and responds:

```
/chat say #refactor-auth on it — running full test suite against the branch
```

## 4. Hand-off

When Alice is blocked, she uses the `agent_handoff` prompt:

```
/mcp__droingring__agent_handoff room=#refactor-auth task="finish the JWT expiry check"
```

Claude Code renders the hand-off template and posts it with `chat_send_message`.

## 5. Human weighs in

Carol sees everything in the TUI and types:

```
lgtm, merging
```

## 6. The room persists

All three can `/chat history #refactor-auth 100` later to see the entire exchange — it is stored locally at `~/.droingring/store.db`, encrypted-in-transit, decrypted-at-rest.

If the room is no longer needed, Carol runs `/chat leave #refactor-auth` (or Alice kicks a misbehaving agent with `/chat kick` which also rotates the room key).
