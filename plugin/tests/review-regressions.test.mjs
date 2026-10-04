import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519ControllerIdentity, Ed25519WorkloadIdentityRegistry, stableJson } from "../mcp/workload-identities.mjs";
import { DelegationCapabilityAuthority } from "../mcp/delegation-capabilities.mjs";
import { EvidenceReceiptChain } from "../mcp/evidence-receipts.mjs";
import { CardTeamOrchestrator } from "../mcp/card-teams.mjs";
import { ControllerIdentity, WorkloadRegistry, DelegationAuthority, ReceiptChain, sha256 } from "../../examples/easy-starter/src/miseos.mjs";

for (const plugin of [true, false]) {
  const label = plugin ? "plugin" : "starter";
  function fixture() {
    const identities = plugin ? new Ed25519WorkloadIdentityRegistry() : new WorkloadRegistry();
    const controller = plugin ? new Ed25519ControllerIdentity() : new ControllerIdentity();
    const authority = plugin ? new DelegationCapabilityAuthority({ controller, defaultTtlMs: 1000 }) : new DelegationAuthority({ controller, ttlMs: 1000 });
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
    return { identities, authority, scope, chain, event, controller };
  }

  function resign(receipt, identities, changes) {
    const { receiptHash: _hash, signature: _signature, signatureAlgorithm, ...body } = receipt;
    Object.assign(body, changes);
    for (const key of Object.keys(body)) {
      if (body[key] === undefined) delete body[key];
    }
    const receiptHash = sha256(body);
    return {
      ...body, receiptHash, signatureAlgorithm,
      signature: identities.sign({ workloadId: receipt.workloadIdentity.workloadId, payload: receiptHash }),
    };
  }

  test(`${label}: rejects future-iat tokens and restores the test clock`, async (t) => {
    const originalNow = Date.now;
    await t.test("local and external verifiers reject future and expired signatures", (t) => {
      const issuedAt = 1_800_000_000_000;
      t.mock.method(Date, "now", () => issuedAt);
      const { authority, scope } = fixture();
      const token = authority.issue(scope);
      const expires = issuedAt + 1000;
      for (const now of [issuedAt - 1, expires, expires + 1]) {
        assert.throws(() => authority.verify(token, {}, { now }), /not currently valid|expired|not yet valid/);
        const external = plugin
          ? DelegationCapabilityAuthority.verifyWithAuthority(token, authority.descriptor, {}, { now })
          : DelegationAuthority.verifyExternal(token, authority.descriptor, {}, now);
        assert.equal(external, false);
      }
    });
    assert.strictEqual(Date.now, originalNow);
  });

  test(`${label}: consumption proof ignores caller-supplied historical time`, (t) => {
    const issuedAt = 1_800_000_000_000;
    t.mock.method(Date, "now", () => issuedAt);
    const { authority, scope } = fixture();
    const token = authority.issue(scope);
    const consumedAt = issuedAt + 100;
    Date.now.mock.mockImplementation(() => consumedAt);
    const claims = authority.verify(token, {}, { consume: true, now: issuedAt });
    assert.equal(authority.authorizationTime(token, claims), consumedAt);

    Date.now.mock.mockImplementation(() => issuedAt - 1);
    const futureToken = authority.issue(scope);
    Date.now.mock.mockImplementation(() => issuedAt - 2);
    assert.throws(() => authority.verify(futureToken, {}, { consume: true, now: issuedAt }), /not currently valid|not yet valid/);
  });

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

  test(`${label}: malformed receipt public keys fail closed after re-signing`, () => {
    const { authority, scope, chain, event, identities } = fixture();
    const token = authority.issue(scope);
    const receipts = [];
    chain.append(receipts, event(token, authority.verifyAndConsume(token)));
    const malformed = resign(receipts[0], identities, {
      workloadIdentity: { ...receipts[0].workloadIdentity, publicKey: "invalid public key" },
    });
    assert.equal(chain.verify([malformed]), false);
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

  test(`${label}: receipt authorization is one-shot across chains and outputs`, () => {
    const { authority, scope, chain, event, identities } = fixture();
    const token = authority.issue(scope);
    const claims = authority.verifyAndConsume(token);
    const validEvent = event(token, claims);
    const first = [];
    chain.append(first, validEvent);
    assert.equal(chain.verify(first), true);
    const otherChain = plugin
      ? new EvidenceReceiptChain({ identities, delegationAuthority: authority })
      : new ReceiptChain({ identities, authority });
    const second = [];
    assert.throws(() => otherChain.append(second, { ...validEvent, output: "another output" }), /consumed/);
    assert.equal(second.length, 0);
    assert.equal(chain.verify(first), true);
  });

  test(`${label}: failed signing leaves receipt authorization available for retry`, (t) => {
    const { authority, scope, chain, event, identities } = fixture();
    const token = authority.issue(scope);
    const claims = authority.verifyAndConsume(token);
    const signing = t.mock.method(identities, "sign", () => { throw new Error("signing unavailable"); });
    const receipts = [];
    assert.throws(() => chain.append(receipts, event(token, claims)), /signing unavailable/);
    assert.equal(receipts.length, 0);
    signing.mock.restore();
    chain.append(receipts, event(token, claims));
    assert.equal(chain.verify(receipts), true);
  });

  test(`${label}: local and external verifiers agree on malformed signed claims`, (t) => {
    const now = 1_800_000_000_000;
    t.mock.method(Date, "now", () => now);
    const { authority, scope, controller } = fixture();
    const original = authority.issue(scope).split(".");
    const baseClaims = JSON.parse(Buffer.from(original[1], "base64url").toString("utf8"));
    const external = (token) => plugin
      ? DelegationCapabilityAuthority.verifyWithAuthority(token, authority.descriptor, {}, { now })
      : DelegationAuthority.verifyExternal(token, authority.descriptor, {}, now);
    assert.ok(external(original.join(".")));
    for (const changes of [
      { iss: "other-controller" }, { issuerKeyId: "other-key" },
      { schema: "wrong-schema" }, { capability: "repository.write" },
      { runId: null }, { memoryId: null }, { hop: 0 }, { targetCardId: "" },
      { inputHash: "invalid" }, { previousReceiptHash: "invalid" },
      { iat: "invalid" }, { exp: "invalid" },
      { iat: new Date(now + 1).toISOString() }, { exp: new Date(now).toISOString() },
    ]) {
      const body = Buffer.from(stableJson({ ...baseClaims, ...changes })).toString("base64url");
      const input = `${original[0]}.${body}`;
      const token = `${input}.${controller.sign(input)}`;
      assert.throws(() => authority.verify(token), undefined, JSON.stringify(changes));
      assert.equal(external(token), false, JSON.stringify(changes));
    }
  });

  test(`${label}: missing memory binding is rejected without spending receipt proof`, () => {
    const { authority, scope, chain, event } = fixture();
    const token = authority.issue(scope);
    const claims = authority.verifyAndConsume(token);
    for (const inputMemoryId of [undefined, null]) {
      const receipts = [];
      assert.throws(() => chain.append(receipts, { ...event(token, claims), inputMemoryId }), /does not authorize/);
      assert.equal(receipts.length, 0);
    }
    const receipts = [];
    chain.append(receipts, event(token, claims));
    assert.equal(chain.verify(receipts), true);
  });

  test(`${label}: backward clock adjustment preserves receipt causal time`, (t) => {
    const consumedAt = 1_800_000_000_000;
    t.mock.method(Date, "now", () => consumedAt);
    const { authority, scope, chain, event } = fixture();
    const token = authority.issue(scope);
    const claims = authority.verifyAndConsume(token);
    Date.now.mock.mockImplementation(() => consumedAt - 2000);
    const receipts = [];
    chain.append(receipts, event(token, claims));
    assert.equal(chain.verify(receipts), true);
    assert.equal(Date.parse(receipts[0].authorizedAt), consumedAt);
    assert.equal(Date.parse(receipts[0].createdAt), consumedAt);
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
    for (const authorizedAt of [claims.exp, new Date(Date.parse(claims.iat) - 1).toISOString(), "invalid", undefined]) {
      const altered = resign(receipts[0], chain.identities, { authorizedAt });
      assert.equal(chain.verify([altered]), false);
    }
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


test("workload registry rejects malformed Ed25519 descriptors without throwing", () => {
  const identities = new Ed25519WorkloadIdentityRegistry();
  const descriptor = identities.ensureCard("mise-maestro");
  assert.equal(identities.verify({
    descriptor: { ...descriptor, publicKey: "invalid" },
    payload: "test", signature: "invalid",
  }), false);
});
