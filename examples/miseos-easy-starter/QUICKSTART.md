# MiseOS Easy Starter

A zero-dependency launcher for the production MiseOS Card Teams runtime already in this repository.

It uses the real:

- Ed25519 card/workload identities
- controller-signed one-hop delegation capabilities
- destination workload/key binding
- replay denial
- ephemeral one-hop card memory
- Ed25519 evidence receipt v2 chain
- Maestro -> Garde -> Apprentice -> Sommelier team
- free-only OpenRouter client

No security implementation is duplicated in this example, so the starter cannot silently drift away from the production runtime.

## Node requirement

Node.js 20+.

## Fast start

```bash
cd examples/miseos-easy-starter
cp .env.example .env
# add OPENROUTER_API_KEY to .env
npm start
```

Windows PowerShell:

```powershell
cd examples/miseos-easy-starter
Copy-Item .env.example .env
# add OPENROUTER_API_KEY to .env
npm start
```

Or use the startup wrappers:

```bash
./start.sh
```

```powershell
.\start.ps1
```

Run one task directly:

```bash
npm start -- "Design a secure MCP mutation gateway"
```

## No API key required

Exercise the complete Card Team identity/delegation/receipt path with mocked inference:

```bash
npm run demo
```

## Verify it

```bash
npm run check
npm test
```

Expected security boundary:

```text
controller Ed25519 identity
        |
        v
one-hop signed capability token
        |
        v
source card workload ----> exact destination workload
        |
        v
free inference
        |
        v
source workload Ed25519 receipt
        |
        v
next bounded card / human pass
```

Cryptographic team authority remains advisory. Repository writes still go through the MiseOS capability gateway and human approval.
