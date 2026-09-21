#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createDeveloperBot } from "../../../plugin/mcp/developer-bot-core.mjs";
import { loadDotEnv } from "./env.mjs";

loadDotEnv();

function printResult(result) {
  console.log("\n=== MiseOS Card Team ===\n");
  for (const stage of result.stages) {
    console.log(`[${stage.hop}] ${stage.cardId} -> ${stage.delegatedTo}`);
    console.log(stage.answer);
    console.log(`workload: ${stage.workloadKeyId}`);
    console.log(`receipt:  ${stage.receiptHash}\n`);
  }
  console.log(`receiptChainValid: ${result.receiptChainValid}`);
  console.log(`authority: ${result.authority}`);
  console.log(`writeAuthority: ${result.writeAuthority}`);
  console.log(`memoryRetention: ${result.memoryRetention}`);
}

async function runTask(task) {
  const bot = createDeveloperBot();
  const result = await bot.runTeam({ prompt: task });
  printResult(result);
}

const direct = process.argv.slice(2).join(" ").trim();

if (direct) {
  await runTask(direct);
} else {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log("MiseOS Easy Starter");
  console.log("Type a developer task or 'exit'.\n");
  try {
    while (true) {
      const task = (await rl.question("miseos> ")).trim();
      if (!task) continue;
      if (["exit", "quit", "q"].includes(task.toLowerCase())) break;
      try {
        await runTask(task);
      } catch (error) {
        console.error(`\n${error?.name || "Error"}: ${error?.message || error}\n`);
      }
    }
  } finally {
    rl.close();
  }
}
