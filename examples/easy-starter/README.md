# MiseOS Easy Starter

A zero-dependency Node.js starter for **advisory multi-agent card teams** with cryptographic workload identities, bounded one-hop delegation, ephemeral handoff memory, and signed evidence receipts.

The starter is deliberately not a repository-writing agent. Its governing boundary is:

> **Team consensus does not grant write authority.**

## What it demonstrates

- Separate Ed25519 identity per card workload
- Controller-signed, destination-bound, one-use delegation capabilities
- Run-scoped, card-scoped ephemeral memory
- Hash-linked, card-signed handoff receipts
- Offline deterministic demo mode
- Optional OpenRouter free-model inference
- Secret-like material rejected before model context
- Explicit `authority: advisory` and `writeAuthority: none`

## Start

Requires Node.js 20+ and has no npm dependencies.

```bash
cp .env.example .env
# Add OPENROUTER_API_KEY to .env if you want live inference.
npm start
```

Run one task directly:

```bash
npm start -- "Design a secure MCP mutation gateway"
```

Run fully offline:

```bash
npm run demo
```

Validate the package:

```bash
npm run verify
```

## Default card team

```text
Mise Maestro
   │  architect
   ▼
Mise Garde
   │  adversarial review
   ▼
Mise Apprentice
   │  regression/test plan
   ▼
Mise Sommelier
   │  evidence audit
   ▼
Human Pass
```

Every transition is bound to the source workload, destination workload, run, hop, memory object, input hash, and previous receipt hash.

## Security boundary

```text
controller Ed25519 key
        │
        ├── signs one-hop capability token
        ▼
source workload ───────► destination workload
        │
        ├── model inference sees only bounded handoff context
        │
        └── source workload Ed25519-signs evidence receipt
                              │
                              ▼
                       hash-linked chain
```

Private keys and delegation tokens are not sent to the model. Memory is purged after the run. A card key cannot mint controller authority, and a controller-signed card-processing capability does not confer repository mutation rights.

See [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) for the threat model and trust boundaries.

## Files

```text
src/miseos.mjs          security primitives + card team runtime
src/cli.mjs             interactive/direct CLI
src/demo.mjs            offline evidence-chain demo
test/security.test.mjs  security regression suite
docs/SECURITY-MODEL.md  trust boundary and threat model
QUICKSTART.md            shortest path to first run
```

## Non-goals

This starter does **not** provide persistent key storage, HSM/KMS integration, durable replay protection, network service isolation, repository write capabilities, production authorization policy, or a complete MCP gateway. Those belong in the full MiseOS control plane.
