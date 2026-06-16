import path from "node:path";
import pLimit from "p-limit";
import { chromium, type Browser } from "playwright";
import type { CandidateCompany, CrawlBackend, CrawlResult } from "../types.js";
import { assessFit } from "../score.js";
import { appendJsonl, companyOutputDir, ensureDir, writeJson } from "./artifacts.js";
import { crawlWithLocalPlaywright } from "./local.js";
import { crawlWithHyperbrowser } from "./hyperbrowser.js";
import { crawlWithFirecrawl } from "./firecrawl.js";

export type RunPilotOptions = {
  backend: CrawlBackend;
  outputDir: string;
  concurrency: number;
  maxPages: number;
  timeoutMs: number;
  screenshot: boolean;
  hyperbrowserApiKey?: string;
  firecrawlApiKey?: string;
};

export async function crawlCompanies(
  companies: CandidateCompany[],
  options: RunPilotOptions,
): Promise<CrawlResult[]> {
  await ensureDir(options.outputDir);
  const summaryPath = path.join(options.outputDir, "results.jsonl");
  const limit = pLimit(options.concurrency);
  let browser: Browser | undefined;

  if (options.backend === "local") {
    browser = await chromium.launch({ headless: true });
  }

  try {
    const results = await Promise.all(
      companies.map((company) =>
        limit(async () => {
          const result = await crawlOneCompany(company, options, browser);
          await writeJson(path.join(companyOutputDir(options.outputDir, company.id), "result.json"), result);
          await appendJsonl(summaryPath, result);
          return result;
        }),
      ),
    );
    return results;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function crawlOneCompany(
  company: CandidateCompany,
  options: RunPilotOptions,
  browser?: Browser,
): Promise<CrawlResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const outputDir = companyOutputDir(options.outputDir, company.id);
  await ensureDir(outputDir);

  try {
    const pages =
      options.backend === "hyperbrowser"
        ? await crawlWithHyperbrowser(company, {
            outputDir,
            maxPages: options.maxPages,
            timeoutMs: options.timeoutMs,
            screenshot: options.screenshot,
            apiKey: requiredHyperbrowserKey(options.hyperbrowserApiKey),
          })
        : options.backend === "firecrawl"
          ? await crawlWithFirecrawl(company, {
              outputDir,
              maxPages: options.maxPages,
              timeoutMs: options.timeoutMs,
              screenshot: options.screenshot,
              apiKey: requiredFirecrawlKey(options.firecrawlApiKey),
            })
          : await crawlWithLocalPlaywright(company, {
            outputDir,
            maxPages: options.maxPages,
            timeoutMs: options.timeoutMs,
            screenshot: options.screenshot,
            browser,
          });

    return {
      company,
      backend: options.backend,
      startedAt,
      elapsedMs: Date.now() - started,
      pages,
      assessment: assessFit(pages),
    };
  } catch (error) {
    return {
      company,
      backend: options.backend,
      startedAt,
      elapsedMs: Date.now() - started,
      pages: [],
      assessment: {
        verdict: "not_fit",
        score: 0,
        reasons: ["crawl failed"],
        matchedSignals: [],
        snippets: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function requiredHyperbrowserKey(value: string | undefined): string {
  if (!value) {
    throw new Error("HYPERBROWSER_API_KEY is required for --backend hyperbrowser");
  }
  return value;
}

function requiredFirecrawlKey(value: string | undefined): string {
  if (!value) {
    throw new Error("FIRECRAWL_API_KEY is required for --backend firecrawl");
  }
  return value;
}
