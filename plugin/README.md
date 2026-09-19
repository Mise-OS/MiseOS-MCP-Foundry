# MiseOS MCP Foundry plugin

Claude Code / MCP plugin for gated GitHub repo management and free OpenRouter developer assistance.

## Install

Copy `plugin/` into a Claude Code plugins directory, or clone this repository and point the host at `plugin/`.

Set `OPENROUTER_API_KEY` in the MCP host environment. The key is never stored in `.mcp.json` or passed into model context.

Optional:

- `OPENROUTER_MODEL=openrouter/free` (default)
- `MISEOS_OPENROUTER_SESSION_LIMIT=40`
- `MISEOS_OPENROUTER_TIMEOUT_MS=20000`

## Skills

- **capability-gateway** — allow / hold / deny for inspect, plan, execute, PR, guard, push, release.
- **repo-steward** — ingest → plan → approve → execute. Auto-push is off.
- **developer-bot** — free-only OpenRouter developer help through bounded MiseOS character cards.

## MCP servers

`plugin/mcp/gateway.mjs` provides the repository capability boundary.

`plugin/mcp/developer-bot.mjs` provides:

- `miseos_cards_list`
- `miseos_card_get`
- `miseos_dev_chat`
- `miseos_team_run`

## Card Memory + Cryptographic Card Teams

The default team is:

```text
Mise Maestro → Mise Garde → Mise Apprentice → Mise Sommelier → human pass
```

A team run does **not** place all context into one shared conversation. The initial task capsule belongs only to Maestro; downstream cards receive only one-hop handoffs. All card memory is ephemeral and purged after the run.

Each runtime card instance receives a separate Ed25519 workload identity. Private keys remain inside the trusted orchestration process and are never placed into model prompts, card memory, MCP responses, or OpenRouter payloads.

Before each hop, a separate Ed25519 team-controller identity mints a short-lived, one-use `miseos.delegation-capability.v1` token. The token is bound to:

- source workload ID and key ID
- exact destination workload ID and key ID, or `human-pass`
- team run ID
- hop number
- input memory ID and input hash
- previous receipt hash
- issue/expiry times and unique token ID
- the single internal capability `card.process-and-handoff`

The token is verified and consumed **before** model execution. Card consensus never grants repository mutation authority.

Every handoff then emits `miseos.card-handoff.receipt.v2`. The receipt contains the consumed capability token, its hash, the card's public workload identity, source/destination metadata, input/output hashes, model metadata, previous receipt hash, and an Ed25519 signature produced by the source card workload key. Raw prompt/output content is not copied into the receipt.

This creates two independent proofs:

```text
team-controller key → authorizes exact one-hop capability
card workload key   → attests the resulting handoff receipt
```

A controller token cannot forge a card receipt, and a card key cannot mint a broader controller capability.

Secret-like material is blocked before it can enter card memory, downstream handoffs, or OpenRouter request payloads.

## Authority boundary

```text
bounded memory
      ↓
controller-signed one-hop capability
      ↓
card workload identity
      ↓
free model inference
      ↓
Ed25519-signed evidence receipt
      ↓
next bounded workload / human pass
      ↓
repository capability gateway
      ↓
human approval for writes
```

Personality, cryptographic team identity, and team consensus remain advisory. They do not grant `execute`, `push`, `release`, or repository-write authority.

## Production key-management boundary

The current reference implementation generates card and controller Ed25519 keys in-process for each runtime instance. Production deployments should inject equivalent workload signers backed by KMS/HSM/TEE or another protected workload-identity service, persist replay/JTI state outside one process when cross-process replay resistance is required, and anchor the controller public key in an independently trusted configuration.

Unknown quantities stay `null`. Writes hold until a human signs the pass.
