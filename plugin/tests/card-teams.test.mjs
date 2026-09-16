import test from "node:test";
import assert from "node:assert/strict";

import { EphemeralCardMemoryStore, CardMemoryPolicyError } from "../mcp/card-memory.mjs";
import { EvidenceReceiptChain } from "../mcp/evidence-receipts.mjs";
import { createDeveloperBot } from "../mcp/developer-bot-core.mjs";

function fakeClient() {
  let counter = 0;
  return {
    async chat({ messages }) {
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

test("evidence receipts are hash chained and HMAC-verifiable", () => {
  const chain = new EvidenceReceiptChain({ signingKey: "test-signing-key-32-bytes-minimum" });
  const receipts = [];
  chain.append(receipts, {
    runId: "team_1",
    fromCardId: "mise-maestro",
    toCardId: "mise-garde",
    memoryId: "mem_1",
    requestedModel: "openrouter/free",
    servedModel: "example/model:free",
    input: "task capsule",
    output: "architecture handoff",
  });
  chain.append(receipts, {
    runId: "team_1",
    fromCardId: "mise-garde",
    toCardId: "mise-apprentice",
    memoryId: "mem_2",
    requestedModel: "openrouter/free",
    servedModel: "example/model:free",
    input: "architecture handoff",
    output: "review handoff",
  });

  assert.equal(chain.verify(receipts), true);
  assert.equal(receipts[1].previousReceiptHash, receipts[0].receiptHash);
  const tampered = receipts.map((item) => ({ ...item }));
  tampered[0].outputBytes += 1;
  assert.equal(chain.verify(tampered), false);
});

test("default card team isolates context per hop and purges ephemeral memory", async () => {
  const memory = new EphemeralCardMemoryStore();
  const bot = createDeveloperBot({
    client: fakeClient(),
    teamOptions: {
      memory,
      receipts: new EvidenceReceiptChain({ signingKey: "team-test-signing-key" }),
    },
  });

  const result = await bot.runTeam({
    prompt: "Harden the MCP mutation path",
    context: { invariant: "model output never grants authority" },
  });

  assert.deepEqual(result.team, ["mise-maestro", "mise-garde", "mise-apprentice", "mise-sommelier"]);
  assert.equal(result.stages.length, 4);
  assert.equal(result.receipts.length, 4);
  assert.equal(result.receiptChainValid, true);
  assert.equal(result.authority, "advisory");
  assert.equal(result.writeAuthority, "none");
  assert.equal(result.memoryRetention, "ephemeral-purged-after-run");
  assert.equal(memory.size(), 0);
  assert.equal(result.stages[0].delegatedTo, "mise-garde");
  assert.equal(result.stages[1].delegatedTo, "mise-apprentice");
  assert.equal(result.stages[2].delegatedTo, "mise-sommelier");
  assert.equal(result.stages[3].delegatedTo, "human-pass");
});

test("cyclic or duplicate card teams fail closed", async () => {
  const bot = createDeveloperBot({ client: fakeClient() });
  await assert.rejects(
    () => bot.runTeam({
      prompt: "test",
      team: ["mise-maestro", "mise-garde", "mise-maestro"],
    }),
    /duplicate cards/,
  );
});
