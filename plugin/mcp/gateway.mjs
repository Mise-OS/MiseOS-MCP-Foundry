#!/usr/bin/env node
/**
 * Capability gateway MCP stub.
 * Real traffic in the Foundry app goes through mother-mcp + the steward loop.
 * This process exists so Claude Code / plugin hosts can handshake.
 */
const CAPABILITIES = [
  { id: "inspect", risk: "low", writes: false, authority: "read", evidenceTier: "E1" },
  { id: "plan", risk: "medium", writes: false, authority: "read", evidenceTier: "E1" },
  { id: "execute", risk: "high", writes: true, authority: "write", evidenceTier: "E1" },
  { id: "pr", risk: "high", writes: true, authority: "write", evidenceTier: "E1" },
  { id: "guard", risk: "medium", writes: false, authority: "read", evidenceTier: "E1" },
  { id: "push", risk: "critical", writes: true, authority: "write", evidenceTier: "E1" },
  { id: "release", risk: "critical", writes: true, authority: "write", evidenceTier: "E2" },
];

process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      reply(JSON.parse(line));
    } catch {
      /* ignore malformed */
    }
  }
});

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function gate(id, approved, frozen) {
  const cap = CAPABILITIES.find((c) => c.id === id);
  if (!cap) {
    return { capability: id, verdict: "deny", decision: "reject", reason: "Unknown capability.", writes: false, autoPush: false };
  }
  if (frozen) {
    return { capability: id, verdict: "deny", decision: "reject", reason: "Kill switch is on.", writes: cap.writes, autoPush: false };
  }
  if (cap.id === "push") {
    return { capability: id, verdict: "deny", decision: "reject", reason: "Auto-push is off in v1.", writes: true, autoPush: false };
  }
  if (cap.writes && !approved) {
    return { capability: id, verdict: "hold", decision: "defer", reason: "Awaiting approval.", writes: true, autoPush: false };
  }
  return { capability: id, verdict: "allow", decision: "accept", reason: "Allowed.", writes: cap.writes, autoPush: false };
}

function cycle(approved, frozen) {
  const evaluated = CAPABILITIES.map((cap) => {
    const g = gate(cap.id, approved, frozen);
    return {
      id: cap.id,
      name: cap.id,
      evidence_tier: cap.evidenceTier,
      expected_return: null,
      downside: g.verdict === "allow" ? null : g.reason,
      probability_ruin: null,
      capital_required: null,
      decision: g.decision,
      verdict: g.verdict,
      reason: g.reason,
    };
  });
  return {
    schema: "miseos.capability-gateway.cycle.v1",
    frozen,
    approved,
    autoPush: false,
    capabilities_evaluated: evaluated,
    capabilities_rejected: evaluated.filter((e) => e.verdict === "deny").map((e) => e.id),
    capabilities_selected: evaluated.filter((e) => e.verdict === "allow").map((e) => e.id),
    capabilities_held: evaluated.filter((e) => e.verdict === "hold").map((e) => e.id),
    writes_at_risk: evaluated.filter((e) => e.verdict === "allow" && CAPABILITIES.find((c) => c.id === e.id)?.writes).length,
    evidence_tiers: {
      E1: CAPABILITIES.filter((c) => c.evidenceTier === "E1").map((c) => c.id),
      E2: CAPABILITIES.filter((c) => c.evidenceTier === "E2").map((c) => c.id),
      E3: [],
    },
    topology_claims: [
      { claim: "Default branch is never the write target.", evidence_tier: "E1", status: "active" },
      { claim: "Auto-push is off in v1.", evidence_tier: "E1", status: "active" },
    ],
    causal_claims: [
      { claim: "Unknown quantities stay null.", evidence_tier: "E1", status: "active" },
      { claim: "push is denied in v1.", evidence_tier: "E1", status: "active" },
    ],
    audit_events: [{ timestamp: new Date().toISOString(), event_type: "cycle_start", details: { frozen, approved } }],
    data_retention_actions: [
      { action: "hash_only", artifact_type: "intermediate_strategy_scores", reason: "Integrity hash only." },
      { action: "delete", artifact_type: "raw_opportunity_snapshots", reason: "Re-fetch, do not store." },
    ],
    next_action: frozen
      ? "Lift the kill switch."
      : approved
        ? "Open a PR draft. Do not push."
        : "Surface the plan. Wait for a human.",
  };
}

function reply(msg) {
  const id = msg.id ?? 0;
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "miseos-capability-gateway", version: "0.2.0" },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "capability_list",
            description: "List gated repo-management capabilities.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "capability_invoke",
            description: "Ask the gateway to allow, hold, or deny a capability.",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string" },
                approved: { type: "boolean" },
                frozen: { type: "boolean" },
              },
              required: ["id"],
            },
          },
          {
            name: "capability_cycle",
            description: "Run one auditable gateway cycle. Unknown quantities stay null.",
            inputSchema: {
              type: "object",
              properties: {
                approved: { type: "boolean" },
                frozen: { type: "boolean" },
              },
            },
          },
        ],
      },
    });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    if (name === "capability_list") {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify({ capabilities: CAPABILITIES, autoPush: false }) }] },
      });
      return;
    }
    if (name === "capability_invoke") {
      const result = gate(args.id, Boolean(args.approved), Boolean(args.frozen));
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      });
      return;
    }
    if (name === "capability_cycle") {
      const result = cycle(Boolean(args.approved), Boolean(args.frozen));
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      });
      return;
    }
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}
