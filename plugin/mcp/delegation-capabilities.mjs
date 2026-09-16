import { randomUUID } from "node:crypto";
import {
  Ed25519ControllerIdentity,
  keyIdForPublicKey,
  sha256,
  stableJson,
  verifyEd25519,
} from "./workload-identities.mjs";

const TOKEN_SCHEMA = "miseos.delegation-capability.v1";
const TOKEN_TYPE = "MISEOS-DELEGATION";
const CAPABILITY = "card.process-and-handoff";

function b64urlJson(value) {
  return Buffer.from(stableJson(value), "utf8").toString("base64url");
}

function parseSegment(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

export function hashCapabilityToken(token) {
  return sha256(String(token));
}

export class DelegationCapabilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "DelegationCapabilityError";
  }
}

export class DelegationCapabilityAuthority {
  #controller;
  #consumed = new Set();
  #defaultTtlMs;

  constructor({ controller = new Ed25519ControllerIdentity(), defaultTtlMs = 60_000 } = {}) {
    this.#controller = controller;
    this.#defaultTtlMs = Math.max(1_000, Math.min(10 * 60_000, Number(defaultTtlMs) || 60_000));
  }

  get descriptor() {
    return { ...this.#controller.descriptor };
  }

  issue({
    subjectIdentity,
    targetIdentity = null,
    targetCardId,
    runId,
    hop,
    memoryId,
    inputHash,
    previousReceiptHash,
    ttlMs = this.#defaultTtlMs,
  }) {
    if (!subjectIdentity?.workloadId || !subjectIdentity?.keyId || !subjectIdentity?.cardId) {
      throw new DelegationCapabilityError("A card workload identity is required to mint a delegation capability.");
    }
    if (targetIdentity && (!targetIdentity.workloadId || !targetIdentity.keyId || !targetIdentity.cardId)) {
      throw new DelegationCapabilityError("Target workload identity is incomplete.");
    }
    if (targetIdentity && targetCardId !== targetIdentity.cardId) {
      throw new DelegationCapabilityError("Target card does not match target workload identity.");
    }
    const now = Date.now();
    const lifetime = Math.max(1_000, Math.min(this.#defaultTtlMs, Number(ttlMs) || this.#defaultTtlMs));
    const header = { alg: "EdDSA", typ: TOKEN_TYPE, kid: this.#controller.descriptor.keyId };
    const claims = {
      schema: TOKEN_SCHEMA,
      jti: `cap_${randomUUID()}`,
      iss: this.#controller.descriptor.workloadId,
      issuerKeyId: this.#controller.descriptor.keyId,
      sub: subjectIdentity.workloadId,
      subjectKeyId: subjectIdentity.keyId,
      subjectCardId: subjectIdentity.cardId,
      aud: targetIdentity?.workloadId ?? "human-pass",
      targetCardId,
      targetKeyId: targetIdentity?.keyId ?? null,
      capability: CAPABILITY,
      runId,
      hop,
      memoryId,
      inputHash,
      previousReceiptHash,
      iat: new Date(now).toISOString(),
      exp: new Date(now + lifetime).toISOString(),
    };
    const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
    return `${signingInput}.${this.#controller.sign(signingInput)}`;
  }

  inspect(token) {
    const parts = String(token ?? "").split(".");
    if (parts.length !== 3) throw new DelegationCapabilityError("Malformed delegation capability token.");
    try {
      return {
        header: parseSegment(parts[0]),
        claims: parseSegment(parts[1]),
        signature: parts[2],
        signingInput: `${parts[0]}.${parts[1]}`,
      };
    } catch {
      throw new DelegationCapabilityError("Delegation capability token is not valid base64url JSON.");
    }
  }

  verify(token, expected = {}, { consume = false, now = Date.now() } = {}) {
    const { header, claims, signature, signingInput } = this.inspect(token);
    const authority = this.#controller.descriptor;
    if (header.alg !== "EdDSA" || header.typ !== TOKEN_TYPE || header.kid !== authority.keyId) {
      throw new DelegationCapabilityError("Delegation capability header is invalid.");
    }
    if (keyIdForPublicKey(authority.publicKey) !== authority.keyId) {
      throw new DelegationCapabilityError("Delegation authority key identifier is invalid.");
    }
    if (!verifyEd25519({ publicKey: authority.publicKey, payload: signingInput, signature })) {
      throw new DelegationCapabilityError("Delegation capability signature is invalid.");
    }
    if (claims.schema !== TOKEN_SCHEMA || claims.capability !== CAPABILITY) {
      throw new DelegationCapabilityError("Delegation capability type is not permitted.");
    }
    if (claims.iss !== authority.workloadId || claims.issuerKeyId !== authority.keyId) {
      throw new DelegationCapabilityError("Delegation capability issuer does not match the trusted controller.");
    }
    const expires = Date.parse(claims.exp);
    const issued = Date.parse(claims.iat);
    if (!Number.isFinite(expires) || !Number.isFinite(issued) || issued > now || expires <= now) {
      throw new DelegationCapabilityError("Delegation capability is not currently valid.");
    }
    for (const [key, value] of Object.entries(expected)) {
      if (value !== undefined && claims[key] !== value) {
        throw new DelegationCapabilityError(`Delegation capability ${key} mismatch.`);
      }
    }
    if (consume) {
      if (this.#consumed.has(claims.jti)) {
        throw new DelegationCapabilityError("Delegation capability has already been consumed.");
      }
      this.#consumed.add(claims.jti);
    }
    return { ...claims };
  }

  verifyAndConsume(token, expected = {}, options = {}) {
    return this.verify(token, expected, { ...options, consume: true });
  }

  static verifyWithAuthority(token, authorityDescriptor, expected = {}, { now = Date.now() } = {}) {
    const parts = String(token ?? "").split(".");
    if (parts.length !== 3) return false;
    try {
      const header = parseSegment(parts[0]);
      const claims = parseSegment(parts[1]);
      const signingInput = `${parts[0]}.${parts[1]}`;
      if (header.alg !== "EdDSA" || header.typ !== TOKEN_TYPE || header.kid !== authorityDescriptor?.keyId) return false;
      if (keyIdForPublicKey(authorityDescriptor.publicKey) !== authorityDescriptor.keyId) return false;
      if (!verifyEd25519({ publicKey: authorityDescriptor.publicKey, payload: signingInput, signature: parts[2] })) return false;
      if (claims.schema !== TOKEN_SCHEMA || claims.capability !== CAPABILITY) return false;
      if (claims.iss !== authorityDescriptor.workloadId || claims.issuerKeyId !== authorityDescriptor.keyId) return false;
      if (Date.parse(claims.iat) > now || Date.parse(claims.exp) <= now) return false;
      for (const [key, value] of Object.entries(expected)) {
        if (value !== undefined && claims[key] !== value) return false;
      }
      return claims;
    } catch {
      return false;
    }
  }
}
