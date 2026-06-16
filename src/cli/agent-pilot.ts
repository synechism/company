import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Command } from "commander";
import pLimit from "p-limit";
import type { HyperAgentLlm } from "@hyperbrowser/sdk/types";
import type { CandidateCompany } from "../types.js";
import { runHyperAgentVerdict } from "../crawl/hyperagent.js";
import { appendJsonl, writeJson } from "../crawl/artifacts.js";

const program = new Command()
  .description("Run Hyperbrowser HyperAgent verdicts over a small candidate sample.")
  .option("-i, --input <path>", "Candidate JSONL path", "output/candidates/strict.jsonl")
  .option("-o, --output-dir <path>", "Output directory", "output/crawls/hyperagent-pilot")
  .option("--limit <n>", "Maximum companies to inspect", parseIntArg, 5)
  .option("--concurrency <n>", "Parallel agent tasks", parseIntArg, 1)
  .option("--llm <name>", "HyperAgent LLM", "gemini-3-flash-preview")
  .option("--max-steps <n>", "Maximum browser agent steps per company", parseIntArg, 12)
  .option("--max-wait-for-slot-ms <n>", "How long to wait for Hyperbrowser active session cleanup", parseIntArg, 180_000)
  .option("--slot-poll-ms <n>", "Active session polling interval", parseIntArg, 10_000)
  .parse(process.argv);

const options = program.opts<{
  input: string;
  outputDir: string;
  limit: number;
  concurrency: number;
  llm: HyperAgentLlm;
  maxSteps: number;
  maxWaitForSlotMs: number;
  slotPollMs: number;
}>();

if (!process.env.HYPERBROWSER_API_KEY) {
  throw new Error("HYPERBROWSER_API_KEY is required for agent-pilot");
}

await fsp.mkdir(options.outputDir, { recursive: true });
const candidates = await readCandidates(options.input, options.limit);
const limit = pLimit(options.concurrency);
const started = Date.now();
const results = await Promise.all(
  candidates.map((company) =>
    limit(async () => {
      const result = await runHyperAgentVerdict(company, {
        apiKey: process.env.HYPERBROWSER_API_KEY as string,
        llm: options.llm,
        maxSteps: options.maxSteps,
        maxWaitForSlotMs: options.maxWaitForSlotMs,
        slotPollMs: options.slotPollMs,
      });
      await writeJson(path.join(options.outputDir, `${company.id}.json`), result);
      await appendJsonl(path.join(options.outputDir, "results.jsonl"), result);
      return result;
    }),
  ),
);

const elapsedMs = Date.now() - started;
const summary = {
  input: options.input,
  outputDir: options.outputDir,
  companies: results.length,
  elapsedMs,
  avgMsPerCompanyWallClock: Math.round(elapsedMs / Math.max(1, results.length)),
  avgMsPerCompanyObserved: Math.round(
    results.reduce((sum, result) => sum + result.elapsedMs, 0) / Math.max(1, results.length),
  ),
  statuses: countBy(results, (result) => result.status),
  parsedVerdicts: countBy(results, (result) => getParsedVerdict(result.parsed)),
  results: results.map((result) => ({
    name: result.company.name,
    website: result.company.website,
    status: result.status,
    elapsedMs: result.elapsedMs,
    steps: result.steps,
    parsed: result.parsed,
    error: result.error,
  })),
};

await writeJson(path.join(options.outputDir, "summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));

async function readCandidates(pathname: string, limit: number): Promise<CandidateCompany[]> {
  const stream = fs.createReadStream(pathname, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: CandidateCompany[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as CandidateCompany);
    if (rows.length >= limit) break;
  }

  return rows;
}

function getParsedVerdict(value: unknown): string {
  if (value && typeof value === "object" && "verdict" in value) {
    return String((value as { verdict?: unknown }).verdict ?? "unknown");
  }
  return "unparsed";
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}
