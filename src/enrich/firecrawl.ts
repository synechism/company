import path from "node:path";
import type { CandidateCompany, CompanyEnrichment, EnrichedCompany } from "../types.js";
import { candidateToDatasetRow } from "../data/row.js";
import { safeName, writeJson } from "../crawl/artifacts.js";
import { buildEnrichmentPrompt, emptyEnrichment, enrichmentSchema } from "./questions.js";

type FirecrawlJsonScrapeResponse = {
  success?: boolean;
  data?: {
    json?: CompanyEnrichment;
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
};

export async function enrichCompanyWithFirecrawl(
  company: CandidateCompany,
  options: FirecrawlEnrichOptions,
): Promise<EnrichedCompany> {
  const started = Date.now();
  const rawOutputPath = path.join(options.outputDir, "raw", `${safeName(company.id)}.firecrawl.json`);

  try {
    let payload = await scrapeJson(company.url, company.name, options);
    if (payload.error && company.url.startsWith("https://")) {
      payload = await scrapeJson(company.url.replace(/^https:\/\//i, "http://"), company.name, options);
    }
    await writeJson(rawOutputPath, payload.raw);

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
