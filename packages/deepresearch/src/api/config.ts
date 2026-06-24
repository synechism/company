import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeepResearchRunner } from "./types.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, "../..");

export type DeepResearchApiConfig = {
  host: string;
  port: number;
  redisUrl: string;
  queueName: string;
  workerConcurrency: number;
  resultsDir: string;
  companyCacheRoot: string;
  defaultRunner: DeepResearchRunner;
  openDeepResearchDir: string;
};

export function loadDeepResearchApiConfig(): DeepResearchApiConfig {
  return {
    host: process.env.DEEPRESEARCH_API_HOST || "127.0.0.1",
    port: parseIntEnv("DEEPRESEARCH_API_PORT", process.env.DEEPRESEARCH_API_PORT || process.env.PORT, 8787),
    redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    queueName: process.env.DEEPRESEARCH_QUEUE || "fcdx-deepresearch",
    workerConcurrency: parseIntEnv("DEEPRESEARCH_WORKER_CONCURRENCY", process.env.DEEPRESEARCH_WORKER_CONCURRENCY, 1),
    resultsDir: path.resolve(process.env.DEEPRESEARCH_RESULTS_DIR || path.join(packageRoot, "results", "jobs")),
    companyCacheRoot: path.resolve(process.env.DEEPRESEARCH_COMPANY_CACHE_ROOT || "output/cache/firecrawl"),
    defaultRunner: parseRunner(process.env.DEEPRESEARCH_RUNNER || "open-deep-research"),
    openDeepResearchDir: path.resolve(
      process.env.OPEN_DEEP_RESEARCH_DIR || path.join(packageRoot, "external", "open_deep_research"),
    ),
  };
}

function parseIntEnv(name: string, value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseRunner(value: string): DeepResearchRunner {
  if (value === "open-deep-research" || value === "stub") return value;
  throw new Error(`DEEPRESEARCH_RUNNER must be open-deep-research or stub, got ${value}`);
}
