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
  try {
    await execute(direct);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const close = () => rl.close();
  rl.on("SIGINT", close);
  process.on("SIGINT", close);
  console.log("MiseOS Easy Starter");
  console.log("Type a developer task or 'exit'.\n");
  stdout.write("miseos> ");
  try {
    // Async iteration settles on EOF and interface closure, unlike question().
    for await (const line of rl) {
      const task = line.trim();
      if (["exit", "quit", "q"].includes(task.toLowerCase())) break;
      if (task) {
        try {
          await execute(task);
        } catch (error) {
          console.error(`\n${error.message}\n`);
        }
      }
      stdout.write("miseos> ");
    }
  } finally {
    process.off("SIGINT", close);
    rl.off("SIGINT", close);
    rl.close();
  }
}
