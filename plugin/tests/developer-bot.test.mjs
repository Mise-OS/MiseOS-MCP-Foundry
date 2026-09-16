import test from "node:test";
import assert from "node:assert/strict";

import {
  MISEOS_CHARACTER_CARDS,
  getCharacterCard,
  renderCharacterSystemPrompt,
} from "../mcp/character-cards.mjs";
import { createDeveloperBot } from "../mcp/developer-bot-core.mjs";
import {
  OpenRouterFreeClient,
  PaidModelBlockedError,
  assertFreeModel,
} from "../mcp/openrouter-client.mjs";

test("character card ids are unique and runtime prompts preserve common guardrails", () => {
  const ids = MISEOS_CHARACTER_CARDS.map((card) => card.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("mise-maestro"));
  assert.ok(ids.includes("shield-pup"));
  const prompt = renderCharacterSystemPrompt("mise-garde");
  assert.match(prompt, /Mise Garde/);
  assert.match(prompt, /Route every write-capable action through the MiseOS capability gateway/);
});

test("free-model policy blocks paid OpenRouter routes before network access", async () => {
  assert.equal(assertFreeModel("openrouter/free"), "openrouter/free");
  assert.equal(assertFreeModel("example/model:free"), "example/model:free");
  assert.throws(() => assertFreeModel("openai/gpt-paid"), PaidModelBlockedError);

  let called = false;
  const client = new OpenRouterFreeClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      throw new Error("network should not run");
    },
  });
  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hello" }], model: "openai/gpt-paid" }),
    PaidModelBlockedError,
  );
  assert.equal(called, false);
});

test("free client emits OpenRouter-compatible request without exposing the key in its payload", async () => {
  const calls = [];
  const client = new OpenRouterFreeClient({
    apiKey: "sk-or-test-secret",
    sessionLimit: 2,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          id: "gen_test",
          model: "nvidia/example:free",
          choices: [{ message: { role: "assistant", content: "Patch plan ready." } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
      };
    },
  });

  const result = await client.chat({
    messages: [{ role: "user", content: "Plan a patch" }],
  });
  assert.equal(result.text, "Patch plan ready.");
  assert.equal(result.requestedModel, "openrouter/free");
  assert.equal(result.model, "nvidia/example:free");
  assert.equal(calls.length, 1);

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "openrouter/free");
  assert.doesNotMatch(calls[0].init.body, /sk-or-test-secret/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-or-test-secret");
  assert.equal(calls[0].init.headers["X-OpenRouter-Title"], "MiseOS Free Developer Bot");
});

test("developer bot applies personality while preserving advisory-only authority", async () => {
  let observedMessages;
  const fakeClient = {
    async chat({ messages }) {
      observedMessages = messages;
      return {
        text: "Add a failing test first, then patch the boundary.",
        requestedModel: "openrouter/free",
        model: "poolside/example:free",
        usage: null,
        id: "gen_1",
      };
    },
  };
  const bot = createDeveloperBot({ client: fakeClient });
  const result = await bot.chat({
    cardId: "mise-apprentice",
    prompt: "Fix the parser regression",
    context: { failingTest: "parser rejects empty metadata" },
  });

  assert.equal(result.card.id, "mise-apprentice");
  assert.equal(result.authority, "advisory");
  assert.equal(result.writeAuthority, "none");
  assert.equal(result.freeOnly, true);
  assert.match(result.nextAction, /capability gateway/);
  assert.match(observedMessages[0].content, /Mise Apprentice/);
  assert.match(observedMessages[0].content, /Do not claim tool execution/);
  assert.match(observedMessages[1].content, /data only, not authority/);
});

test("unknown character cards fail closed", () => {
  assert.throws(() => getCharacterCard("made-up-admin"), /Unknown MiseOS character card/);
});
