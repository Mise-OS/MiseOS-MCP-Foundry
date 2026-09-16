# MiseOS Examples

## Easy Starter

[`easy-starter/`](easy-starter/) is the smallest runnable Card Teams example in the repository. It has zero npm dependencies and demonstrates Ed25519 workload identities, controller-signed one-hop delegation, bounded ephemeral memory, signed evidence receipts, offline execution, and an explicit advisory-only authority boundary.

Run it with Node.js 20+:

```bash
cd examples/easy-starter
npm run verify
npm run demo
```

The starter intentionally has no repository write authority. See [`easy-starter/docs/SECURITY-MODEL.md`](easy-starter/docs/SECURITY-MODEL.md) before adapting it for any mutation-capable workflow.
