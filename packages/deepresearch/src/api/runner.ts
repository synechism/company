import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Job } from "bullmq";
import { loadDeepResearchApiConfig } from "./config.js";
import type { DeepResearchJobData, DeepResearchJobResult, DeepResearchRunner } from "./types.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, "../..");

export async function runDeepResearchJob(
  job: Job<DeepResearchJobData, DeepResearchJobResult>,
): Promise<DeepResearchJobResult> {
  const config = loadDeepResearchApiConfig();
  const startedAt = new Date();
  const artifactDir = path.join(config.resultsDir, job.id ?? String(Date.now()));
  const promptPath = path.join(artifactDir, "prompt.md");
  const reportPath = path.join(artifactDir, "report.txt");
  const runJsonPath = path.join(artifactDir, "run.json");
  const runner = job.data.options?.runner ?? config.defaultRunner;

  await mkdir(artifactDir, { recursive: true });
  await writeFile(promptPath, job.data.prompt, "utf8");
  await writeFile(
    path.join(artifactDir, "job.json"),
    `${JSON.stringify({ id: job.id, name: job.name, data: job.data, enqueued_at: new Date(job.timestamp).toISOString() }, null, 2)}\n`,
    "utf8",
  );

  await job.updateProgress({ stage: "running", runner, artifact_dir: artifactDir });

  if (runner === "stub") {
    await runStub(job, reportPath, runJsonPath);
  } else {
    await runOpenDeepResearch(job, {
      promptPath,
      reportPath,
      runJsonPath,
      artifactDir,
      openDeepResearchDir: config.openDeepResearchDir,
    });
  }

  const completedAt = new Date();
  const result: DeepResearchJobResult = {
    job_id: job.id ?? "",
    runner,
    status: "completed",
    report_path: reportPath,
    prompt_path: promptPath,
    run_json_path: runJsonPath,
    artifact_dir: artifactDir,
    elapsed_ms: completedAt.getTime() - startedAt.getTime(),
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
  };
  await job.updateProgress({ stage: "completed", artifact_dir: artifactDir, report_path: reportPath });
  return result;
}

async function runStub(
  job: Job<DeepResearchJobData, DeepResearchJobResult>,
  reportPath: string,
  runJsonPath: string,
): Promise<void> {
  const report = [
    "Stub deep research report",
    "",
    `job_id: ${job.id}`,
    `metadata: ${JSON.stringify(job.data.metadata ?? {})}`,
    "",
    job.data.prompt.slice(0, 4000),
  ].join("\n");
  await writeFile(reportPath, report, "utf8");
  await writeFile(
    runJsonPath,
    `${JSON.stringify(
      {
        runner: "stub",
        job_id: job.id,
        output_path: reportPath,
        output_chars: report.length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function runOpenDeepResearch(
  job: Job<DeepResearchJobData, DeepResearchJobResult>,
  input: {
    promptPath: string;
    reportPath: string;
    runJsonPath: string;
    artifactDir: string;
    openDeepResearchDir: string;
  },
): Promise<void> {
  const scriptPath = path.join(packageRoot, "scripts", "run-open-deep-research.py");
  const options = job.data.options ?? {};
  const model = options.model || process.env.DEEPRESEARCH_MODEL || "openai:deepseek-chat";
  const args = [
    "run",
    "python",
    scriptPath,
    "--prompt-file",
    input.promptPath,
    "--output-file",
    input.reportPath,
    "--run-json",
    input.runJsonPath,
    "--thread-id",
    `fcdx-deepresearch-${job.id}`,
    "--search-api",
    options.searchApi || process.env.DEEPRESEARCH_SEARCH_API || "firecrawl",
    "--model",
    model,
    "--summarization-model",
    options.summarizationModel || process.env.DEEPRESEARCH_SUMMARIZATION_MODEL || model,
    "--compression-model",
    options.compressionModel || process.env.DEEPRESEARCH_COMPRESSION_MODEL || model,
    "--final-report-model",
    options.finalReportModel || process.env.DEEPRESEARCH_FINAL_REPORT_MODEL || model,
    "--max-concurrent-research-units",
    String(options.maxConcurrentResearchUnits ?? parseIntOption("DEEPRESEARCH_MAX_CONCURRENT_RESEARCH_UNITS", 1)),
    "--max-researcher-iterations",
    String(options.maxResearcherIterations ?? parseIntOption("DEEPRESEARCH_MAX_RESEARCHER_ITERATIONS", 2)),
    "--max-react-tool-calls",
    String(options.maxReactToolCalls ?? parseIntOption("DEEPRESEARCH_MAX_REACT_TOOL_CALLS", 4)),
    "--research-model-max-tokens",
    String(options.researchModelMaxTokens ?? parseIntOption("DEEPRESEARCH_RESEARCH_MODEL_MAX_TOKENS", 4096)),
    "--summarization-model-max-tokens",
    String(options.summarizationModelMaxTokens ?? parseIntOption("DEEPRESEARCH_SUMMARIZATION_MODEL_MAX_TOKENS", 4096)),
    "--compression-model-max-tokens",
    String(options.compressionModelMaxTokens ?? parseIntOption("DEEPRESEARCH_COMPRESSION_MODEL_MAX_TOKENS", 4096)),
    "--final-report-model-max-tokens",
    String(options.finalReportModelMaxTokens ?? parseIntOption("DEEPRESEARCH_FINAL_REPORT_MODEL_MAX_TOKENS", 8192)),
  ];

  await new Promise<void>((resolve, reject) => {
    const stdout = createWriteStream(path.join(input.artifactDir, "runner.stdout.log"));
    const stderr = createWriteStream(path.join(input.artifactDir, "runner.stderr.log"));
    const child = spawn("uv", args, {
      cwd: input.openDeepResearchDir,
      env: runnerEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);

    child.on("error", (error) => {
      stdout.close();
      stderr.close();
      reject(new Error(`Failed to start Open Deep Research runner. Is uv installed? ${error.message}`));
    });
    child.on("close", (code) => {
      stdout.close();
      stderr.close();
      if (code === 0) resolve();
      else reject(new Error(`Open Deep Research runner exited with code ${code}. See ${path.join(input.artifactDir, "runner.stderr.log")}`));
    });
  });
}

function parseIntOption(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function runnerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  if (!next.OPENAI_API_KEY && next.ANTHROPIC_AUTH_TOKEN) {
    next.OPENAI_API_KEY = next.ANTHROPIC_AUTH_TOKEN;
  }
  if (!next.OPENAI_BASE_URL && next.ANTHROPIC_AUTH_TOKEN) {
    next.OPENAI_BASE_URL = "https://api.deepseek.com";
  }
  return next;
}

export function isDeepResearchRunner(value: string): value is DeepResearchRunner {
  return value === "open-deep-research" || value === "stub";
}
