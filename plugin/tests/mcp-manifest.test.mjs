import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestUrl = new URL("../.mcp.json", import.meta.url);

test("MCP manifest resolves plugin executables from CLAUDE_PLUGIN_ROOT", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  for (const [name, server] of Object.entries(manifest.mcpServers)) {
    assert.equal(server.command, "node", `${name} must execute through node`);
    assert.equal(server.args.length, 1);
    assert.match(server.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\/mcp\/.+\.mjs$/);
    assert.doesNotMatch(server.args[0], /^plugin\//);
  }
});
