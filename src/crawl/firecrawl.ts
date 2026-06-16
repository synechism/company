import path from "node:path";
import type { CandidateCompany, PageArtifact } from "../types.js";
import { chooseRelevantLinks } from "./links.js";
import { safeName, writeJson, writeText } from "./artifacts.js";

export type FirecrawlCrawlerOptions = {
  outputDir: string;
  maxPages: number;
  timeoutMs: number;
  screenshot: boolean;
  apiKey: string;
};

type FirecrawlScrapeData = {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  metadata?: {
    title?: string;
    sourceURL?: string;
    url?: string;
    statusCode?: number;
    error?: string;
  };
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: FirecrawlScrapeData;
  error?: string;
  warning?: string;
};

export async function crawlWithFirecrawl(
  company: CandidateCompany,
  options: FirecrawlCrawlerOptions,
): Promise<PageArtifact[]> {
  let home = await scrapePage(company.url, options, 0);
  if (home.error && company.url.startsWith("https://")) {
    home = await scrapePage(company.url.replace(/^https:\/\//i, "http://"), options, 0);
  }

  const pages = [home.artifact];
  if (!home.artifact.error && options.maxPages > 1) {
    const relevantLinks = chooseRelevantLinks(
      home.artifact.finalUrl || company.url,
      home.links,
      options.maxPages - 1,
    );
    for (let index = 0; index < relevantLinks.length; index += 1) {
      pages.push((await scrapePage(relevantLinks[index], options, index + 1)).artifact);
    }
  }

  return pages;
}

async function scrapePage(
  url: string,
  options: FirecrawlCrawlerOptions,
  pageIndex: number,
): Promise<{ artifact: PageArtifact; links: string[]; error?: string }> {
  const started = Date.now();
  const parsed = new URL(url);
  const fileStem = `${String(pageIndex + 1).padStart(2, "0")}-${safeName(parsed.hostname + parsed.pathname)}`;
  const jsonPath = path.join(options.outputDir, `${fileStem}.firecrawl.json`);
  const markdownPath = path.join(options.outputDir, `${fileStem}.md`);
  const htmlPath = path.join(options.outputDir, `${fileStem}.html`);
  const screenshotPath = path.join(options.outputDir, `${fileStem}.screenshot.txt`);

  try {
    const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: options.screenshot ? ["markdown", "html", "links", "screenshot"] : ["markdown", "html", "links"],
        onlyMainContent: false,
        waitFor: 1000,
        timeout: options.timeoutMs,
      }),
      signal: AbortSignal.timeout(options.timeoutMs + 10_000),
    });

    const payload = (await response.json().catch(() => ({}))) as FirecrawlScrapeResponse;
    await writeJson(jsonPath, payload);

    const data = payload.data ?? {};
    const markdown = data.markdown ?? "";
    const html = data.html ?? data.rawHtml ?? "";
    const title = data.metadata?.title ?? "";
    const finalUrl = data.metadata?.sourceURL ?? data.metadata?.url ?? url;
    const statusCode = data.metadata?.statusCode;
    const apiError = payload.error ?? data.metadata?.error;

    if (markdown) await writeText(markdownPath, markdown);
    if (html) await writeText(htmlPath, html);
    if (options.screenshot && data.screenshot) {
      await writeText(screenshotPath, data.screenshot);
    }

    return {
      artifact: {
        url,
        finalUrl,
        title,
        text: (markdown || html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80_000),
        htmlPath: html ? htmlPath : markdown ? markdownPath : jsonPath,
        screenshotPath: options.screenshot && data.screenshot ? screenshotPath : undefined,
        elapsedMs: Date.now() - started,
        error:
          response.ok && payload.success !== false && !apiError
            ? statusCode && statusCode >= 400
              ? `HTTP ${statusCode}`
              : undefined
            : apiError || `Firecrawl HTTP ${response.status}`,
      },
      links: Array.isArray(data.links) ? data.links : [],
      error: apiError,
    };
  } catch (error) {
    return {
      artifact: {
        url,
        finalUrl: url,
        title: "",
        text: "",
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
      links: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
