# MiseOS MCP Foundry plugin

Claude Code / MCP plugin for gated GitHub repo management and free OpenRouter developer assistance.

## Install

Copy `plugin/` into a Claude Code plugins directory, or clone this repository and point the host at `plugin/`.

Set `OPENROUTER_API_KEY` in the MCP host environment. The key is never stored in `.mcp.json` or passed into model context.

Optional:

- `OPENROUTER_MODEL=openrouter/free` (default)
- `MISEOS_OPENROUTER_SESSION_LIMIT=40`
- `MISEOS_RECEIPT_HMAC_KEY=<host-only signing key>` to HMAC-sign card handoff receipts

## Skills

- **capability-gateway** — allow / hold / deny for inspect, plan, execute, PR, guard, push, release. Emits `miseos.capability-gateway.cycle.v1` audit records.
- **repo-steward** — ingest → plan → approve → execute. Auto-push is off.
- **developer-bot** — free-only OpenRouter developer help through bounded MiseOS character cards.

## MCP servers

`plugin/mcp/gateway.mjs` provides the capability boundary.

`plugin/mcp/developer-bot.mjs` provides:

- `miseos_cards_list`
- `miseos_card_get`
- `miseos_dev_chat`
- `miseos_team_run`

## Card Memory + Teams

The default team is:

```text
Mise Maestro → Mise Garde → Mise Apprentice → Mise Sommelier → human pass
```

A team run does **not** place all context into one shared conversation. Instead:

1. The initial task capsule is ephemeral memory owned by Maestro.
2. Maestro receives only that capsule and emits a bounded handoff.
3. That handoff is stored as one-hop memory shared only with Garde.
4. Garde repeats the pattern for Apprentice, then Apprentice for Sommelier.
5. Sommelier returns the final advisory recommendation to the human pass.
6. All ephemeral card memory is purged when the run ends.

Every handoff emits `miseos.card-handoff.receipt.v1` containing hashes, byte counts, card identities, model metadata, previous receipt hash, and optional HMAC signature. Raw prompt/output content is not stored in the receipt.

Secret-like material is blocked before it can be placed into card memory or delegated downstream.

## Authority boundary

Personality and team consensus never grant authority.

```text
card memory → free inference → one-hop handoff → evidence receipt
                                           ↓
                                      final advice
                                           ↓
                                 capability gateway
                                           ↓
                                   human approval
```

Unknown quantities stay `null`. Writes hold until a human signs the pass. `push` is denied in v1.
