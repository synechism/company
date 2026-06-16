import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import type { CandidateCompany } from "../types.js";
import { DEFAULT_DATASET_PATH } from "../config.js";
import { clean, stableShard, streamCompanyCsv } from "../data/csv.js";
import { isTargetCandidate, toCandidate } from "../data/candidates.js";

const program = new Command()
  .description("Write filtered company candidates as JSONL.")
  .option("-i, --input <path>", "PDL company CSV path", DEFAULT_DATASET_PATH)
  .option("-o, --output <path>", "Output JSONL path", "output/candidates/strict.jsonl")
  .option("--include-51-200", "Include the 51-200 bucket", false)
  .option("--limit <n>", "Maximum candidates to write", parseIntArg)
  .option("--shard-index <n>", "Only write records for this zero-based shard index", parseIntArg)
  .option("--shard-count <n>", "Total shard count", parseIntArg)
  .option("--seed-file <path>", "Optional JSON file of known companies to append if missing")
  .option("--progress-every <n>", "Progress log interval", parseIntArg, 1_000_000)
  .parse(process.argv);

const options = program.opts<{
  input: string;
  output: string;
  include51200: boolean;
  limit?: number;
  shardIndex?: number;
  shardCount?: number;
  seedFile?: string;
  progressEvery: number;
}>();

if ((options.shardIndex === undefined) !== (options.shardCount === undefined)) {
  throw new Error("--shard-index and --shard-count must be provided together");
}
if (options.shardCount !== undefined && options.shardIndex !== undefined) {
  if (options.shardCount <= 0) throw new Error("--shard-count must be greater than zero");
  if (options.shardIndex < 0 || options.shardIndex >= options.shardCount) {
    throw new Error("--shard-index must be between 0 and shard-count - 1");
  }
}

await fs.mkdir(path.dirname(options.output), { recursive: true });
const file = await fs.open(options.output, "w");
const started = Date.now();
let scanned = 0;
let matched = 0;
let written = 0;
let skippedNoCandidate = 0;
const writtenHosts = new Set<string>();

try {
  for await (const record of streamCompanyCsv(options.input)) {
    scanned += 1;

    if (
      !isTargetCandidate(record, {
        include51200: options.include51200,
        requireWebsite: true,
      })
    ) {
      continue;
    }

    matched += 1;
    const candidate = toCandidate(record);
    if (!candidate) {
      skippedNoCandidate += 1;
      continue;
    }

    if (
      options.shardCount !== undefined &&
      options.shardIndex !== undefined &&
      stableShard(clean(candidate.id), options.shardCount) !== options.shardIndex
    ) {
      continue;
    }

    await file.write(`${JSON.stringify(candidate)}\n`);
    written += 1;
    writtenHosts.add(hostKey(candidate.url));

    if (options.limit !== undefined && written >= options.limit) break;

    if (options.progressEvery > 0 && scanned % options.progressEvery === 0) {
      console.error(`scanned ${scanned.toLocaleString()} rows, wrote ${written.toLocaleString()}`);
    }
  }
  if (options.seedFile && options.shardCount === undefined && options.limit === undefined) {
    const seeds = await readSeeds(options.seedFile);
    for (const seed of seeds) {
      const key = hostKey(seed.url || seed.website);
      if (!key || writtenHosts.has(key)) continue;
      await file.write(`${JSON.stringify(seed)}\n`);
      written += 1;
      writtenHosts.add(key);
    }
  }
} finally {
  await file.close();
}

const summary = {
  input: options.input,
  output: options.output,
  filterMode: options.include51200 ? "loose_including_51_200" : "strict_201_10000",
  scanned,
  matched,
  written,
  skippedNoCandidate,
  seedFile: options.seedFile,
  elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2)),
};

console.log(JSON.stringify(summary, null, 2));

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

async function readSeeds(pathname: string): Promise<CandidateCompany[]> {
  const raw = await fs.readFile(pathname, "utf8");
  const parsed = JSON.parse(raw) as CandidateCompany[];
  return parsed.map((seed) => ({
    ...seed,
    url: seed.url || (seed.website.startsWith("http") ? seed.website : `https://${seed.website}`),
  }));
}

function hostKey(urlOrHost: string | undefined): string {
  if (!urlOrHost) return "";
  try {
    const url = new URL(urlOrHost.startsWith("http") ? urlOrHost : `https://${urlOrHost}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return urlOrHost.replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  }
}
