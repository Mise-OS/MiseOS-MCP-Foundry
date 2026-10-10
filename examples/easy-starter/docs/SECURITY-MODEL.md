# MiseOS Easy Starter — Security Model

## Governing invariant

**Detection is not authorization, consensus is not authority, and a model response is never a capability.**

The starter keeps model reasoning in an advisory lane while cryptographic identity, delegation, and evidence remain outside model context.

## Trust boundaries

1. **Controller identity** — may issue only the starter's `card.process-and-handoff` capability.
2. **Card workload identity** — may sign evidence for its own workload; it cannot mint controller capabilities.
3. **Memory store** — run-scoped and card-scoped; only the owner and explicitly shared next card may read a handoff.
4. **Model client** — receives bounded context and instructions, but no private key and no delegation token.
5. **Human pass** — final stage; the starter itself has no repository write authority.

## Capability binding

Each one-hop capability binds:

- issuer workload + key ID
- source workload + key ID + card ID
- destination workload + key ID + card ID
- run ID
- hop number
- memory ID
- input hash
- previous receipt hash
- issued-at and expiry timestamps

Capabilities are consumed once by the local authority instance. Expired replay entries are pruned during verification; expired tokens cannot be consumed again.

## Evidence receipt

Each receipt records the one-hop capability hash, source workload identity, input/output hashes, previous receipt hash, and source workload signature. Verification fails when receipt content, chain linkage, card identity, capability binding, or signature is changed.

Before signing, receipt emission verifies the capability signature and every event binding against the trusted controller. The authority retains consumption proof in a weak map keyed by the exact returned claims object; copying or inventing claims does not create authorization.

Receipt signing spends that proof once, across all chains sharing the authority. Missing input memory IDs are rejected before signing. Failed validation or signing leaves the proof available for a corrected retry.

New receipts record a signed `authorizedAt` timestamp from the successful consumption, distinct from `createdAt` after inference. Historical verification checks expiry at `authorizedAt`, so inference may finish after the capability expires. Earlier v2 receipts without this field retain the creation-time check. Receipt verification does not consume the token again.

`createdAt` is the emission wall-clock time clamped to at least `authorizedAt`. A backward clock correction therefore preserves causal ordering; it does not backdate authorization or relax token expiry checks.

## Explicit denials

The starter returns:

```json
{
  "authority": "advisory",
  "writeAuthority": "none"
}
```

No number of agreeing cards changes those values.

## Threats covered by regression tests

- workload-key substitution
- destination substitution
- capability replay in the same runtime
- capability schema/capability confusion
- malformed capability timestamps
- unauthorized memory reads
- cross-run memory reads
- receipt tampering
- empty/cyclic card-team misuse
- obvious secret-like task material entering model context

## Production gaps

Before granting any real mutation capability, add durable replay storage, KMS/HSM-held signing keys, authenticated principals, policy/predicate evaluation, explicit capability scopes, revocation, auditable approval records, process/network isolation, rate limits, persistent evidence storage, and fail-closed mediation for each Git/shell/HTTP/MCP action.
