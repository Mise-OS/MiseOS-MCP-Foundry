import test from "node:test";
import assert from "node:assert/strict";

import { EphemeralCardMemoryStore, CardMemoryPolicyError } from "../mcp/card-memory.mjs";
import { createDeveloperBot } from "../mcp/developer-bot-core.mjs";

function fakeClient(observed = []) {
  let counter = 0;
  return {
    async chat({ messages }) {
      observed.push(messages);
      counter += 1;
      const system = messages[0]?.content ?? "";
      const card = /You are ([^,]+)/.exec(system)?.[1] ?? `Card ${counter}`;
      return {
        text: `${card} handoff ${counter}: bounded result`,
        requestedModel: "openrouter/free",
        model: "example/model:free",
        usage: null,
        id: `gen_${counter}`,
      };
    },
  };
}

test("card memory is one-hop scoped and purgable", () => {
  const memory = new EphemeralCardMemoryStore({ ttlMs: 60_000 });
  const ref = memory.put({
    runId: "run_1",
    ownerCardId: "mise-maestro",
    content: "bounded architecture handoff",
    shareWith: ["mise-garde"],
  });
  assert.equal(memory.read({ runId: "run_1", requesterCardId: "mise-maestro", memoryId: ref.id }).content, "bounded architecture handoff");
  assert.equal(memory.read({ runId: "run_1", requesterCardId: "mise-garde", memoryId: ref.id }).content, "bounded architecture handoff");
  assert.throws(
    () => memory.read({ runId: "run_1", requesterCardId: "mise-apprentice", memoryId: ref.id }),
    CardMemoryPolicyError,
  );
  assert.equal(memory.purgeRun("run_1"), 1);
  assert.equal(memory.size(), 0);
});

test("card memory rejects secret-like material before a handoff", () => {
  const memory = new EphemeralCardMemoryStore();
  assert.throws(
    () => memory.put({
      runId: "run_secret",
      ownerCardId: "mise-maestro",
      content: "OPENROUTER_API_KEY=sk-super-secret-example-123456",
      shareWith: ["mise-garde"],
    }),
    /secret-like material/,
  );
});

test("default card team uses cryptographic one-hop delegation and purges ephemeral memory", async () => {
  const memory = new EphemeralCardMemoryStore();
  const observed = [];
  const bot = createDeveloperBot({ client: fakeClient(observed), teamOptions: { memory } });
  const result = await bot.runTeam({
    prompt: "Harden the MCP mutation path",
    context: { invariant: "model output never grants authority" },
  });

  assert.equal(result.schema, "miseos.card-team.run.v2");
  assert.deepEqual(result.team, ["mise-maestro", "mise-garde", "mise-apprentice", "mise-sommelier"]);
  assert.equal(result.identityModel, "Ed25519 workload identities");
  assert.equal(result.delegationModel, "one-hop controller-signed capability tokens");
  assert.equal(result.stages.length, 4);
  assert.equal(result.receipts.length, 4);
  assert.equal(result.receiptChainValid, true);
  assert.equal(result.authority, "advisory");
  assert.equal(result.writeAuthority, "none");
  assert.equal(result.memoryRetention, "ephemeral-purged-after-run");
  assert.equal(memory.size(), 0);
  assert.deepEqual(result.stages.map((stage) => stage.delegatedTo), ["mise-garde", "mise-apprentice", "mise-sommelier", "human-pass"]);
  assert.equal(new Set(result.workloadIdentities.map((identity) => identity.keyId)).size, 4);
  assert.ok(result.receipts.every((receipt) => receipt.signatureAlgorithm === "Ed25519"));
  assert.ok(result.receipts.every((receipt) => receipt.capabilityToken && receipt.capabilityTokenHash));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY/);

  const modelView = JSON.stringify(observed);
  assert.doesNotMatch(modelView, /MISEOS-DELEGATION/);
  assert.doesNotMatch(modelView, /workload:\/\/miseos/);
  assert.doesNotMatch(modelView, /cap_[0-9a-f-]{8,}/i);
});

test("cyclic or duplicate card teams fail closed", async () => {
  const bot = createDeveloperBot({ client: fakeClient() });
  await assert.rejects(
    () => bot.runTeam({ prompt: "test", team: ["mise-maestro", "mise-garde", "mise-maestro"] }),
    /duplicate cards/,
  );
});
