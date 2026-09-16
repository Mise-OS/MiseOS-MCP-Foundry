import { randomUUID } from "node:crypto";
import { getCharacterCard } from "./character-cards.mjs";
import { EphemeralCardMemoryStore, assertNoSecretLikeMaterial } from "./card-memory.mjs";
import { DelegationCapabilityAuthority, hashCapabilityToken } from "./delegation-capabilities.mjs";
import { EvidenceReceiptChain } from "./evidence-receipts.mjs";
import { Ed25519WorkloadIdentityRegistry, sha256 } from "./workload-identities.mjs";

export const DEFAULT_CARD_TEAM = Object.freeze([
  "mise-maestro",
  "mise-garde",
  "mise-apprentice",
  "mise-sommelier",
]);

const STAGE_INSTRUCTIONS = Object.freeze({
  "mise-maestro": "Architect the task. State invariants, dependency order, assumptions, and a concise handoff that a reviewer can challenge.",
  "mise-garde": "Review the upstream handoff adversarially. Identify concrete correctness, security, and boundary failures. Return only actionable findings and required gates.",
  "mise-apprentice": "Turn the reviewed findings into executable regression tests and the smallest implementation plan that would satisfy them. State what each test proves and does not prove.",
  "mise-sommelier": "Audit the chain of claims, tests, and proposed changes. Produce a final traceable recommendation with evidence gaps and the exact next human-approved action.",
});

function normalizeTeam(team, maxHops) {
  if (!Array.isArray(team) || team.length < 2) throw new Error("Card team must contain at least two cards.");
  if (team.length > maxHops) throw new Error(`Card team exceeds maxHops=${maxHops}.`);
  const normalized = team.map((id) => getCharacterCard(id).id);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Card team cannot contain duplicate cards; cyclic delegation is denied.");
  }
  return normalized;
}

function initialCapsule({ prompt, context }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Team prompt is required.");
  return assertNoSecretLikeMaterial(
    JSON.stringify({
      task: prompt.trim(),
      context: context ?? null,
      authority: "advisory",
      writeAuthority: "none",
      boundary: "This capsule belongs to the first card only. Downstream cards receive only one-hop handoffs.",
    }),
    "initial team capsule",
  );
}

export class CardTeamOrchestrator {
  constructor({
    bot,
    memory = new EphemeralCardMemoryStore(),
    identities = new Ed25519WorkloadIdentityRegistry(),
    delegationAuthority = new DelegationCapabilityAuthority(),
    receipts = new EvidenceReceiptChain({ identities, delegationAuthority }),
    maxHops = 6,
  } = {}) {
    if (!bot?.chat) throw new Error("CardTeamOrchestrator requires a developer bot with chat().");
    this.bot = bot;
    this.memory = memory;
    this.identities = identities;
    this.delegationAuthority = delegationAuthority;
    this.receipts = receipts;
    this.maxHops = maxHops;
  }

