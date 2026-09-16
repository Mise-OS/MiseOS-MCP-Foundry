#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  CardTeam,
  OpenRouterFreeClient,
  loadEnv,
} from "./miseos.mjs";

loadEnv();

async function execute(task) {
  const team = new CardTeam({ client: new OpenRouterFreeClient() });
  const result = await team.run({ prompt: task });

  console.log("\n=== MiseOS Result ===");
  for (const stage of result.stages) {
    console.log(`\n[${stage.hop}] ${stage.card} → ${stage.delegatedTo}`);
    console.log(stage.answer);
    console.log(`receipt: ${stage.receiptHash.slice(0, 20)}…`);
  }
  console.log(`\nreceiptChainValid: ${result.receiptChainValid}`);
  console.log(`authority: ${result.authority}`);
  console.log(`writeAuthority: ${result.writeAuthority}`);
}

const direct = process.argv.slice(2).join(" ").trim();

if (direct) {
  await execute(direct);
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
        await execute(task);
      } catch (error) {
        console.error(`\n${error.message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}
