import { createDeveloperBot } from "../../../plugin/mcp/developer-bot-core.mjs";

function offlineClient() {
  let count = 0;
  return {
    async chat({ messages }) {
      count += 1;
      const system = messages[0]?.content ?? "";
      const card = /You are ([^,]+)/.exec(system)?.[1] ?? `MiseOS Card ${count}`;
      return {
        text: `${card} offline handoff ${count}: bounded result. No external model was called.`,
        requestedModel: "offline/mock",
        model: "offline/mock",
        usage: null,
        id: `offline_${count}`,
      };
    },
  };
}

const bot = createDeveloperBot({ client: offlineClient() });
const result = await bot.runTeam({
  prompt: "Harden a developer bot so model compromise does not imply repository write authority.",
  context: { invariant: "team consensus does not grant write authority" },
});

console.log(JSON.stringify({
  runId: result.runId,
  team: result.team,
  receiptChainValid: result.receiptChainValid,
  authority: result.authority,
  writeAuthority: result.writeAuthority,
  stages: result.stages.map((stage) => ({
    hop: stage.hop,
    cardId: stage.cardId,
    delegatedTo: stage.delegatedTo,
    workloadKeyId: stage.workloadKeyId,
    capabilityJti: stage.capabilityJti,
    receiptHash: stage.receiptHash,
  })),
}, null, 2));
