import path from "node:path";
import fs from "node:fs/promises";
import type { CandidateCompany, CompanyEnrichment, EnrichedCompany } from "../types.js";
import { candidateToDatasetRow } from "../data/row.js";
import { ensureDir, safeName, writeJson, writeText } from "../crawl/artifacts.js";
import {
  buildEnrichmentPrompt,
  buildEnrichmentSchema,
  emptyEnrichment,
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

type FirecrawlPageScrapeResponse = Omit<FirecrawlJsonScrapeResponse, "data"> & {
  data?: Omit<NonNullable<FirecrawlJsonScrapeResponse["data"]>, "json">;
};

type CachedPagePayload = {
  ok: boolean;
  status: number;
  raw: FirecrawlPageScrapeResponse;
  error?: string;
  cacheHit: boolean;
};

export type FirecrawlEnrichOptions = {
  apiKey: string;
  outputDir: string;
  timeoutMs: number;
  cacheDir?: string;
  forceRefresh?: boolean;
  customQuestion?: string;
  fullPage?: boolean;
  includeHtml?: boolean;
  includeScreenshot?: boolean;
};

export async function enrichCompanyWithFirecrawl(
  company: CandidateCompany,
  options: FirecrawlEnrichOptions,
): Promise<EnrichedCompany> {
  const started = Date.now();
  const rawOutputPath = firecrawlRawOutputPath(company, options);
  const cachePayloadPath = firecrawlCachePayloadPath(company, options);

  try {
    const cachedPage = await readCachedFirecrawlPage(cachePayloadPath, options.forceRefresh);
    const payload = await enrichFromFirecrawlJson(company, options);
    await writeJson(rawOutputPath, payload.raw);
    await writeCachedPagePayload(company, options, payload);
    await writeFirecrawlArtifacts(company, options, stripJsonFromPagePayload(payload.raw));

    const data = payload.raw.data;
    const metadata = data?.metadata;
    const cachedMetadata = cachedPage?.raw.data?.metadata;
    const apiError = payload.raw.error ?? metadata?.error;
    const enrichment = data?.json ?? emptyEnrichment(apiError ?? `Firecrawl HTTP ${payload.status}`, options.customQuestion);

    return {
      source_row: candidateToDatasetRow(company),
      enrichment,
      agent_metadata: {
        backend: "firecrawl_scrape_json",
        url: company.url,
        final_url: metadata?.sourceURL ?? metadata?.url ?? cachedMetadata?.sourceURL ?? cachedMetadata?.url,
        title: metadata?.title ?? cachedMetadata?.title,
        elapsed_ms: Date.now() - started,
        raw_output_path: rawOutputPath,
        cache_dir: options.cacheDir ? firecrawlCompanyCacheDir(company, options.cacheDir) : undefined,
        crawl_cache_hit: Boolean(cachedPage),
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
      enrichment: emptyEnrichment(message, options.customQuestion),
      agent_metadata: {
        backend: "firecrawl_scrape_json",
        url: company.url,
        elapsed_ms: Date.now() - started,
        error: message,
      },
    };
  }
}

export async function crawlCompanyPageWithFirecrawl(
  company: CandidateCompany,
  options: FirecrawlEnrichOptions,
): Promise<CachedPagePayload> {
  const cachePayloadPath = firecrawlCachePayloadPath(company, options);
  const cached = await readCachedFirecrawlPage(cachePayloadPath, options.forceRefresh);
  if (cached) return cached;

  let payload = await scrapePage(company.url, options);
  if (payload.error && company.url.startsWith("https://")) {
    payload = await scrapePage(company.url.replace(/^https:\/\//i, "http://"), options);
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
  await writeFirecrawlArtifacts(company, options, payload.raw);
  return { ...payload, cacheHit: false };
}

export function firecrawlCompanyCacheDir(company: CandidateCompany, cacheRoot: string): string {
  return path.join(cacheRoot, safeName(company.id || company.name));
}

function firecrawlRawOutputPath(company: CandidateCompany, options: FirecrawlEnrichOptions): string {
  return path.join(options.outputDir, "raw", `${safeName(company.id)}.enrichment.json`);
}

function firecrawlCachePayloadPath(company: CandidateCompany, options: FirecrawlEnrichOptions): string | undefined {
  if (!options.cacheDir) return undefined;
  return path.join(firecrawlCompanyCacheDir(company, options.cacheDir), "payload.firecrawl.json");
}

async function writeCachedPagePayload(
  company: CandidateCompany,
  options: FirecrawlEnrichOptions,
  payload: { ok: boolean; status: number; raw: FirecrawlJsonScrapeResponse; error?: string },
): Promise<void> {
  const cachePayloadPath = firecrawlCachePayloadPath(company, options);
  if (!cachePayloadPath) return;
  const pageRaw = stripJsonFromPagePayload(payload.raw);
  await ensureDir(path.dirname(cachePayloadPath));
  await writeJson(cachePayloadPath, {
    cachedAt: new Date().toISOString(),
    companyId: company.id,
    companyName: company.name,
    url: company.url,
    ok: payload.ok && payload.raw.success !== false && !payload.error,
    status: payload.status,
    raw: pageRaw,
    error: payload.error ?? payload.raw.error ?? payload.raw.data?.metadata?.error,
  });
}

async function readCachedFirecrawlPage(
  pathname: string | undefined,
  forceRefresh = false,
): Promise<CachedPagePayload | undefined> {
  if (!pathname || forceRefresh) return undefined;
  try {
    const parsed = JSON.parse(await fs.readFile(pathname, "utf8")) as {
      ok?: boolean;
      status?: number;
      raw?: FirecrawlJsonScrapeResponse | FirecrawlPageScrapeResponse;
      error?: string;
    };
    if (parsed.raw && typeof parsed.status === "number") {
      const hadCachedJson = Boolean((parsed.raw as FirecrawlJsonScrapeResponse).data?.json);
      const raw = stripJsonFromPagePayload(parsed.raw);
      if (hadCachedJson) {
        await writeJson(pathname, { ...parsed, raw });
      }
      return {
        ok: parsed.ok ?? (parsed.status >= 200 && parsed.status < 300),
        status: parsed.status,
        raw,
        error: parsed.error,
        cacheHit: true,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function scrapePage(
  url: string,
  options: FirecrawlEnrichOptions,
): Promise<{ ok: boolean; status: number; raw: FirecrawlPageScrapeResponse; error?: string }> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: buildFirecrawlFormats(options),
      onlyMainContent: !options.fullPage,
      timeout: options.timeoutMs,
    }),
    signal: AbortSignal.timeout(options.timeoutMs + 10_000),
  });

  const raw = (await response.json().catch(() => ({}))) as FirecrawlPageScrapeResponse;
  return {
    ok: response.ok,
    status: response.status,
    raw: stripJsonFromPagePayload(raw),
    error: raw.error,
  };
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
      formats: buildFirecrawlFormats(options, {
        type: "json",
        prompt: buildEnrichmentPrompt(companyName, options.customQuestion),
        schema: buildEnrichmentSchema({ customQuestion: options.customQuestion }),
      }),
      onlyMainContent: !options.fullPage,
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

async function enrichFromFirecrawlJson(
  company: CandidateCompany,
  options: FirecrawlEnrichOptions,
): Promise<{ ok: boolean; status: number; raw: FirecrawlJsonScrapeResponse; error?: string }> {
  let payload = await scrapeJson(company.url, company.name, options);
  if (payload.error && company.url.startsWith("https://")) {
    payload = await scrapeJson(company.url.replace(/^https:\/\//i, "http://"), company.name, options);
  }
  return payload;
}

function buildFirecrawlFormats(
  options: FirecrawlEnrichOptions,
  jsonFormat?: { type: "json"; prompt: string; schema: unknown },
): unknown[] {
  const formats: unknown[] = ["markdown"];
  if (options.includeHtml) formats.push("html");
  if (options.includeScreenshot) formats.push("screenshot");
  if (jsonFormat) formats.push(jsonFormat);
  return formats;
}

function stripJsonFromPagePayload(raw: FirecrawlJsonScrapeResponse | FirecrawlPageScrapeResponse): FirecrawlPageScrapeResponse {
  if (!raw.data) return raw as FirecrawlPageScrapeResponse;
  const { json: _json, ...data } = raw.data as NonNullable<FirecrawlJsonScrapeResponse["data"]>;
  return { ...raw, data };
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
