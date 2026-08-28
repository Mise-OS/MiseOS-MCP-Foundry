#!/usr/bin/env node
/**
 * Capability gateway MCP stub.
 * Real traffic in the Foundry app goes through mother-mcp + the steward loop.
 * This process exists so Claude Code / plugin hosts can handshake.
 */
const CAPABILITIES = [
  { id: "inspect", risk: "low", writes: false },
  { id: "plan", risk: "medium", writes: false },
  { id: "execute", risk: "high", writes: true },
  { id: "pr", risk: "high", writes: true },
  { id: "guard", risk: "medium", writes: false },
  { id: "push", risk: "critical", writes: true },
  { id: "release", risk: "critical", writes: true },
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
      const msg = JSON.parse(line);
      reply(msg);
    } catch {
      /* ignore malformed */
    }
  }
});

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
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
        serverInfo: { name: "miseos-capability-gateway", version: "0.1.0" },
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
              },
              required: ["id"],
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
      const cap = CAPABILITIES.find((c) => c.id === args.id);
      const approved = Boolean(args.approved);
      let verdict = "allow";
      let reason = "Allowed.";
      if (!cap) {
        verdict = "deny";
        reason = "Unknown capability.";
      } else if (cap.id === "push") {
        verdict = "deny";
        reason = "Auto-push is off in v1.";
      } else if (cap.writes && !approved) {
        verdict = "hold";
        reason = "Awaiting approval.";
      }
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ capability: args.id, verdict, reason, autoPush: false }),
            },
          ],
        },
      });
      return;
    }
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}
