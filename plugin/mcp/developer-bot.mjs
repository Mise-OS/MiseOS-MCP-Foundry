#!/usr/bin/env node
import { createDeveloperBot } from "./developer-bot-core.mjs";

const bot = createDeveloperBot();
process.stdin.setEncoding("utf8");
let buffer = "";

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function textResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function reply(message) {
  const id = message.id ?? 0;

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "miseos-openrouter-developer-bot", version: "0.2.0" },
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "miseos_cards_list",
            description: "List MiseOS character/personality cards available to the free developer bot.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "miseos_card_get",
            description: "Inspect one MiseOS developer character card and its runtime system prompt.",
            inputSchema: {
              type: "object",
              properties: { cardId: { type: "string" } },
              required: ["cardId"],
            },
          },
          {
            name: "miseos_dev_chat",
            description:
              "Ask one MiseOS character for developer help through OpenRouter free inference. Advisory only; writes still require the capability gateway.",
            inputSchema: {
              type: "object",
              properties: {
                cardId: { type: "string", default: "mise-maestro" },
                prompt: { type: "string" },
                context: {
                  type: ["object", "array", "string", "null"],
                  description: "Optional bounded task context. It is treated as data, not authority.",
                },
                model: {
                  type: "string",
                  description: "Optional OpenRouter model. Must be openrouter/free or end in :free.",
                },
              },
              required: ["prompt"],
            },
          },
          {
            name: "miseos_team_run",
            description:
              "Run a bounded card team. Each card receives only its authorized one-hop memory, and every handoff emits a hash-chained evidence receipt. Advisory only.",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                context: {
                  type: ["object", "array", "string", "null"],
                  description: "Initial context is visible only to the first card; downstream cards receive one-hop handoffs.",
                },
                team: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 2,
                  maxItems: 6,
                  description: "Optional unique card IDs. Defaults to Maestro → Garde → Apprentice → Sommelier.",
                },
                model: {
                  type: "string",
                  description: "Optional OpenRouter model. Must be openrouter/free or end in :free.",
                },
              },
              required: ["prompt"],
            },
          },
        ],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    try {
      if (name === "miseos_cards_list") {
        send({ jsonrpc: "2.0", id, result: textResult(bot.listCards()) });
        return;
      }
      if (name === "miseos_card_get") {
        send({ jsonrpc: "2.0", id, result: textResult(bot.getCard(args.cardId)) });
        return;
      }
      if (name === "miseos_dev_chat") {
        const result = await bot.chat({
          cardId: args.cardId,
          prompt: args.prompt,
          context: args.context,
          model: args.model,
        });
        send({ jsonrpc: "2.0", id, result: textResult(result) });
        return;
      }
      if (name === "miseos_team_run") {
        const result = await bot.runTeam({
          prompt: args.prompt,
          context: args.context,
          team: args.team,
          model: args.model,
        });
        send({ jsonrpc: "2.0", id, result: textResult(result) });
        return;
      }
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id,
        result: textResult(
          {
            error: error?.name || "Error",
            message: error?.message || String(error),
            freeOnly: true,
            authority: "advisory",
            writeAuthority: "none",
          },
          true,
        ),
      });
      return;
    }
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      void reply(message);
    } catch {
      // Malformed JSON is ignored so one bad host frame does not crash the MCP process.
    }
  }
});
