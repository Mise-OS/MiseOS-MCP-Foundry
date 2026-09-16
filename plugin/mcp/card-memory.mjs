import { randomUUID } from "node:crypto";
import { getCharacterCard } from "./character-cards.mjs";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BYTES = 12_000;

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk|ghp|gho|ghu|ghs|github_pat)[-_A-Za-z0-9]{12,}\b/,
  /\bAKIA[A-Z0-9]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /OPENROUTER_API_KEY\s*=/i,
];

export class CardMemoryPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "CardMemoryPolicyError";
  }
}

export function assertNoSecretLikeMaterial(value, label = "card memory") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new CardMemoryPolicyError(`${label} contains secret-like material and cannot cross a card boundary.`);
  }
  return text;
}

function validateCard(id) {
  return getCharacterCard(id).id;
}

export class EphemeralCardMemoryStore {
  #items = new Map();
  #ttlMs;
  #maxBytes;

  constructor({ ttlMs = DEFAULT_TTL_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.#ttlMs = ttlMs;
    this.#maxBytes = maxBytes;
  }

  put({ runId, ownerCardId, content, shareWith = [] }) {
    if (!runId) throw new CardMemoryPolicyError("runId is required for card memory.");
    const owner = validateCard(ownerCardId);
    const shared = [...new Set(shareWith.map(validateCard))];
    const text = assertNoSecretLikeMaterial(content);
    if (Buffer.byteLength(text, "utf8") > this.#maxBytes) {
      throw new CardMemoryPolicyError(`card memory exceeds ${this.#maxBytes} bytes.`);
    }

    const createdAt = Date.now();
    const item = Object.freeze({
      id: `mem_${randomUUID()}`,
      runId,
      ownerCardId: owner,
      shareWith: Object.freeze(shared),
      content: text,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + this.#ttlMs).toISOString(),
    });
    this.#items.set(item.id, item);
    return { id: item.id, ownerCardId: owner, shareWith: [...shared], expiresAt: item.expiresAt };
  }

  read({ runId, requesterCardId, memoryId }) {
    const requester = validateCard(requesterCardId);
    const item = this.#items.get(memoryId);
    if (!item || item.runId !== runId) {
      throw new CardMemoryPolicyError("card memory reference is missing or belongs to another run.");
    }
    if (Date.parse(item.expiresAt) <= Date.now()) {
      this.#items.delete(memoryId);
      throw new CardMemoryPolicyError("card memory reference expired.");
    }
    if (item.ownerCardId !== requester && !item.shareWith.includes(requester)) {
      throw new CardMemoryPolicyError(`card ${requester} is not authorized to read ${memoryId}.`);
    }
    return {
      id: item.id,
      ownerCardId: item.ownerCardId,
      content: item.content,
      expiresAt: item.expiresAt,
    };
  }

  purgeRun(runId) {
    let removed = 0;
    for (const [id, item] of this.#items.entries()) {
      if (item.runId === runId) {
        this.#items.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  size() {
    return this.#items.size;
  }
}
