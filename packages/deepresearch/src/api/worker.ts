import { Worker } from "bullmq";
import { loadDeepResearchApiConfig } from "./config.js";
import { createRedisConnectionOptions } from "./queue.js";
import { runDeepResearchJob } from "./runner.js";
import type { DeepResearchJobData, DeepResearchJobResult } from "./types.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Start an FCD-X deepresearch worker.

Usage:
  pnpm deepresearch:worker

Environment:
  REDIS_URL                         Redis URL, default redis://127.0.0.1:6379
  DEEPRESEARCH_QUEUE                BullMQ queue name, default fcdx-deepresearch
  DEEPRESEARCH_WORKER_CONCURRENCY   Jobs claimed by this worker, default 1
  DEEPRESEARCH_RESULTS_DIR          Job artifact root
  DEEPRESEARCH_COMPANY_CACHE_ROOT   Per-company cache root, default output/cache/firecrawl
  DEEPRESEARCH_RUNNER               open-deep-research or stub
  OPEN_DEEP_RESEARCH_DIR            External LangChain checkout path
`);
  process.exit(0);
}

const config = loadDeepResearchApiConfig();

const worker = new Worker<DeepResearchJobData, DeepResearchJobResult>(
  config.queueName,
  async (job) => runDeepResearchJob(job),
  {
    connection: createRedisConnectionOptions(),
    concurrency: config.workerConcurrency,
  },
);

worker.on("ready", () => {
  console.log(JSON.stringify({ worker: "ready", queue: config.queueName, concurrency: config.workerConcurrency }, null, 2));
});

worker.on("active", (job) => {
  console.error(`deepresearch job active: ${job.id}`);
});

worker.on("completed", (job, result) => {
  console.error(`deepresearch job completed: ${job.id} report=${result.report_path}`);
});

worker.on("failed", (job, error) => {
  console.error(`deepresearch job failed: ${job?.id ?? "(unknown)"} ${error.message}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void worker.close().finally(() => process.exit(0));
  });
}
