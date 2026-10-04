import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const cwd = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
delete env.OPENROUTER_API_KEY;

test("direct CLI failure is a clean message with exit status 1", () => {
  const result = spawnSync(process.execPath, [cli, "safe task"], { cwd, env, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OPENROUTER_API_KEY missing/);
  assert.doesNotMatch(result.stderr, /at .*\.mjs|unsettled|Unhandled/);
});

for (const input of ["", "exit\n", "safe task\n"]) {
  test(`interactive CLI closes cleanly for piped input ${JSON.stringify(input)}`, () => {
    const result = spawnSync(process.execPath, [cli], { cwd, env, input, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /unsettled|Unhandled|AbortError|at .*\.mjs/);
  });
}

test("SIGINT while awaiting input closes without a stack trace", { skip: process.platform === "win32" }, async () => {
  const child = spawn(process.execPath, [cli], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", chunk => {
      if (chunk.toString().includes("miseos> ")) resolve();
    });
  });
  child.kill("SIGINT");
  const { code, signal } = await done;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.equal(stderr, "");
});
