import fs from "node:fs";
import crypto from "node:crypto";

export const ZERO_HASH = "0".repeat(64);
export const DEFAULT_TEAM = Object.freeze([
  "mise-maestro",
  "mise-garde",
  "mise-apprentice",
  "mise-sommelier",
]);

export const CARDS = Object.freeze({
  "mise-maestro": Object.freeze({
    id: "mise-maestro",
    name: "Mise Maestro",
    role: "Architect",
    instruction:
      "Architect the task. State invariants, dependency order, assumptions, and a concise handoff that a reviewer can challenge.",
  }),
  "mise-garde": Object.freeze({
    id: "mise-garde",
    name: "Mise Garde",
    role: "Adversarial Reviewer",
    instruction:
      "Review the upstream handoff adversarially. Identify concrete correctness, security, and boundary failures. Return actionable findings and required gates.",
  }),
  "mise-apprentice": Object.freeze({
    id: "mise-apprentice",
    name: "Mise Apprentice",
    role: "Test Engineer",
    instruction:
      "Turn the reviewed findings into executable regression tests and the smallest implementation plan that would satisfy them.",
  }),
  "mise-sommelier": Object.freeze({
    id: "mise-sommelier",
    name: "Mise Sommelier",
    role: "Evidence Auditor",
    instruction:
      "Audit claims, tests, and proposed changes. Produce a final traceable recommendation, evidence gaps, and the exact next human-approved action.",
  }),
});

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

export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : stableJson(value))
    .digest("hex");
}

export function loadEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const raw of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk|ghp|gho|ghu|ghs|github_pat)[-_A-Za-z0-9]{12,}\b/,
  /\bAKIA[A-Z0-9]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /OPENROUTER_API_KEY\s*=/i,
];

export function assertNoSecrets(value, label = "data") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (SECRET_PATTERNS.some((p) => p.test(text))) {
    throw new Error(`${label} contains secret-like material.`);
  }
  return text;
}

function asPublicKey(key) {
  return key?.type === "public" ? key : crypto.createPublicKey(key);
}

function publicPem(key) {
  return asPublicKey(key)
    .export({ type: "spki", format: "pem" })
    .toString();
}

function publicDer(key) {
  return asPublicKey(key).export({ type: "spki", format: "der" });
}

export function keyId(publicKey) {
  return `ed25519:${crypto.createHash("sha256").update(publicDer(publicKey)).digest("hex")}`;
}

