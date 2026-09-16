# MiseOS MCP Foundry plugin

Claude Code / MCP plugin for gated GitHub repo management plus a free-inference MiseOS developer bot.

## Install

Copy `plugin/` into a Claude Code plugins directory, or clone this repository and point the host at `plugin/`.

## Skills

- **capability-gateway** — allow / hold / deny for inspect, plan, execute, PR, guard, push, release. Emits `miseos.capability-gateway.cycle.v1` audit records.
- **repo-steward** — ingest → plan → approve → execute. Auto-push is off.
- **developer-bot** — character/personality-driven developer help through OpenRouter free inference. Advisory only.

## MCP servers

### Capability gateway

`plugin/mcp/gateway.mjs` speaks JSON-RPC on stdin/stdout.

Tools:

- `capability_list`
- `capability_invoke`
- `capability_cycle`

Schema: `plugin/schemas/gateway-cycle.schema.json`

Unknown quantities stay `null`. Writes hold until a human signs the pass. `push` is denied in v1.

### OpenRouter free developer bot

`plugin/mcp/developer-bot.mjs` is registered as `miseos-developer-bot` in `plugin/.mcp.json`.

Tools:

- `miseos_cards_list`
- `miseos_card_get`
- `miseos_dev_chat`

Set `OPENROUTER_API_KEY` in the host environment. The key is inherited by the child process and is never stored in the MCP config.

The bot defaults to `openrouter/free`. Explicit model overrides must be `openrouter/free` or end in `:free`; paid routes are rejected before network access. Personality changes behavior, not authority: the bot has no repository write authority and must hand proposed mutations back to the capability gateway.

See `docs/openrouter-free-developer-bot.md` for the card roster, setup, and security boundary.

The kitchen Foundry app hosts the live repo tools (`repo_ingest`, `agent_plan`, `github_create_pr`, `guard_repo`).
