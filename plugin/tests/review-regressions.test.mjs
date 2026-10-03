import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519WorkloadIdentityRegistry } from "../mcp/workload-identities.mjs";
import { DelegationCapabilityAuthority } from "../mcp/delegation-capabilities.mjs";
import { EvidenceReceiptChain } from "../mcp/evidence-receipts.mjs";
import { CardTeamOrchestrator } from "../mcp/card-teams.mjs";
import { WorkloadRegistry, DelegationAuthority, ReceiptChain, sha256 } from "../../examples/easy-starter/src/miseos.mjs";

for (const plugin of [true, false]) {
  const label = plugin ? "plugin" : "starter";
  function fixture() {
    const identities = plugin ? new Ed25519WorkloadIdentityRegistry() : new WorkloadRegistry();
    const authority = plugin ? new DelegationCapabilityAuthority({ defaultTtlMs: 1000 }) : new DelegationAuthority({ ttlMs: 1000 });
    const subject = identities.ensureCard("mise-maestro");
    const target = identities.ensureCard("mise-garde");
    const chain = plugin ? new EvidenceReceiptChain({ identities, delegationAuthority: authority }) : new ReceiptChain({ identities, authority });
    const scope = {
      ...(plugin ? { subjectIdentity: subject, targetIdentity: target } : { subject, target }),
      targetCardId: target.cardId, runId: "run_test", hop: 1,
      memoryId: "mem_test", inputHash: sha256("input"), previousReceiptHash: "0".repeat(64),
    };
    function event(token, claims) {
      return {
        runId: scope.runId, fromCardId: subject.cardId, toCardId: target.cardId,
        toWorkloadId: target.workloadId, toWorkloadKeyId: target.keyId,
        inputMemoryId: scope.memoryId, input: "input", output: "output",
        ...(plugin ? { authorization: { token, claims } } : { token, claims }),
      };
    }
    return { identities, authority, scope, chain, event };
  }

  test(`${label}: issuing requires complete one-hop scope`, () => {
    const { authority, scope } = fixture();
    for (const field of ["targetCardId", "runId", "hop", "memoryId", "inputHash", "previousReceiptHash"]) {
      for (const invalid of [undefined, null, "", " ", 0, -1, 1.5, Infinity, {}, []]) {
        assert.throws(() => authority.issue({ ...scope, [field]: invalid }), undefined, `${field}=${invalid}`);
      }
    }
    assert.throws(() => authority.issue({ ...scope, [plugin ? "targetIdentity" : "target"]: null }), /destination/i);
    const terminal = { ...scope, [plugin ? "targetIdentity" : "target"]: null, targetCardId: "human-pass" };
    assert.doesNotThrow(() => authority.issue(terminal));
  });

  test(`${label}: receipts reject unconsumed, forged, and foreign authorizations`, () => {
    const { authority, scope, chain, event } = fixture();
    const token = authority.issue(scope);
    const unconsumed = authority.verify(token);
    assert.throws(() => chain.append([], event(token, unconsumed)), /consumed/);
    const claims = authority.verifyAndConsume(token);
    assert.throws(() => chain.append([], event(token, { ...claims, jti: "forged" })), /consumed/);
    const foreign = fixture();
    const foreignToken = foreign.authority.issue(foreign.scope);
    const foreignClaims = foreign.authority.verifyAndConsume(foreignToken);
    assert.throws(() => chain.append([], event(foreignToken, foreignClaims)), /consumed/);
    assert.throws(() => chain.append([], event(token + "x", claims)), /consumed/);
    const receipts = [];
    chain.append(receipts, event(token, claims));
    assert.equal(chain.verify(receipts), true);
    assert.equal(receipts[0].capabilityJti, claims.jti);
    // Earlier v2 receipts predate authorizedAt and keep creation-time validation.
    const { receiptHash: _hash, signature: _signature, signatureAlgorithm, authorizedAt: _time, ...legacyBody } = receipts[0];
    const legacyHash = sha256(legacyBody);
    const signer = chain.identities;
    const legacy = {
      ...legacyBody, receiptHash: legacyHash, signatureAlgorithm,
      signature: signer.sign({ workloadId: legacyBody.workloadIdentity.workloadId, payload: legacyHash }),
    };
    assert.equal(chain.verify([legacy]), true);
    assert.throws(() => authority.verifyAndConsume(token), /consumed/);
  });

  test(`${label}: every receipt event binding is verified before signing`, () => {
    const { authority, scope, chain, event } = fixture();
    const token = authority.issue(scope);
    const claims = authority.verifyAndConsume(token);
    const validEvent = event(token, claims);
    for (const [field, value] of Object.entries({
      runId: "other_run", fromCardId: "mise-apprentice", toCardId: "mise-apprentice",
      toWorkloadId: "other_workload", toWorkloadKeyId: "other_key",
      inputMemoryId: "other_memory", input: "different input",
    })) {
      const receipts = [];
      assert.throws(() => chain.append(receipts, { ...validEvent, [field]: value }), /does not authorize/);
      assert.equal(receipts.length, 0);
    }
    assert.throws(() => chain.append([{ receiptHash: "a".repeat(64) }], validEvent), /does not authorize/);
    const wrongHop = authority.issue({ ...scope, hop: 2 });
    assert.throws(() => chain.append([], event(wrongHop, authority.verifyAndConsume(wrongHop))), /does not authorize/);
  });

  test(`${label}: replay entries expire while delayed receipts remain valid`, (t) => {
    t.mock.method(Date, "now", () => 1_800_000_000_000);
    const { authority, scope, chain, event } = fixture();
    const token = authority.issue(scope);
    const claims = authority.verifyAndConsume(token);
    assert.equal(authority.consumedCount, 1);
    assert.throws(() => authority.verifyAndConsume(token), /consumed/);
    Date.now.mock.mockImplementation(() => 1_800_000_002_000);
    const receipts = [];
    chain.append(receipts, event(token, claims));
    assert.equal(chain.verify(receipts), true);
    assert.ok(Date.parse(receipts[0].createdAt) >= Date.parse(claims.exp));
    assert.equal(authority.consumedCount, 0);
    assert.throws(() => authority.verifyAndConsume(token), /expired|currently valid/);
    // Neither a forged authorization timestamp nor a missing timestamp is accepted.
    assert.equal(chain.verify([{ ...receipts[0], authorizedAt: claims.exp }]), false);
    assert.equal(chain.verify([{ ...receipts[0], authorizedAt: undefined }]), false);
  });
}

