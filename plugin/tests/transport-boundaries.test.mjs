import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { buildDeveloperMessages, OpenRouterFreeClient } from "../mcp/openrouter-client.mjs";

test("secret-like prompt/context is rejected before OpenRouter payload construction", () => {
  assert.throws(
    () => buildDeveloperMessages({
      characterPrompt: "test",
      prompt: "use OPENROUTER_API_KEY=sk-example-secret-1234567890",
      context: null,
    }),
    /secret-like material/,
  );
  assert.throws(
    () => buildDeveloperMessages({
      characterPrompt: "test",
      prompt: "review",
      context: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz" },
    }),
    /secret-like material/,
  );
});

test("OpenRouter provider stalls are aborted by the internal timeout", async () => {
  const client = new OpenRouterFreeClient({
    apiKey: "test-key",
    requestTimeoutMs: 100,
    fetchImpl: async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(init.signal.reason ?? new Error("aborted"));
        }, { once: true });
      });
    },
  });
  
  try {
    await client.chat({ messages: [{ role: "user", content: "safe prompt" }] });
    throw new Error("Expected rejection");
  } catch (error) {
    assert.match(error.message, /timed out after 100ms/);
  }
});

test("MCP id-less notifications produce no JSON-RPC response", async (t) => {
  const child = spawn(process.execPath, [new URL("../mcp/developer-bot.mjs", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, OPENROUTER_API_KEY: "" },
  });
  t.after(() => {
    child.kill("SIGTERM");
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  
  // Properly wait for child process to exit or timeout
  await new Promise((resolve) => {
    const timeoutHandler = setTimeout(() => {
      child.kill("SIGTERM");
      resolve();
    }, 500);
    child.on("exit", () => {
      clearTimeout(timeoutHandler);
      resolve();
    });
  });
  
  assert.equal(stdout, "");
});
