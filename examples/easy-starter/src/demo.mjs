import { CardTeam, OfflineClient } from "./miseos.mjs";

const result = await new CardTeam({ client: new OfflineClient() }).run({
  prompt: "Harden a developer bot so model compromise does not imply repository write authority.",
  context: { invariant: "team consensus does not grant write authority" },
});

console.log(JSON.stringify({
  runId: result.runId,
  team: result.team,
  receiptChainValid: result.receiptChainValid,
  authority: result.authority,
  writeAuthority: result.writeAuthority,
  stages: result.stages.map((s) => ({
    hop: s.hop,
    card: s.card,
    delegatedTo: s.delegatedTo,
    workloadKeyId: s.workloadKeyId,
    capabilityJti: s.capabilityJti,
    receiptHash: s.receiptHash,
  })),
}, null, 2));
