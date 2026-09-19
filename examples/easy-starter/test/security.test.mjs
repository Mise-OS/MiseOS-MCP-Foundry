import test from "node:test";
import assert from "node:assert/strict";
import {
  CardTeam,
  ControllerIdentity,
  DelegationAuthority,
  MemoryStore,
  OfflineClient,
  WorkloadRegistry,
  sha256,
  stableJson,
  verifyEd25519,
} from "../src/miseos.mjs";

function b64json(value) {
  return Buffer.from(stableJson(value), "utf8").toString("base64url");
}

function signToken(controller, claims) {
  const header = {
    alg: "EdDSA",
    typ: "MISEOS-DELEGATION",
    kid: controller.descriptor.keyId,
  };
  const input = `${b64json(header)}.${b64json(claims)}`;
  return `${input}.${controller.sign(input)}`;
}

test("separate Ed25519 workload keys", () => {
  const ids = new WorkloadRegistry({ instanceId: "test" });
  const maestro = ids.ensureCard("mise-maestro");
  const garde = ids.ensureCard("mise-garde");
  assert.notEqual(maestro.keyId, garde.keyId);

  const sig = ids.sign({ workloadId: maestro.workloadId, payload: "x" });
  assert.equal(verifyEd25519({ publicKey: maestro.publicKey, payload: "x", signature: sig }), true);
  assert.equal(verifyEd25519({ publicKey: garde.publicKey, payload: "x", signature: sig }), false);
});

test("delegation is destination-bound and one-use", () => {
  const ids = new WorkloadRegistry({ instanceId: "test" });
  const authority = new DelegationAuthority({
    controller: new ControllerIdentity({ instanceId: "controller-test" }),
  });

  const subject = ids.ensureCard("mise-maestro");
  const target = ids.ensureCard("mise-garde");
  const expected = {
    sub: subject.workloadId,
    subjectKeyId: subject.keyId,
    subjectCardId: subject.cardId,
    aud: target.workloadId,
    targetCardId: target.cardId,
    targetKeyId: target.keyId,
    runId: "run_1",
    hop: 1,
    memoryId: "mem_1",
    inputHash: sha256("input"),
    previousReceiptHash: "0".repeat(64),
  };

  const token = authority.issue({
    subject,
    target,
    targetCardId: target.cardId,
    runId: expected.runId,
    hop: expected.hop,
    memoryId: expected.memoryId,
    inputHash: expected.inputHash,
    previousReceiptHash: expected.previousReceiptHash,
  });

  const claims = authority.verifyAndConsume(token, expected);
  assert.match(claims.jti, /^cap_/);
  assert.throws(() => authority.verifyAndConsume(token, expected), /already consumed/);
  assert.throws(
    () => authority.verify(token, { ...expected, targetKeyId: subject.keyId }),
    /targetKeyId mismatch/,
  );
});

test("external verification rejects wrong delegation schema and capability", () => {
  const controller = new ControllerIdentity({ instanceId: "controller-external-test" });
  const now = Date.now();
  const base = {
    schema: "miseos.delegation-capability.v1",
    jti: "cap_test",
    iss: controller.descriptor.workloadId,
    issuerKeyId: controller.descriptor.keyId,
    sub: "workload://miseos/card/mise-maestro/test",
    subjectKeyId: "ed25519:test-subject",
    subjectCardId: "mise-maestro",
    aud: "human-pass",
    targetCardId: "human-pass",
    targetKeyId: null,
    capability: "card.process-and-handoff",
    runId: "run_external",
    hop: 1,
    memoryId: "mem_external",
    inputHash: sha256("input"),
    previousReceiptHash: "0".repeat(64),
    iat: new Date(now - 1_000).toISOString(),
    exp: new Date(now + 60_000).toISOString(),
  };

  assert.equal(
    DelegationAuthority.verifyExternal(
      signToken(controller, { ...base, schema: "wrong.schema" }),
      controller.descriptor,
      {},
      now,
    ),
    false,
  );
  assert.equal(
    DelegationAuthority.verifyExternal(
      signToken(controller, { ...base, capability: "repository.write" }),
      controller.descriptor,
      {},
      now,
    ),
    false,
  );
});

test("external verification rejects malformed temporal claims", () => {
  const controller = new ControllerIdentity({ instanceId: "controller-time-test" });
  const claims = {
    schema: "miseos.delegation-capability.v1",
    jti: "cap_time",
    iss: controller.descriptor.workloadId,
    issuerKeyId: controller.descriptor.keyId,
    sub: "workload://miseos/card/mise-maestro/test",
    subjectKeyId: "ed25519:test-subject",
    subjectCardId: "mise-maestro",
    aud: "human-pass",
    targetCardId: "human-pass",
    targetKeyId: null,
    capability: "card.process-and-handoff",
    runId: "run_time",
    hop: 1,
    memoryId: "mem_time",
    inputHash: sha256("input"),
    previousReceiptHash: "0".repeat(64),
    iat: "not-a-date",
    exp: "also-not-a-date",
  };

  assert.equal(
    DelegationAuthority.verifyExternal(
      signToken(controller, claims),
      controller.descriptor,
      {},
      Date.now(),
    ),
    false,
  );
});

test("memory is run- and card-scoped", () => {
  const memory = new MemoryStore();
  const ref = memory.put({
    runId: "run_1",
    ownerCardId: "mise-maestro",
    content: "bounded handoff",
    shareWith: ["mise-garde"],
  });

  assert.equal(
    memory.read({ runId: "run_1", requesterCardId: "mise-garde", memoryId: ref.id }).content,
    "bounded handoff",
  );
  assert.throws(
    () => memory.read({ runId: "run_1", requesterCardId: "mise-apprentice", memoryId: ref.id }),
    /cannot read/,
  );
  assert.throws(
    () => memory.read({ runId: "run_2", requesterCardId: "mise-garde", memoryId: ref.id }),
    /wrong run/,
  );
});

test("default team produces valid receipt chain", async () => {
  const team = new CardTeam({ client: new OfflineClient() });
  const result = await team.run({
    prompt: "Review a secure MCP mutation path",
  });

  assert.equal(result.stages.length, 4);
  assert.equal(result.receipts.length, 4);
  assert.equal(result.receiptChainValid, true);
  assert.equal(result.authority, "advisory");
  assert.equal(result.writeAuthority, "none");

  const tampered = result.receipts.map((receipt, index) =>
    index === 1 ? { ...receipt, outputHash: "f".repeat(64) } : receipt,
  );
  assert.equal(team.receipts.verify(tampered), false);
});

test("empty teams and secret-like task material are rejected", async () => {
  const team = new CardTeam({ client: new OfflineClient() });
  await assert.rejects(
    team.run({ prompt: "do work", team: [] }),
    /At least one card is required/,
  );
  await assert.rejects(
    team.run({ prompt: "OPENROUTER_API_KEY=should-not-enter-model-context" }),
    /secret-like material/,
  );
});
