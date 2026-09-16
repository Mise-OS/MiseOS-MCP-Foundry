import { keyIdForPublicKey, sha256, stableJson, verifyEd25519 } from "./workload-identities.mjs";
import { DelegationCapabilityAuthority, hashCapabilityToken } from "./delegation-capabilities.mjs";

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : stableJson(value), "utf8");
}

export class EvidenceReceiptChain {
  constructor({ identities, delegationAuthority } = {}) {
    if (!identities?.ensureCard || !identities?.sign) {
      throw new Error("EvidenceReceiptChain requires an Ed25519 workload identity registry.");
    }
    if (!delegationAuthority?.descriptor) {
      throw new Error("EvidenceReceiptChain requires a delegation capability authority.");
    }
    this.identities = identities;
    this.delegationAuthority = delegationAuthority;
  }

  append(receipts, event) {
    if (!event.authorization?.token || !event.authorization?.claims) {
      throw new Error("A verified delegation capability is required before a receipt can be emitted.");
    }
    const previousReceiptHash = receipts.at(-1)?.receiptHash ?? "0".repeat(64);
    const workloadIdentity = this.identities.ensureCard(event.fromCardId);
    const claims = event.authorization.claims;
    const body = {
      schema: "miseos.card-handoff.receipt.v2",
      sequence: receipts.length + 1,
      runId: event.runId,
      fromCardId: event.fromCardId,
      toCardId: event.toCardId,
      toWorkloadId: event.toWorkloadId ?? null,
      toWorkloadKeyId: event.toWorkloadKeyId ?? null,
      inputMemoryId: event.inputMemoryId ?? null,
      outputMemoryId: event.outputMemoryId ?? null,
      requestedModel: event.requestedModel ?? null,
      servedModel: event.servedModel ?? null,
      inputHash: sha256(event.input),
      outputHash: sha256(event.output),
      inputBytes: byteLength(event.input),
      outputBytes: byteLength(event.output),
      previousReceiptHash,
      workloadIdentity: { ...workloadIdentity },
      capabilityToken: event.authorization.token,
      capabilityTokenHash: hashCapabilityToken(event.authorization.token),
      capabilityJti: claims.jti,
      capabilityIssuerKeyId: claims.issuerKeyId,
      authority: "advisory",
      writeAuthority: "none",
      createdAt: new Date().toISOString(),
    };
    const receiptHash = sha256(body);
    const signature = this.identities.sign({ workloadId: workloadIdentity.workloadId, payload: receiptHash });
    const receipt = Object.freeze({ ...body, receiptHash, signatureAlgorithm: "Ed25519", signature });
    receipts.push(receipt);
    return receipt;
  }

  verify(receipts, { authorityDescriptor = this.delegationAuthority.descriptor } = {}) {
    let previousReceiptHash = "0".repeat(64);
    for (let index = 0; index < receipts.length; index += 1) {
      const receipt = receipts[index];
      if (receipt.sequence !== index + 1 || receipt.previousReceiptHash !== previousReceiptHash) return false;
      if (receipt.schema !== "miseos.card-handoff.receipt.v2") return false;
      const { receiptHash, signature, signatureAlgorithm, ...body } = receipt;
      if (sha256(body) !== receiptHash || signatureAlgorithm !== "Ed25519" || !signature) return false;

      const identity = receipt.workloadIdentity;
      if (!identity || identity.cardId !== receipt.fromCardId || identity.algorithm !== "Ed25519") return false;
      if (keyIdForPublicKey(identity.publicKey) !== identity.keyId) return false;
      if (!verifyEd25519({ publicKey: identity.publicKey, payload: receiptHash, signature })) return false;
      if (hashCapabilityToken(receipt.capabilityToken) !== receipt.capabilityTokenHash) return false;

      const claims = DelegationCapabilityAuthority.verifyWithAuthority(
        receipt.capabilityToken,
        authorityDescriptor,
        {
          sub: identity.workloadId,
          subjectKeyId: identity.keyId,
          subjectCardId: receipt.fromCardId,
          aud: receipt.toWorkloadId ?? "human-pass",
          targetCardId: receipt.toCardId,
          targetKeyId: receipt.toWorkloadKeyId ?? null,
          runId: receipt.runId,
          hop: receipt.sequence,
          memoryId: receipt.inputMemoryId,
          inputHash: receipt.inputHash,
          previousReceiptHash: receipt.previousReceiptHash,
        },
        { now: Date.parse(receipt.createdAt) },
      );
      if (!claims) return false;
      if (claims.jti !== receipt.capabilityJti || claims.issuerKeyId !== receipt.capabilityIssuerKeyId) return false;
      previousReceiptHash = receiptHash;
    }
    return true;
  }
}
