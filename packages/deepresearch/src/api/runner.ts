import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Job } from "bullmq";
import { loadDeepResearchApiConfig, type DeepResearchApiConfig } from "./config.js";
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
  const options = job.data.options ?? {};
  const runner = options.runner ?? config.defaultRunner;
  const cache = resolveDeepResearchCache(job, config);

  await mkdir(artifactDir, { recursive: true });
  await writeFile(promptPath, job.data.prompt, "utf8");
  await writeFile(
    path.join(artifactDir, "job.json"),
    `${JSON.stringify({ id: job.id, name: job.name, data: job.data, enqueued_at: new Date(job.timestamp).toISOString() }, null, 2)}\n`,
    "utf8",
  );

  if (cache && !options.forceRefresh && (await fileExists(cache.reportPath))) {
    await job.updateProgress({ stage: "cache_hit", runner, artifact_dir: artifactDir, cache_dir: cache.dir });
    await copyFile(cache.reportPath, reportPath);
    await writeRunJson(runJsonPath, {
      runner,
      job_id: job.id,
      cache_hit: true,
      cache_dir: cache.dir,
      cache_report_path: cache.reportPath,
      cached_run_json_path: (await fileExists(cache.runJsonPath)) ? cache.runJsonPath : undefined,
      output_path: reportPath,
    });
    const completedAt = new Date();
    const result = buildJobResult({
      job,
      runner,
      artifactDir,
      promptPath,
      reportPath,
      runJsonPath,
      startedAt,
      completedAt,
      cacheHit: true,
      cacheDir: cache.dir,
      cacheReportPath: cache.reportPath,
    });
    await job.updateProgress({ stage: "completed", cache_hit: true, artifact_dir: artifactDir, report_path: reportPath });
    return result;
  }

  await job.updateProgress({ stage: "running", runner, artifact_dir: artifactDir, cache_dir: cache?.dir });

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
  if (cache) {
    await persistDeepResearchCache(job, cache, { reportPath, runJsonPath, promptPath, runner, startedAt, completedAt });
  }
  const result = buildJobResult({
    job,
    runner,
    artifactDir,
    promptPath,
    reportPath,
    runJsonPath,
    startedAt,
    completedAt,
    cacheHit: false,
    cacheDir: cache?.dir,
    cacheReportPath: cache?.reportPath,
  });
  await job.updateProgress({ stage: "completed", cache_hit: false, artifact_dir: artifactDir, report_path: reportPath, cache_dir: cache?.dir });
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

function buildJobResult(input: {
  job: Job<DeepResearchJobData, DeepResearchJobResult>;
  runner: DeepResearchRunner;
  artifactDir: string;
  promptPath: string;
  reportPath: string;
  runJsonPath: string;
  startedAt: Date;
  completedAt: Date;
  cacheHit: boolean;
  cacheDir?: string;
  cacheReportPath?: string;
}): DeepResearchJobResult {
  return {
    job_id: input.job.id ?? "",
    runner: input.runner,
    status: "completed",
    report_path: input.reportPath,
    prompt_path: input.promptPath,
    run_json_path: input.runJsonPath,
    artifact_dir: input.artifactDir,
    cache_hit: input.cacheHit,
    cache_dir: input.cacheDir,
    cache_report_path: input.cacheReportPath,
    elapsed_ms: input.completedAt.getTime() - input.startedAt.getTime(),
    started_at: input.startedAt.toISOString(),
    completed_at: input.completedAt.toISOString(),
  };
}

type DeepResearchCachePaths = {
  dir: string;
  reportPath: string;
  runJsonPath: string;
  metadataPath: string;
};

function resolveDeepResearchCache(
  job: Job<DeepResearchJobData, DeepResearchJobResult>,
  config: DeepResearchApiConfig,
): DeepResearchCachePaths | undefined {
  const metadata = job.data.metadata ?? {};
  const explicitDir = typeof metadata.deepresearch_cache_dir === "string" ? metadata.deepresearch_cache_dir : undefined;
  const companyId = typeof metadata.company_id === "string" ? metadata.company_id : undefined;
  const dir = explicitDir || (companyId ? path.join(config.companyCacheRoot, safeName(companyId), "deepresearch") : undefined);
  if (!dir) return undefined;
  return {
    dir: path.resolve(dir),
    reportPath: path.resolve(dir, "report.txt"),
    runJsonPath: path.resolve(dir, "run.json"),
    metadataPath: path.resolve(dir, "cache.json"),
  };
}

async function persistDeepResearchCache(
  job: Job<DeepResearchJobData, DeepResearchJobResult>,
  cache: DeepResearchCachePaths,
  input: {
    reportPath: string;
    runJsonPath: string;
    promptPath: string;
    runner: DeepResearchRunner;
    startedAt: Date;
    completedAt: Date;
  },
): Promise<void> {
  await mkdir(cache.dir, { recursive: true });
  await copyFile(input.reportPath, cache.reportPath);
  if (await fileExists(input.runJsonPath)) await copyFile(input.runJsonPath, cache.runJsonPath);
  await writeFile(
    cache.metadataPath,
    `${JSON.stringify(
      {
        cached_at: new Date().toISOString(),
        company_id: job.data.metadata?.company_id,
        company_name: job.data.metadata?.company_name,
        website: job.data.metadata?.website,
        source_job_id: job.id,
        runner: input.runner,
        prompt_path: input.promptPath,
        report_path: cache.reportPath,
        run_json_path: cache.runJsonPath,
        started_at: input.startedAt.toISOString(),
        completed_at: input.completedAt.toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function writeRunJson(pathname: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
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
