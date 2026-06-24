#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

const child = spawn("pnpm", ["--filter", "@fcdx/cli", "fcdx", ...args], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(`Failed to start fcdx: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
