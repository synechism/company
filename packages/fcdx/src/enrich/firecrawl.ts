import path from "node:path";
import fs from "node:fs/promises";
import type { CandidateCompany, CompanyEnrichment, EnrichedCompany } from "../types.js";
import { candidateToDatasetRow } from "../data/row.js";
import { ensureDir, safeName, writeJson, writeText } from "../crawl/artifacts.js";
import {
  buildEnrichmentPrompt,
  emptyEnrichment,
  enrichmentSchema,
  TARGET_ALIGNMENT_SCHEMA_VERSION,
} from "./questions.js";

type FirecrawlJsonScrapeResponse = {
  success?: boolean;
  data?: {
    json?: CompanyEnrichment;
    markdown?: string;
    html?: string;
    screenshot?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
      url?: string;
      statusCode?: number;
      error?: string;
    };
  };
  error?: string;
  warning?: string;
};

export type FirecrawlEnrichOptions = {
  apiKey: string;
  outputDir: string;
  timeoutMs: number;
  cacheDir?: string;
  forceRefresh?: boolean;
};

export async function enrichCompanyWithFirecrawl(
  company: CandidateCompany,
  options: FirecrawlEnrichOptions,
): Promise<EnrichedCompany> {
  const started = Date.now();
  const rawOutputPath = firecrawlRawOutputPath(company, options);
  const cachePayloadPath = firecrawlCachePayloadPath(company, options);

  try {
    let payload = await readCachedFirecrawlPayload(cachePayloadPath, options.forceRefresh);
    if (!payload) {
      payload = await scrapeJson(company.url, company.name, options);
      if (payload.error && company.url.startsWith("https://")) {
        payload = await scrapeJson(company.url.replace(/^https:\/\//i, "http://"), company.name, options);
      }
      if (cachePayloadPath) {
        await ensureDir(path.dirname(cachePayloadPath));
        await writeJson(cachePayloadPath, {
          cachedAt: new Date().toISOString(),
          companyId: company.id,
          companyName: company.name,
          url: company.url,
          ...payload,
        });
      }
    }
    await writeJson(rawOutputPath, payload.raw);
    await writeFirecrawlArtifacts(company, options, payload.raw);

    const data = payload.raw.data;
    const metadata = data?.metadata;
    const apiError = payload.raw.error ?? metadata?.error;
    const enrichment = data?.json ?? emptyEnrichment(apiError ?? `Firecrawl HTTP ${payload.status}`);

    return {
      source_row: candidateToDatasetRow(company),
      enrichment,
      agent_metadata: {
        backend: "firecrawl_scrape_json",
        url: company.url,
        final_url: metadata?.sourceURL ?? metadata?.url,
        title: metadata?.title,
        elapsed_ms: Date.now() - started,
        raw_output_path: rawOutputPath,
        error:
          payload.ok && payload.raw.success !== false && !apiError
            ? undefined
            : apiError ?? `Firecrawl HTTP ${payload.status}`,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source_row: candidateToDatasetRow(company),
      enrichment: emptyEnrichment(message),
      agent_metadata: {
        backend: "firecrawl_scrape_json",
        url: company.url,
        elapsed_ms: Date.now() - started,
        error: message,
      },
    };
  }
}

export function firecrawlCompanyCacheDir(company: CandidateCompany, cacheRoot: string): string {
  return path.join(cacheRoot, safeName(company.id || company.name));
}

function firecrawlRawOutputPath(company: CandidateCompany, options: FirecrawlEnrichOptions): string {
  if (options.cacheDir) return path.join(firecrawlCompanyCacheDir(company, options.cacheDir), "raw.firecrawl.json");
  return path.join(options.outputDir, "raw", `${safeName(company.id)}.firecrawl.json`);
}

function firecrawlCachePayloadPath(company: CandidateCompany, options: FirecrawlEnrichOptions): string | undefined {
  if (!options.cacheDir) return undefined;
  return path.join(firecrawlCompanyCacheDir(company, options.cacheDir), "payload.firecrawl.json");
}

async function readCachedFirecrawlPayload(
  pathname: string | undefined,
  forceRefresh = false,
): Promise<{ ok: boolean; status: number; raw: FirecrawlJsonScrapeResponse; error?: string } | undefined> {
  if (!pathname || forceRefresh) return undefined;
  try {
    const parsed = JSON.parse(await fs.readFile(pathname, "utf8")) as {
      ok?: boolean;
      status?: number;
      raw?: FirecrawlJsonScrapeResponse;
      error?: string;
    };
    if (parsed.raw && typeof parsed.status === "number") {
      const alignment = parsed.raw.data?.json?.target_alignment;
      if (parsed.raw.data?.json && alignment?.schema_version !== TARGET_ALIGNMENT_SCHEMA_VERSION) return undefined;
      return {
        ok: parsed.ok ?? (parsed.status >= 200 && parsed.status < 300),
        status: parsed.status,
        raw: parsed.raw,
        error: parsed.error,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function scrapeJson(
  url: string,
  companyName: string,
  options: FirecrawlEnrichOptions,
): Promise<{ ok: boolean; status: number; raw: FirecrawlJsonScrapeResponse; error?: string }> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: [
        "markdown",
        "html",
        "screenshot",
        {
          type: "json",
          prompt: buildEnrichmentPrompt(companyName),
          schema: enrichmentSchema,
        },
      ],
      onlyMainContent: false,
      timeout: options.timeoutMs,
    }),
    signal: AbortSignal.timeout(options.timeoutMs + 10_000),
  });

  const raw = (await response.json().catch(() => ({}))) as FirecrawlJsonScrapeResponse;
  return {
    ok: response.ok,
    status: response.status,
    raw,
    error: raw.error,
  };
}

async function writeFirecrawlArtifacts(
  company: CandidateCompany,
  options: FirecrawlEnrichOptions,
  raw: FirecrawlJsonScrapeResponse,
): Promise<void> {
  if (!options.cacheDir) return;
  const dir = firecrawlCompanyCacheDir(company, options.cacheDir);
  if (raw.data?.markdown) await writeText(path.join(dir, "page.md"), raw.data.markdown);
  if (raw.data?.html) await writeText(path.join(dir, "page.html"), raw.data.html);
  if (raw.data?.screenshot) {
    if (raw.data.screenshot.startsWith("data:image/")) {
      const [, base64] = raw.data.screenshot.split(",", 2);
      if (base64) await fs.writeFile(path.join(dir, "screenshot.png"), Buffer.from(base64, "base64"));
    } else {
      await writeText(path.join(dir, "screenshot.txt"), raw.data.screenshot);
    }
  }
}