  async run({ prompt, context = null, team = DEFAULT_CARD_TEAM, model } = {}) {
    const cards = normalizeTeam(team, this.maxHops);
    const runId = `team_${randomUUID()}`;
    const evidence = [];
    const stages = [];
    cards.forEach((cardId) => this.identities.ensureCard(cardId));

    let memoryRef = this.memory.put({
      runId,
      ownerCardId: cards[0],
      content: initialCapsule({ prompt, context }),
      shareWith: [],
    });

    try {
      for (let hop = 0; hop < cards.length; hop += 1) {
        const cardId = cards[hop];
        const nextCardId = cards[hop + 1] ?? null;
        const targetCardId = nextCardId ?? "human-pass";
        const targetIdentity = nextCardId ? this.identities.ensureCard(nextCardId) : null;
        const readable = this.memory.read({ runId, requesterCardId: cardId, memoryId: memoryRef.id });
        const workloadIdentity = this.identities.ensureCard(cardId);
        const previousReceiptHash = evidence.at(-1)?.receiptHash ?? "0".repeat(64);
        const inputHash = sha256(readable.content);

        const capabilityToken = this.delegationAuthority.issue({
          subjectIdentity: workloadIdentity,
          targetIdentity,
          targetCardId,
          runId,
          hop: hop + 1,
          memoryId: readable.id,
          inputHash,
          previousReceiptHash,
        });
        const capabilityClaims = this.delegationAuthority.verifyAndConsume(capabilityToken, {
          sub: workloadIdentity.workloadId,
          subjectKeyId: workloadIdentity.keyId,
          subjectCardId: cardId,
          aud: targetIdentity?.workloadId ?? "human-pass",
          targetCardId,
          targetKeyId: targetIdentity?.keyId ?? null,
          runId,
          hop: hop + 1,
          memoryId: readable.id,
          inputHash,
          previousReceiptHash,
        });

        const instruction = STAGE_INSTRUCTIONS[cardId]
          ?? "Process only the authorized one-hop handoff. Produce the minimum bounded output required for the next card.";
        const result = await this.bot.chat({
          cardId,
          prompt: instruction,
          context: {
            teamRunId: runId,
            hop: hop + 1,
            totalHops: cards.length,
            authorizedMemory: {
              id: readable.id,
              ownerCardId: readable.ownerCardId,
              content: readable.content,
            },
            boundary:
              "Do not infer or request hidden team context. Use only this authorized memory object. Cryptographic delegation metadata stays outside model context.",
          },
          model,
        });

        const safeOutput = assertNoSecretLikeMaterial(result.answer, `${cardId} handoff`);
        let nextMemoryRef = null;
        if (nextCardId) {
          nextMemoryRef = this.memory.put({
            runId,
            ownerCardId: cardId,
            content: safeOutput,
            shareWith: [nextCardId],
          });
        }

        const receipt = this.receipts.append(evidence, {
          runId,
          fromCardId: cardId,
          toCardId: targetCardId,
          toWorkloadId: targetIdentity?.workloadId ?? null,
          toWorkloadKeyId: targetIdentity?.keyId ?? null,
          inputMemoryId: readable.id,
          outputMemoryId: nextMemoryRef?.id ?? null,
          requestedModel: result.requestedModel,
          servedModel: result.servedModel,
          input: readable.content,
          output: safeOutput,
          authorization: { token: capabilityToken, claims: capabilityClaims },
        });

        stages.push({
          hop: hop + 1,
          cardId,
          delegatedTo: targetCardId,
          answer: safeOutput,
          inputMemoryId: readable.id,
          outputMemoryId: nextMemoryRef?.id ?? null,
          workloadId: workloadIdentity.workloadId,
          workloadKeyId: workloadIdentity.keyId,
          capabilityJti: capabilityClaims.jti,
          capabilityTokenHash: hashCapabilityToken(capabilityToken),
          receiptHash: receipt.receiptHash,
          authority: "advisory",
          writeAuthority: "none",
        });

        if (nextMemoryRef) memoryRef = nextMemoryRef;
      }

      return {
        schema: "miseos.card-team.run.v2",
        runId,
        team: cards,
        identityModel: "Ed25519 workload identities",
        delegationModel: "one-hop controller-signed capability tokens",
        delegationAuthority: this.delegationAuthority.descriptor,
        workloadIdentities: this.identities.publicBundle(cards),
        stages,
        finalAnswer: stages.at(-1)?.answer ?? "",
        receipts: evidence,
        receiptChainValid: this.receipts.verify(evidence),
        memoryRetention: "ephemeral-purged-after-run",
        authority: "advisory",
        writeAuthority: "none",
        nextAction:
          "If the final recommendation proposes a mutation, submit that proposal to the existing MiseOS capability gateway. Cryptographic team delegation does not grant repository write authority.",
      };
    } finally {
      this.memory.purgeRun(runId);
    }
  }
}
