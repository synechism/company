import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { CandidateCompany, PageArtifact } from "../types.js";
import { chooseRelevantLinks } from "./links.js";
import { ensureDir, safeName } from "./artifacts.js";

export type LocalCrawlerOptions = {
  outputDir: string;
  maxPages: number;
  timeoutMs: number;
  screenshot: boolean;
  browser?: Browser;
};

export async function crawlWithLocalPlaywright(
  company: CandidateCompany,
  options: LocalCrawlerOptions,
): Promise<PageArtifact[]> {
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  let shouldCloseBrowser = !options.browser;
  let context: BrowserContext | undefined;

  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ignoreHTTPSErrors: true,
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
    });
    context.setDefaultTimeout(options.timeoutMs);
    context.setDefaultNavigationTimeout(options.timeoutMs);

    const page = await context.newPage();
    let home = await crawlPage(page, company.url, options, 0);
    if (home.error && company.url.startsWith("https://")) {
      home = await crawlPage(page, company.url.replace(/^https:\/\//i, "http://"), options, 0);
    }
    const pages = [home];

    if (!home.error && options.maxPages > 1) {
      const hrefs = await page
        .locator("a[href]")
        .evaluateAll((links) =>
          links
            .map((link) => (link as HTMLAnchorElement).href)
            .filter((href) => href.length > 0),
        )
        .catch(() => []);
      const relevantLinks = chooseRelevantLinks(home.finalUrl || company.url, hrefs, options.maxPages - 1);

      for (let index = 0; index < relevantLinks.length; index += 1) {
        pages.push(await crawlPage(page, relevantLinks[index], options, index + 1));
      }
    }

    return pages;
  } finally {
    await context?.close().catch(() => undefined);
    if (shouldCloseBrowser) {
      await browser.close().catch(() => undefined);
    }
  }
}

async function crawlPage(
  page: Page,
  url: string,
  options: LocalCrawlerOptions,
  pageIndex: number,
): Promise<PageArtifact> {
  const started = Date.now();
  const fileStem = `${String(pageIndex + 1).padStart(2, "0")}-${safeName(new URL(url).hostname + new URL(url).pathname)}`;
  const htmlPath = path.join(options.outputDir, `${fileStem}.html`);
  const screenshotPath = path.join(options.outputDir, `${fileStem}.png`);

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: Math.min(options.timeoutMs, 8000) }).catch(() => undefined);

    await ensureDir(options.outputDir);
    const html = await page.content();
    await Bunless.writeFile(htmlPath, html);

    if (options.screenshot) {
      await page.screenshot({ path: screenshotPath, fullPage: true, timeout: options.timeoutMs }).catch(() => undefined);
    }

    const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");

    return {
      url,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      text: text.slice(0, 80_000),
      htmlPath,
      screenshotPath: options.screenshot ? screenshotPath : undefined,
      elapsedMs: Date.now() - started,
      error: response && response.status() >= 400 ? `HTTP ${response.status()}` : undefined,
    };
  } catch (error) {
    return {
      url,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      text: "",
      htmlPath: undefined,
      screenshotPath: undefined,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const Bunless = {
  writeFile: async (pathname: string, data: string) => {
    const fs = await import("node:fs/promises");
    await fs.writeFile(pathname, data, "utf8");
  },
};
