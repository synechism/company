import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import express from "express";
import type { Job } from "bullmq";
import { loadDeepResearchApiConfig } from "./config.js";
import { createDeepResearchQueue } from "./queue.js";
import { isDeepResearchRunner } from "./runner.js";
import type { DeepResearchJobData, DeepResearchJobResult, SubmitJobRequest, SubmitJobResponse } from "./types.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Start the FCD-X deepresearch API server.

Usage:
  pnpm deepresearch:api

Environment:
  REDIS_URL                  Redis URL, default redis://127.0.0.1:6379
  DEEPRESEARCH_API_HOST      Bind host, default 127.0.0.1
  DEEPRESEARCH_API_PORT      Bind port, default 8787
  DEEPRESEARCH_PUBLIC_URL    Optional public URL used in returned job links
  DEEPRESEARCH_QUEUE         BullMQ queue name, default fcdx-deepresearch
`);
  process.exit(0);
}

const config = loadDeepResearchApiConfig();
const queue = createDeepResearchQueue();
const app = express();

app.use(express.json({ limit: "4mb" }));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    queue: config.queueName,
    redis_url: maskRedisUrl(config.redisUrl),
  });
});

app.post("/jobs", async (request, response, next) => {
  try {
    const body = request.body as SubmitJobRequest;
    const prompt = await resolvePrompt(body);
    const runner = body.options?.runner;
    if (runner && !isDeepResearchRunner(runner)) {
      throw new Error("options.runner must be open-deep-research or stub");
    }
    const jobId = body.job_id || crypto.randomUUID();
    const data: DeepResearchJobData = {
      prompt,
      metadata: {
        ...(body.metadata ?? {}),
        ...(body.prompt_file ? { prompt_file: body.prompt_file } : {}),
      },
      options: body.options,
    };
    await queue.add("deepresearch", data, {
      jobId,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });

    response.status(202).json(jobUrls(request, jobId));
  } catch (error) {
    next(error);
  }
});

app.get("/jobs/:jobId", async (request, response, next) => {
  try {
    const job = await queue.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "job_not_found", job_id: request.params.jobId });
      return;
    }
    response.json(await jobStatusResponse(request, job));
  } catch (error) {
    next(error);
  }
});

app.get("/jobs/:jobId/report.txt", async (request, response, next) => {
  try {
    const job = await queue.getJob(request.params.jobId);
    if (!job) {
      response.status(404).type("text/plain").send(`Job not found: ${request.params.jobId}\n`);
      return;
    }
    const state = await job.getState();
    if (state !== "completed") {
      response.status(202).type("text/plain").send(`Job ${request.params.jobId} is not complete yet. Current state: ${state}\n`);
      return;
    }
    const result = job.returnvalue;
    if (!result?.report_path) {
      response.status(404).type("text/plain").send(`Job ${request.params.jobId} completed without a report path.\n`);
      return;
    }
    response.type("text/plain").send(await readFile(result.report_path, "utf8"));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  response.status(400).json({ error: "bad_request", message });
});

const server = app.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ listening: `http://${config.host}:${config.port}`, queue: config.queueName }, null, 2));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void queue.close().finally(() => process.exit(0));
    });
  });
}

async function resolvePrompt(body: SubmitJobRequest): Promise<string> {
  if (body.prompt && body.prompt_file) throw new Error("Provide either prompt or prompt_file, not both");
  if (body.prompt) return body.prompt;
  if (body.prompt_file) return readFile(body.prompt_file, "utf8");
  throw new Error("Provide prompt or prompt_file");
}

async function jobStatusResponse(request: express.Request, job: Job<DeepResearchJobData, DeepResearchJobResult>): Promise<Record<string, unknown>> {
  const state = await job.getState();
  const urls = jobUrls(request, job.id ?? "");
  return {
    ...urls,
    state,
    progress: job.progress,
    attempts_made: job.attemptsMade,
    failed_reason: job.failedReason,
    submitted_at: new Date(job.timestamp).toISOString(),
    processed_at: job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
    finished_at: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
    metadata: job.data.metadata,
    result: job.returnvalue,
  };
}

function jobUrls(request: express.Request, jobId: string): SubmitJobResponse {
  const baseUrl = process.env.DEEPRESEARCH_PUBLIC_URL || process.env.API_URL || `${request.protocol}://${request.get("host")}`;
  return {
    job_id: jobId,
    status_url: `${baseUrl}/jobs/${jobId}`,
    report_url: `${baseUrl}/jobs/${jobId}/report.txt`,
  };
}

function maskRedisUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return value;
  }
}
