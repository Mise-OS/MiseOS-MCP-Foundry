# OpenRouter Free Developer Bot

MiseOS MCP Foundry can expose a free-inference developer bot through OpenRouter while keeping repository authority outside the model.

## Boundary

```text
MiseOS character card
        ↓
OpenRouter free-only client
        ↓
advisory developer answer
        ↓
capability proposal
        ↓
MiseOS gateway allow / hold / deny
        ↓
human approval for writes
```

The model never receives repository write authority. Character/personality changes affect voice, priorities, and reasoning stance only.

## Free-only enforcement

The runtime accepts only:

- `openrouter/free`
- explicit OpenRouter model IDs ending in `:free`

Any other model ID throws `PaidModelBlockedError` before network access. There is no automatic paid fallback.

The default is `openrouter/free`, which lets OpenRouter select from currently available free models while filtering for request capabilities.

## Configure

Set the API key in the host environment:

```bash
export OPENROUTER_API_KEY="..."
export OPENROUTER_MODEL="openrouter/free"
export OPENROUTER_APP_NAME="MiseOS Free Developer Bot"
export OPENROUTER_SITE_URL="https://github.com/Mise-OS/MiseOS-MCP-Foundry"
```

Optional local request cap:

```bash
export MISEOS_OPENROUTER_SESSION_LIMIT=40
```

The key is inherited by the MCP process. It is not stored in `plugin/.mcp.json`.

## MCP tools

### `miseos_cards_list`

Returns the character catalog.

### `miseos_card_get`

Returns one card plus the runtime system prompt.

### `miseos_dev_chat`

Inputs:

```json
{
  "cardId": "mise-garde",
  "prompt": "Review this parser change for bypasses",
  "context": {
    "files": ["src/parser.ts"],
    "test": "parser rejects malformed metadata"
  }
}
```

The result includes the selected card, answer, requested/served model, usage when OpenRouter returns it, and a fixed authority envelope:

```json
{
  "authority": "advisory",
  "writeAuthority": "none",
  "freeOnly": true
}
```

## Character cards

The initial roster includes:

- Mise Maestro — architecture and orchestration
- Mise Garde — security and code review
- Mise Brigadier — repository stewardship
- Mise Sauce — workflow automation
- Mise Bootstrap — scaffolding
- Mise Locker — reusable patterns and infrastructure
- Mise GPU — performance
- Mise Runtime — scheduling and reliability
- Mise Soul — human-in-the-loop governance
- Mise Sommelier — evidence and traceability
- Mise Apprentice — testing and learning loops
- Shield Pup — perimeter security
- Release Sentinel — release evidence gates

Every card inherits the same non-negotiable authority and secret-handling guardrails.

## Verify without an API key

The tests use a mocked fetch path and never contact OpenRouter:

```bash
node --test plugin/tests/*.test.mjs
```

They verify free-model enforcement, character prompt composition, advisory-only authority, secret-free request payloads, and fail-closed unknown-card behavior.

## OpenRouter references

- Quickstart: https://openrouter.ai/docs/quickstart
- Free router: https://openrouter.ai/openrouter/free
- Free model collection: https://openrouter.ai/collections/free-models

Free model availability and provider rate limits can change. The MiseOS contract is therefore based on the free-route identifier, not on a hard-coded provider roster.
