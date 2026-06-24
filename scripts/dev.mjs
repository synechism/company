#!/usr/bin/env node
import { spawn } from "node:child_process";

const useStub = process.argv.includes("--stub");
const host = process.env.DEEPRESEARCH_API_HOST || "127.0.0.1";
const port = process.env.DEEPRESEARCH_API_PORT || process.env.PORT || "8787";
const apiUrl =
  process.env.API_URL ||
  process.env.FCDX_DEEPRESEARCH_API_URL ||
  process.env.DEEPRESEARCH_API_URL ||
  `http://${host}:${port}`;

const childEnv = {
  ...process.env,
  API_URL: process.env.API_URL || apiUrl,
  DEEPRESEARCH_PUBLIC_URL: process.env.DEEPRESEARCH_PUBLIC_URL || apiUrl,
  DEEPRESEARCH_API_HOST: host,
  DEEPRESEARCH_API_PORT: port,
  REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  ...(useStub ? { DEEPRESEARCH_RUNNER: "stub" } : {}),
};

console.log(`Starting FCD-X dev services`);
console.log(`  API:    ${apiUrl}`);
console.log(`  Redis:  ${childEnv.REDIS_URL}`);
console.log(`  Runner: ${childEnv.DEEPRESEARCH_RUNNER || "open-deep-research"}`);
console.log(``);
console.log(`Use fcdx from another terminal, for example:`);
console.log(`  fcdx deepresearch status --job-id <job_id>`);
console.log(``);

const children = [
  start("api", ["deepresearch:api"]),
  start("worker", ["deepresearch:worker"]),
];

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) child.kill(signal);
    setTimeout(() => process.exit(0), 500);
  });
}

function start(name, args) {
  const child = spawn("pnpm", args, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    if (!shuttingDown) writePrefixed(process.stdout, name, chunk);
  });
  child.stderr.on("data", (chunk) => {
    if (!shuttingDown) writePrefixed(process.stderr, name, chunk);
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const status = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] exited with ${status}`);
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
}

function writePrefixed(stream, name, chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.length) stream.write(`[${name}] ${line}\n`);
  }
}
