import test from "node:test";
import assert from "node:assert/strict";

import {
  Ed25519WorkloadIdentityRegistry,
  Ed25519ControllerIdentity,
  sha256,
  verifyEd25519,
} from "../mcp/workload-identities.mjs";
import {
  DelegationCapabilityAuthority,
  DelegationCapabilityError,
  hashCapabilityToken,
} from "../mcp/delegation-capabilities.mjs";
import { EvidenceReceiptChain } from "../mcp/evidence-receipts.mjs";

test("workload identities sign with separate Ed25519 card keys without exposing private material", () => {
  const identities = new Ed25519WorkloadIdentityRegistry({ instanceId: "test" });
  const maestro = identities.ensureCard("mise-maestro");
  const garde = identities.ensureCard("mise-garde");
  assert.notEqual(maestro.keyId, garde.keyId);
  assert.doesNotMatch(JSON.stringify(maestro), /PRIVATE KEY/);
  const signature = identities.sign({ workloadId: maestro.workloadId, payload: "receipt-hash" });
  assert.equal(verifyEd25519({ publicKey: maestro.publicKey, payload: "receipt-hash", signature }), true);
  assert.equal(verifyEd25519({ publicKey: garde.publicKey, payload: "receipt-hash", signature }), false);
});

test("delegation capability is exact-scope, one-use, controller signed, and destination-workload bound", () => {
  const identities = new Ed25519WorkloadIdentityRegistry({ instanceId: "test" });
  const authority = new DelegationCapabilityAuthority({
    controller: new Ed25519ControllerIdentity({ instanceId: "controller-test" }),
    defaultTtlMs: 10_000,
  });
  const subject = identities.ensureCard("mise-maestro");
  const target = identities.ensureCard("mise-garde");
  const token = authority.issue({
    subjectIdentity: subject,
    targetIdentity: target,
    targetCardId: "mise-garde",
    runId: "team_1",
    hop: 1,
    memoryId: "mem_1",
    inputHash: "a".repeat(64),
    previousReceiptHash: "0".repeat(64),
  });
  const expected = {
    sub: subject.workloadId,
    subjectKeyId: subject.keyId,
    subjectCardId: "mise-maestro",
    aud: target.workloadId,
    targetCardId: "mise-garde",
    targetKeyId: target.keyId,
    runId: "team_1",
    hop: 1,
    memoryId: "mem_1",
    inputHash: "a".repeat(64),
    previousReceiptHash: "0".repeat(64),
  };
  const claims = authority.verifyAndConsume(token, expected);
  assert.match(claims.jti, /^cap_/);
  assert.throws(() => authority.verifyAndConsume(token, expected), /already been consumed/);
  assert.throws(() => authority.verify(token, { ...expected, targetKeyId: subject.keyId }), /targetKeyId mismatch/);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => authority.verify(tampered, expected), DelegationCapabilityError);
});

test("Ed25519 receipt binds signer identity, destination identity, and delegation token", () => {
  const identities = new Ed25519WorkloadIdentityRegistry({ instanceId: "test" });
  const authority = new DelegationCapabilityAuthority({ defaultTtlMs: 10_000 });
  const chain = new EvidenceReceiptChain({ identities, delegationAuthority: authority });
  const subject = identities.ensureCard("mise-maestro");
  const target = identities.ensureCard("mise-garde");
  const input = "task capsule";
  const token = authority.issue({
    subjectIdentity: subject,
    targetIdentity: target,
    targetCardId: "mise-garde",
    runId: "team_1",
    hop: 1,
    memoryId: "mem_1",
    inputHash: sha256(input),
    previousReceiptHash: "0".repeat(64),
  });
  const claims = authority.verifyAndConsume(token, {
    sub: subject.workloadId,
    subjectKeyId: subject.keyId,
    subjectCardId: "mise-maestro",
    aud: target.workloadId,
    targetCardId: "mise-garde",
    targetKeyId: target.keyId,
    runId: "team_1",
    hop: 1,
    memoryId: "mem_1",
    inputHash: sha256(input),
    previousReceiptHash: "0".repeat(64),
  });
  const receipts = [];
  chain.append(receipts, {
    runId: "team_1",
    fromCardId: "mise-maestro",
    toCardId: "mise-garde",
    toWorkloadId: target.workloadId,
    toWorkloadKeyId: target.keyId,
    inputMemoryId: "mem_1",
    outputMemoryId: "mem_2",
    input,
    output: "architecture handoff",
    requestedModel: "openrouter/free",
    servedModel: "example/model:free",
    authorization: { token, claims },
  });
  assert.equal(chain.verify(receipts), true);
  assert.equal(receipts[0].signatureAlgorithm, "Ed25519");
  assert.equal(receipts[0].workloadIdentity.keyId, subject.keyId);
  assert.equal(receipts[0].capabilityTokenHash, hashCapabilityToken(token));
  assert.equal(chain.verify([{ ...receipts[0], toCardId: "mise-apprentice" }]), false);
});
