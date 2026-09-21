import test from "node:test";
import assert from "node:assert/strict";
import { createDeveloperBot } from "../../../plugin/mcp/developer-bot-core.mjs";
import { Ed25519WorkloadIdentityRegistry } from "../../../plugin/mcp/workload-identities.mjs";

function offlineClient() {
  let count = 0;
  return {
    async chat() {
      count += 1;
      return {
        text: `bounded offline handoff ${count}`,
        requestedModel: "offline/mock",
        model: "offline/mock",
        usage: null,
        id: `offline_${count}`,
      };
    },
  };
}

test("starter uses distinct Ed25519 workload identities", () => {
  const identities = new Ed25519WorkloadIdentityRegistry({ instanceId: "starter-test" });
  const maestro = identities.ensureCard("mise-maestro");
  const garde = identities.ensureCard("mise-garde");
  assert.notEqual(maestro.keyId, garde.keyId);
});

test("starter runs the default bounded team with a valid receipt chain", async () => {
  const bot = createDeveloperBot({ client: offlineClient() });
  const result = await bot.runTeam({ prompt: "Review a secure MCP mutation path" });

  assert.deepEqual(result.team, [
    "mise-maestro",
    "mise-garde",
    "mise-apprentice",
    "mise-sommelier",
  ]);
  assert.equal(result.stages.length, 4);
  assert.equal(result.receipts.length, 4);
  assert.equal(result.receiptChainValid, true);
  assert.equal(result.authority, "advisory");
  assert.equal(result.writeAuthority, "none");
  assert.equal(result.memoryRetention, "ephemeral-purged-after-run");
  assert.equal(new Set(result.stages.map((stage) => stage.workloadKeyId)).size, 4);
});
