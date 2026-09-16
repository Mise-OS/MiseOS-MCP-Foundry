import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export class EvidenceReceiptChain {
  constructor({ signingKey = process.env.MISEOS_RECEIPT_HMAC_KEY || null } = {}) {
    this.signingKey = signingKey;
  }

  append(receipts, event) {
    const previousReceiptHash = receipts.at(-1)?.receiptHash ?? "0".repeat(64);
    const body = {
      schema: "miseos.card-handoff.receipt.v1",
      sequence: receipts.length + 1,
      runId: event.runId,
      fromCardId: event.fromCardId,
      toCardId: event.toCardId,
      memoryId: event.memoryId ?? null,
      requestedModel: event.requestedModel ?? null,
      servedModel: event.servedModel ?? null,
      inputHash: sha256(event.input),
      outputHash: sha256(event.output),
      inputBytes: Buffer.byteLength(typeof event.input === "string" ? event.input : stableJson(event.input), "utf8"),
      outputBytes: Buffer.byteLength(typeof event.output === "string" ? event.output : stableJson(event.output), "utf8"),
      previousReceiptHash,
      authority: "advisory",
      writeAuthority: "none",
      createdAt: new Date().toISOString(),
    };
    const receiptHash = sha256(body);
    const signature = this.signingKey
      ? createHmac("sha256", this.signingKey).update(receiptHash).digest("hex")
      : null;
    const receipt = Object.freeze({
      ...body,
      receiptHash,
      signatureAlgorithm: signature ? "HMAC-SHA256" : null,
      signature,
    });
    receipts.push(receipt);
    return receipt;
  }

  verify(receipts) {
    let previousReceiptHash = "0".repeat(64);
    for (let index = 0; index < receipts.length; index += 1) {
      const receipt = receipts[index];
      if (receipt.sequence !== index + 1 || receipt.previousReceiptHash !== previousReceiptHash) return false;
      const { receiptHash, signature, signatureAlgorithm, ...body } = receipt;
      if (sha256(body) !== receiptHash) return false;
      if (this.signingKey) {
        if (signatureAlgorithm !== "HMAC-SHA256" || !signature) return false;
        const expected = createHmac("sha256", this.signingKey).update(receiptHash).digest("hex");
        const actualBytes = Buffer.from(signature, "hex");
        const expectedBytes = Buffer.from(expected, "hex");
        if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
      } else if (signature !== null || signatureAlgorithm !== null) {
        return false;
      }
      previousReceiptHash = receiptHash;
    }
    return true;
  }
}