export function verifyEd25519({ publicKey, payload, signature }) {
  try {
    return crypto.verify(
      null,
      Buffer.from(typeof payload === "string" ? payload : stableJson(payload)),
      crypto.createPublicKey(publicKey),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function newIdentity({ cardId = null, role, instanceId }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const descriptor = Object.freeze({
    schema: "miseos.workload-identity.v1",
    workloadId:
      role === "controller"
        ? `workload://miseos/team-controller/${instanceId}`
        : `workload://miseos/card/${cardId}/${instanceId}`,
    cardId,
    role,
    algorithm: "Ed25519",
    keyId: keyId(publicKey),
    publicKey: publicPem(publicKey),
  });
  return { descriptor, privateKey };
}

export class WorkloadRegistry {
  #instanceId;
  #cards = new Map();
  #private = new Map();

  constructor({ instanceId = crypto.randomUUID() } = {}) {
    this.#instanceId = instanceId;
  }

  ensureCard(cardId) {
    const id = String(cardId).trim().toLowerCase();
    if (!CARDS[id]) throw new Error(`Unknown card: ${cardId}`);
    if (!this.#cards.has(id)) {
      const identity = newIdentity({ cardId: id, role: "card", instanceId: this.#instanceId });
      this.#cards.set(id, identity.descriptor);
      this.#private.set(identity.descriptor.workloadId, identity.privateKey);
    }
    return this.#cards.get(id);
  }

  sign({ workloadId, payload }) {
    const key = this.#private.get(workloadId);
    if (!key) throw new Error(`Unknown local workload: ${workloadId}`);
    return crypto
      .sign(null, Buffer.from(typeof payload === "string" ? payload : stableJson(payload)), key)
      .toString("base64url");
  }

  publicBundle(ids) {
    return ids.map((id) => ({ ...this.ensureCard(id) }));
  }
}

export class ControllerIdentity {
  #privateKey;

  constructor({ instanceId = `controller-${crypto.randomUUID()}` } = {}) {
    const identity = newIdentity({ role: "controller", instanceId });
    this.descriptor = identity.descriptor;
    this.#privateKey = identity.privateKey;
  }

  sign(payload) {
    return crypto
      .sign(null, Buffer.from(typeof payload === "string" ? payload : stableJson(payload)), this.#privateKey)
      .toString("base64url");
  }
}

function b64json(value) {
  return Buffer.from(stableJson(value), "utf8").toString("base64url");
}

function parseB64json(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

export class DelegationAuthority {
  #controller;
  #consumed = new Set();
  #ttlMs;

  constructor({ controller = new ControllerIdentity(), ttlMs = 60_000 } = {}) {
    this.#controller = controller;
    this.#ttlMs = Math.max(1_000, Math.min(600_000, ttlMs));
  }

  get descriptor() {
    return { ...this.#controller.descriptor };
  }

  issue({
    subject,
    target = null,
    targetCardId,
    runId,
    hop,
    memoryId,
    inputHash,
    previousReceiptHash,
  }) {
    const now = Date.now();
    const header = {
      alg: "EdDSA",
      typ: "MISEOS-DELEGATION",
      kid: this.descriptor.keyId,
    };
    const claims = {
      schema: "miseos.delegation-capability.v1",
      jti: `cap_${crypto.randomUUID()}`,
      iss: this.descriptor.workloadId,
      issuerKeyId: this.descriptor.keyId,
      sub: subject.workloadId,
      subjectKeyId: subject.keyId,
      subjectCardId: subject.cardId,
      aud: target?.workloadId ?? "human-pass",
      targetCardId,
      targetKeyId: target?.keyId ?? null,
      capability: "card.process-and-handoff",
      runId,
      hop,
      memoryId,
      inputHash,
      previousReceiptHash,
      iat: new Date(now).toISOString(),
      exp: new Date(now + this.#ttlMs).toISOString(),
    };
    const input = `${b64json(header)}.${b64json(claims)}`;
    return `${input}.${this.#controller.sign(input)}`;
  }

  verify(token, expected = {}, { consume = false, now = Date.now() } = {}) {
    const parts = String(token).split(".");
    if (parts.length !== 3) throw new Error("Malformed delegation token.");
    const header = parseB64json(parts[0]);
    const claims = parseB64json(parts[1]);
    const input = `${parts[0]}.${parts[1]}`;

    if (
      header.alg !== "EdDSA" ||
      header.typ !== "MISEOS-DELEGATION" ||
      header.kid !== this.descriptor.keyId
    ) {
      throw new Error("Delegation header invalid.");
    }

    if (
      !verifyEd25519({
        publicKey: this.descriptor.publicKey,
        payload: input,
        signature: parts[2],
      })
    ) {
      throw new Error("Delegation signature invalid.");
    }

    if (
      claims.schema !== "miseos.delegation-capability.v1" ||
      claims.capability !== "card.process-and-handoff"
    ) {
      throw new Error("Delegation capability invalid.");
    }

    const issuedAt = Date.parse(claims.iat);
    const expiresAt = Date.parse(claims.exp);
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= issuedAt ||
      issuedAt > now ||
      expiresAt <= now
    ) {
      throw new Error("Delegation token expired, not yet valid, or malformed.");
    }

    for (const [key, value] of Object.entries(expected)) {
      if (value !== undefined && claims[key] !== value) {
        throw new Error(`Delegation ${key} mismatch.`);
      }
    }

    if (consume) {
      if (this.#consumed.has(claims.jti)) throw new Error("Delegation token already consumed.");
      this.#consumed.add(claims.jti);
    }

    return { ...claims };
  }

  verifyAndConsume(token, expected) {
    return this.verify(token, expected, { consume: true });
  }

  static verifyExternal(token, authority, expected = {}, now = Date.now()) {
    try {
      const parts = String(token).split(".");
      if (parts.length !== 3) return false;
      const header = parseB64json(parts[0]);
      const claims = parseB64json(parts[1]);
      const input = `${parts[0]}.${parts[1]}`;

      if (
        header.alg !== "EdDSA" ||
        header.typ !== "MISEOS-DELEGATION" ||
        header.kid !== authority.keyId
      ) return false;

      if (
        !verifyEd25519({
          publicKey: authority.publicKey,
          payload: input,
          signature: parts[2],
        })
      ) return false;

      if (
        claims.schema !== "miseos.delegation-capability.v1" ||
        claims.capability !== "card.process-and-handoff" ||
        claims.iss !== authority.workloadId ||
        claims.issuerKeyId !== authority.keyId
      ) return false;

      const issuedAt = Date.parse(claims.iat);
      const expiresAt = Date.parse(claims.exp);
      if (
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= issuedAt ||
        issuedAt > now ||
        expiresAt <= now
      ) return false;

      for (const [key, value] of Object.entries(expected)) {
        if (value !== undefined && claims[key] !== value) return false;
      }

      return claims;
    } catch {
      return false;
    }
  }
}

export class MemoryStore {
  #items = new Map();

  put({ runId, ownerCardId, content, shareWith = [] }) {
    const text = assertNoSecrets(content, "card memory");
    if (Buffer.byteLength(text, "utf8") > 12_000) throw new Error("Card memory exceeds 12KB.");

    const item = Object.freeze({
      id: `mem_${crypto.randomUUID()}`,
      runId,
      ownerCardId,
      shareWith: Object.freeze([...new Set(shareWith)]),
      content: text,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    this.#items.set(item.id, item);
    return { id: item.id, expiresAt: item.expiresAt };
  }

  read({ runId, requesterCardId, memoryId }) {
    const item = this.#items.get(memoryId);
    if (!item || item.runId !== runId) throw new Error("Memory missing or wrong run.");
    if (Date.parse(item.expiresAt) <= Date.now()) throw new Error("Memory expired.");
    if (item.ownerCardId !== requesterCardId && !item.shareWith.includes(requesterCardId)) {
      throw new Error(`Card ${requesterCardId} cannot read ${memoryId}.`);
    }
    return item;
  }

  purgeRun(runId) {
    for (const [id, item] of this.#items) {
      if (item.runId === runId) this.#items.delete(id);
    }
  }

  size() {
    return this.#items.size;
  }
}

export class ReceiptChain {
  constructor({ identities, authority }) {
    this.identities = identities;
    this.authority = authority;
  }

  append(receipts, event) {
    const previousReceiptHash = receipts.at(-1)?.receiptHash ?? ZERO_HASH;
    const identity = this.identities.ensureCard(event.fromCardId);

    const body = {
      schema: "miseos.card-handoff.receipt.v2",
      sequence: receipts.length + 1,
      runId: event.runId,
      fromCardId: event.fromCardId,
      toCardId: event.toCardId,
      toWorkloadId: event.toWorkloadId ?? null,
      toWorkloadKeyId: event.toWorkloadKeyId ?? null,
      inputMemoryId: event.inputMemoryId,
      outputMemoryId: event.outputMemoryId ?? null,
      inputHash: sha256(event.input),
      outputHash: sha256(event.output),
      previousReceiptHash,
      workloadIdentity: { ...identity },
      capabilityToken: event.token,
      capabilityTokenHash: sha256(event.token),
      capabilityJti: event.claims.jti,
      authority: "advisory",
      writeAuthority: "none",
      createdAt: new Date().toISOString(),
    };

    const receiptHash = sha256(body);
    const signature = this.identities.sign({
      workloadId: identity.workloadId,
      payload: receiptHash,
    });

    const receipt = Object.freeze({
      ...body,
      receiptHash,
      signatureAlgorithm: "Ed25519",
      signature,
    });
    receipts.push(receipt);
    return receipt;
  }

  verify(receipts) {
    let previous = ZERO_HASH;

    for (const receipt of receipts) {
      if (receipt.previousReceiptHash !== previous) return false;

      const { receiptHash, signature, signatureAlgorithm, ...body } = receipt;
      if (sha256(body) !== receiptHash) return false;
      if (signatureAlgorithm !== "Ed25519") return false;

      const identity = receipt.workloadIdentity;
      if (identity.cardId !== receipt.fromCardId) return false;
      if (keyId(identity.publicKey) !== identity.keyId) return false;

      if (
        !verifyEd25519({
          publicKey: identity.publicKey,
          payload: receiptHash,
          signature,
        })
      ) return false;

      if (sha256(receipt.capabilityToken) !== receipt.capabilityTokenHash) return false;

      const claims = DelegationAuthority.verifyExternal(
        receipt.capabilityToken,
        this.authority.descriptor,
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
        Date.parse(receipt.createdAt),
      );

      if (!claims || claims.jti !== receipt.capabilityJti) return false;
      previous = receiptHash;
    }

    return true;
  }
}

export function renderSystem(card) {
  return [
    `You are ${card.name}, the MiseOS ${card.role}.`,
    card.instruction,
    "You are advisory-only.",
    "Never claim repository writes or tool execution without verified evidence.",
    "Never request or expose raw credentials.",
    "Delegation tokens and private keys are outside model context.",
    "Team consensus never grants write authority.",
  ].join("\n\n");
}

export class OpenRouterFreeClient {
  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    model = process.env.OPENROUTER_MODEL || "openrouter/free",
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.requests = 0;
  }

  #assertFree(model) {
    if (model !== "openrouter/free" && !model.endsWith(":free")) {
      throw new Error(`Non-free OpenRouter model blocked: ${model}`);
    }
  }

  async chat({ card, prompt, context, model = this.model }) {
    this.#assertFree(model);
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY missing. Add it to .env or run npm run demo.");
    if (++this.requests > Number(process.env.MISEOS_OPENROUTER_SESSION_LIMIT || 40)) {
      throw new Error("OpenRouter session limit reached.");
    }

    const system = renderSystem(card);
    const safePrompt = assertNoSecrets(prompt, "prompt");
    const safeContext = assertNoSecrets(context, "context").slice(0, 16_000);
    const controller = new AbortController();
    const timeout = Number(process.env.MISEOS_OPENROUTER_TIMEOUT_MS || 20_000);
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.OPENROUTER_SITE_URL ||
            "https://github.com/Mise-OS/MiseOS-MCP-Foundry",
          "X-OpenRouter-Title":
            process.env.OPENROUTER_APP_NAME || "MiseOS Easy Starter",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `Authorized bounded context:\n${safeContext}` },
            { role: "user", content: safePrompt },
          ],
          temperature: 0.15,
          max_tokens: 1800,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || `OpenRouter HTTP ${response.status}`);
      }
      const answer = payload?.choices?.[0]?.message?.content;
      if (!answer) throw new Error("OpenRouter returned no answer.");

      return {
        answer: typeof answer === "string" ? answer : JSON.stringify(answer),
        requestedModel: model,
        servedModel: payload.model || model,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OfflineClient {
  #n = 0;

  async chat({ card, prompt }) {
    this.#n += 1;
    return {
      answer: `${card.name} offline handoff ${this.#n}: ${prompt}`,
      requestedModel: "offline/mock",
      servedModel: "offline/mock",
    };
  }
}

export class CardTeam {
  constructor({
    client,
    memory = new MemoryStore(),
    identities = new WorkloadRegistry(),
    authority = new DelegationAuthority(),
  }) {
    this.client = client;
    this.memory = memory;
    this.identities = identities;
    this.authority = authority;
    this.receipts = new ReceiptChain({ identities, authority });
  }

  async run({ prompt, context = null, team = DEFAULT_TEAM, model } = {}) {
    if (!prompt?.trim()) throw new Error("Task prompt required.");
    if (!Array.isArray(team) || team.length === 0) throw new Error("At least one card is required.");
    if (new Set(team).size !== team.length) throw new Error("Duplicate/cyclic cards denied.");
    for (const id of team) {
      if (!CARDS[id]) throw new Error(`Unknown card: ${id}`);
      this.identities.ensureCard(id);
    }

    const runId = `team_${crypto.randomUUID()}`;
    const receipts = [];
    const stages = [];

    let memoryRef = this.memory.put({
      runId,
      ownerCardId: team[0],
      content: JSON.stringify({
        task: assertNoSecrets(prompt, "task"),
        context,
        authority: "advisory",
        writeAuthority: "none",
      }),
    });

    try {
      for (let i = 0; i < team.length; i += 1) {
        const cardId = team[i];
        const nextCardId = team[i + 1] ?? null;
        const card = CARDS[cardId];
        const subject = this.identities.ensureCard(cardId);
        const target = nextCardId ? this.identities.ensureCard(nextCardId) : null;
        const readable = this.memory.read({
          runId,
          requesterCardId: cardId,
          memoryId: memoryRef.id,
        });

        const previousReceiptHash = receipts.at(-1)?.receiptHash ?? ZERO_HASH;
        const inputHash = sha256(readable.content);

        const token = this.authority.issue({
          subject,
          target,
          targetCardId: nextCardId ?? "human-pass",
          runId,
          hop: i + 1,
          memoryId: readable.id,
          inputHash,
          previousReceiptHash,
        });

        const claims = this.authority.verifyAndConsume(token, {
          sub: subject.workloadId,
          subjectKeyId: subject.keyId,
          subjectCardId: cardId,
          aud: target?.workloadId ?? "human-pass",
          targetCardId: nextCardId ?? "human-pass",
          targetKeyId: target?.keyId ?? null,
          runId,
          hop: i + 1,
          memoryId: readable.id,
          inputHash,
          previousReceiptHash,
        });

        const result = await this.client.chat({
          card,
          prompt: card.instruction,
          context: {
            runId,
            hop: i + 1,
            authorizedMemory: {
              id: readable.id,
              ownerCardId: readable.ownerCardId,
              content: readable.content,
            },
            boundary: "Use only this one-hop memory. Cryptographic authority stays outside model context.",
          },
          model,
        });

        const output = assertNoSecrets(result.answer, `${cardId} output`);

        let nextMemory = null;
        if (nextCardId) {
          nextMemory = this.memory.put({
            runId,
            ownerCardId: cardId,
            content: output,
            shareWith: [nextCardId],
          });
        }

        const receipt = this.receipts.append(receipts, {
          runId,
          fromCardId: cardId,
          toCardId: nextCardId ?? "human-pass",
          toWorkloadId: target?.workloadId ?? null,
          toWorkloadKeyId: target?.keyId ?? null,
          inputMemoryId: readable.id,
          outputMemoryId: nextMemory?.id ?? null,
          input: readable.content,
          output,
          token,
          claims,
        });

        stages.push({
          hop: i + 1,
          card: card.name,
          delegatedTo: nextCardId ?? "human-pass",
          answer: output,
          workloadId: subject.workloadId,
          workloadKeyId: subject.keyId,
          capabilityJti: claims.jti,
          capabilityTokenHash: sha256(token),
          receiptHash: receipt.receiptHash,
        });

        if (nextMemory) memoryRef = nextMemory;
      }

      return {
        schema: "miseos.card-team.run.v2",
        runId,
        team,
        identityModel: "Ed25519 workload identities",
        delegationModel: "one-hop controller-signed capability tokens",
        delegationAuthority: this.authority.descriptor,
        workloadIdentities: this.identities.publicBundle(team),
        stages,
        receipts,
        finalAnswer: stages.at(-1)?.answer ?? "",
        receiptChainValid: this.receipts.verify(receipts),
        memoryRetention: "ephemeral-purged-after-run",
        authority: "advisory",
        writeAuthority: "none",
      };
    } finally {
      this.memory.purgeRun(runId);
    }
  }
}
