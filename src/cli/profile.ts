import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { DEFAULT_DATASET_PATH, TARGET_INDUSTRIES } from "../config.js";
import { clean, cleanLower, streamCompanyCsv } from "../data/csv.js";
import { isTargetCandidate } from "../data/candidates.js";

const program = new Command()
  .description("Profile PDL company CSV counts for data-center equipment targeting.")
  .option("-i, --input <path>", "PDL company CSV path", DEFAULT_DATASET_PATH)
  .option("--include-51-200", "Include the 51-200 bucket in target counts", false)
  .option("--sample-limit <n>", "Number of matching samples to print", parseIntArg, 20)
  .option("--progress-every <n>", "Progress log interval", parseIntArg, 1_000_000)
  .option("--report <path>", "Optional JSON report output path")
  .parse(process.argv);

const options = program.opts<{
  input: string;
  include51200: boolean;
  sampleLimit: number;
  progressEvery: number;
  report?: string;
}>();

const counts = new Map<string, number>();
const targetByIndustry = new Map<string, number>();
const targetBySize = new Map<string, number>();
const targetByIndustrySize = new Map<string, number>();
const samples: unknown[] = [];
const started = Date.now();

for await (const record of streamCompanyCsv(options.input)) {
  inc(counts, "total");

  const country = cleanLower(record.country);
  const industry = cleanLower(record.industry);
  const size = clean(record.size);
  const website = clean(record.website);

  if (country === "united states") inc(counts, "us");
  if (website) inc(counts, "with_website");
  if (TARGET_INDUSTRIES.has(industry)) inc(counts, "target_industry_anywhere");
  if (country === "united states" && TARGET_INDUSTRIES.has(industry)) {
    inc(counts, "us_target_industry");
  }

  if (
    isTargetCandidate(record, {
      include51200: false,
      requireWebsite: false,
    })
  ) {
    inc(counts, "strict_target_no_website_req");
    if (website) inc(counts, "strict_target_with_website");
  }

  if (
    isTargetCandidate(record, {
      include51200: true,
      requireWebsite: false,
    })
  ) {
    inc(counts, "loose_target_no_website_req");
    if (website) inc(counts, "loose_target_with_website");
  }

  if (
    isTargetCandidate(record, {
      include51200: options.include51200,
      requireWebsite: true,
    })
  ) {
    inc(targetByIndustry, industry);
    inc(targetBySize, size);
    inc(targetByIndustrySize, `${industry}\t${size}`);
    if (samples.length < options.sampleLimit) {
      samples.push({
        name: record.name,
        website: record.website,
        industry: record.industry,
        size: record.size,
        locality: record.locality,
        region: record.region,
        linkedin_url: record.linkedin_url,
      });
    }
  }

  const total = counts.get("total") ?? 0;
  if (options.progressEvery > 0 && total % options.progressEvery === 0) {
    console.error(`profiled ${total.toLocaleString()} rows`);
  }
}

const report = {
  input: options.input,
  elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2)),
  filterMode: options.include51200 ? "loose_including_51_200" : "strict_201_10000",
  counts: Object.fromEntries([...counts.entries()].sort()),
  targetByIndustry: Object.fromEntries([...targetByIndustry.entries()].sort()),
  targetBySize: Object.fromEntries([...targetBySize.entries()].sort()),
  targetByIndustrySize: Object.fromEntries([...targetByIndustrySize.entries()].sort()),
  samples,
};

console.log(JSON.stringify(report, null, 2));
if (options.report) {
  await fs.mkdir(path.dirname(options.report), { recursive: true });
  await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function inc(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}
