import fs from "node:fs";
import readline from "node:readline";
import { Command } from "commander";
import type { CandidateCompany, CrawlBackend, CrawlResult } from "../types.js";
import { crawlCompanies } from "../crawl/runner.js";

const program = new Command()
  .description("Run a bounded crawl pilot over candidate JSONL.")
  .option("-i, --input <path>", "Candidate JSONL path", "output/candidates/strict.jsonl")
  .option("-o, --output-dir <path>", "Output artifact directory", "output/crawls/pilot")
  .option("--limit <n>", "Maximum companies to crawl", parseIntArg, 5)
  .option("--concurrency <n>", "Parallel crawls", parseIntArg, Number(process.env.CRAWL_CONCURRENCY ?? 2))
  .option("--max-pages <n>", "Maximum pages per company", parseIntArg, 3)
  .option("--timeout-ms <n>", "Per-page timeout", parseIntArg, 20_000)
  .option("--backend <backend>", "Crawler backend: local, hyperbrowser, or firecrawl", process.env.CRAWL_BACKEND ?? "local")
  .option("--no-screenshot", "Skip screenshots")
  .parse(process.argv);

const options = program.opts<{
  input: string;
  outputDir: string;
  limit: number;
  concurrency: number;
  maxPages: number;
  timeoutMs: number;
  backend: CrawlBackend;
  screenshot: boolean;
}>();

if (!["local", "hyperbrowser", "firecrawl"].includes(options.backend)) {
  throw new Error("--backend must be local, hyperbrowser, or firecrawl");
}

const candidates = await readCandidates(options.input, options.limit);
if (candidates.length === 0) {
  throw new Error(`No candidates found in ${options.input}`);
}

const started = Date.now();
const results = await crawlCompanies(candidates, {
  backend: options.backend,
  outputDir: options.outputDir,
  concurrency: options.concurrency,
  maxPages: options.maxPages,
  timeoutMs: options.timeoutMs,
  screenshot: options.screenshot,
  hyperbrowserApiKey: process.env.HYPERBROWSER_API_KEY,
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
});

const elapsedMs = Date.now() - started;
const pageCount = results.reduce((sum, result) => sum + result.pages.length, 0);
const successfulCompanies = results.filter((result) => !result.error && result.pages.some((page) => !page.error)).length;
const summary = {
  input: options.input,
  outputDir: options.outputDir,
  backend: options.backend,
  companies: results.length,
  successfulCompanies,
  pageCount,
  elapsedMs,
  avgMsPerCompanyWallClock: Math.round(elapsedMs / Math.max(1, results.length)),
  avgMsPerCompanyObserved: Math.round(
    results.reduce((sum, result) => sum + result.elapsedMs, 0) / Math.max(1, results.length),
  ),
  verdicts: countBy(results, (result) => result.assessment.verdict),
  results: results.map((result) => ({
    name: result.company.name,
    website: result.company.website,
    elapsedMs: result.elapsedMs,
    pages: result.pages.length,
    pageErrors: result.pages.filter((page) => page.error).map((page) => `${page.url}: ${page.error}`),
    verdict: result.assessment.verdict,
    score: result.assessment.score,
    matchedSignals: result.assessment.matchedSignals,
    snippets: result.assessment.snippets,
  })),
};

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
