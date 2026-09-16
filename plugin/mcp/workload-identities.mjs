import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const data = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(data).digest("hex");
}

function asPublicKey(publicKey) {
  return publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
}

function publicKeyPem(publicKey) {
  return asPublicKey(publicKey).export({ type: "spki", format: "pem" }).toString();
}

function publicKeyDer(publicKey) {
  return asPublicKey(publicKey).export({ type: "spki", format: "der" });
}

export function keyIdForPublicKey(publicKey) {
  return `ed25519:${createHash("sha256").update(publicKeyDer(publicKey)).digest("hex")}`;
}

export function verifyEd25519({ publicKey, payload, signature }) {
  try {
    return cryptoVerify(
      null,
      Buffer.from(typeof payload === "string" ? payload : stableJson(payload)),
      asPublicKey(publicKey),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function createIdentity({ cardId, role = "card", instanceId }) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = keyIdForPublicKey(publicKey);
  const workloadId = role === "controller"
    ? `workload://miseos/team-controller/${instanceId}`
    : `workload://miseos/card/${cardId}/${instanceId}`;
  const descriptor = Object.freeze({
    schema: "miseos.workload-identity.v1",
    workloadId,
    cardId: cardId ?? null,
    role,
    keyId,
    algorithm: "Ed25519",
    publicKey: publicKeyPem(publicKey),
  });
  return { descriptor, privateKey };
}

export class Ed25519WorkloadIdentityRegistry {
  #byCard = new Map();
  #privateByWorkload = new Map();
  #instanceId;

  constructor({ instanceId = randomUUID() } = {}) {
    this.#instanceId = instanceId || `instance-${Date.now()}`;
  }

  ensureCard(cardId) {
    const normalized = String(cardId ?? "").trim().toLowerCase();
    if (!normalized) throw new Error("cardId is required for workload identity.");
    let identity = this.#byCard.get(normalized);
    if (!identity) {
      identity = createIdentity({ cardId: normalized, instanceId: this.#instanceId });
      this.#byCard.set(normalized, identity);
      this.#privateByWorkload.set(identity.descriptor.workloadId, identity.privateKey);
    }
    return identity.descriptor;
  }

  sign({ workloadId, payload }) {
    const privateKey = this.#privateByWorkload.get(workloadId);
    if (!privateKey) throw new Error(`Unknown or non-local workload identity: ${workloadId}`);
    const data = Buffer.from(typeof payload === "string" ? payload : stableJson(payload));
    return cryptoSign(null, data, privateKey).toString("base64url");
  }

  verify({ descriptor, payload, signature }) {
    if (!descriptor || descriptor.algorithm !== "Ed25519") return false;
    if (keyIdForPublicKey(descriptor.publicKey) !== descriptor.keyId) return false;
    return verifyEd25519({ publicKey: descriptor.publicKey, payload, signature });
  }

  publicBundle(cardIds = null) {
    const descriptors = cardIds
      ? cardIds.map((cardId) => this.ensureCard(cardId))
      : [...this.#byCard.values()].map((entry) => entry.descriptor);
    return descriptors.map((descriptor) => ({ ...descriptor }));
  }
}

export class Ed25519ControllerIdentity {
  #privateKey;

  constructor({ instanceId = `controller-${Date.now()}` } = {}) {
    const identity = createIdentity({ cardId: null, role: "controller", instanceId });
    this.descriptor = identity.descriptor;
    this.#privateKey = identity.privateKey;
  }

  sign(payload) {
    const data = Buffer.from(typeof payload === "string" ? payload : stableJson(payload));
    return cryptoSign(null, data, this.#privateKey).toString("base64url");
  }

  verify(payload, signature) {
    return verifyEd25519({ publicKey: this.descriptor.publicKey, payload, signature });
  }
}