test("orchestrator rejects injected receipt chains with either mismatched dependency", () => {
  const identities = new Ed25519WorkloadIdentityRegistry();
  const delegationAuthority = new DelegationCapabilityAuthority();
  const receipts = new EvidenceReceiptChain({ identities, delegationAuthority });
  const bot = { chat: async () => ({ answer: "bounded output" }) };
  assert.doesNotThrow(() => new CardTeamOrchestrator({ bot, identities, delegationAuthority, receipts }));
  assert.throws(() => new CardTeamOrchestrator({ bot, delegationAuthority, receipts }), /share/);
  assert.throws(() => new CardTeamOrchestrator({ bot, identities, receipts }), /share/);
});

test("orchestrator handles inference exceeding the capability TTL", async (t) => {
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  const delegationAuthority = new DelegationCapabilityAuthority({ defaultTtlMs: 1000 });
  const bot = { chat: async () => {
    const now = Date.now();
    Date.now.mock.mockImplementation(() => now + 2000);
    return { answer: "bounded output" };
  }};
  const orchestrator = new CardTeamOrchestrator({ bot, delegationAuthority });
  const result = await orchestrator.run({ prompt: "review", team: ["mise-maestro", "mise-garde"] });
  assert.equal(result.receiptChainValid, true);
});
