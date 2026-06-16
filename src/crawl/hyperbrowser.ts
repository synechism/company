import path from "node:path";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium } from "playwright-core";
import type { CandidateCompany, PageArtifact } from "../types.js";
import { chooseRelevantLinks } from "./links.js";
import { ensureDir, safeName } from "./artifacts.js";

export type HyperbrowserCrawlerOptions = {
  outputDir: string;
  maxPages: number;
  timeoutMs: number;
  screenshot: boolean;
  apiKey: string;
};

export async function crawlWithHyperbrowser(
  company: CandidateCompany,
  options: HyperbrowserCrawlerOptions,
): Promise<PageArtifact[]> {
  const client = new Hyperbrowser({ apiKey: options.apiKey });
  const session = await client.sessions.create({ acceptCookies: true });

  try {
    const browser = await chromium.connectOverCDP(session.wsEndpoint);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    context.setDefaultTimeout(options.timeoutMs);
    context.setDefaultNavigationTimeout(options.timeoutMs);
    const page = context.pages()[0] ?? (await context.newPage());

    let home = await crawlCloudPage(page, company.url, options, 0);
    if (home.error && company.url.startsWith("https://")) {
      home = await crawlCloudPage(page, company.url.replace(/^https:\/\//i, "http://"), options, 0);
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
        pages.push(await crawlCloudPage(page, relevantLinks[index], options, index + 1));
      }
    }

    await browser.close().catch(() => undefined);
    return pages;
  } finally {
    await client.sessions.stop(session.id).catch(() => undefined);
  }
}

async function crawlCloudPage(
  page: import("playwright-core").Page,
  url: string,
  options: HyperbrowserCrawlerOptions,
  pageIndex: number,
): Promise<PageArtifact> {
  const started = Date.now();
  const parsed = new URL(url);
  const fileStem = `${String(pageIndex + 1).padStart(2, "0")}-${safeName(parsed.hostname + parsed.pathname)}`;
  const htmlPath = path.join(options.outputDir, `${fileStem}.html`);
  const screenshotPath = path.join(options.outputDir, `${fileStem}.png`);

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: Math.min(options.timeoutMs, 8000) }).catch(() => undefined);

    await ensureDir(options.outputDir);
    await page.context().storageState().catch(() => undefined);
    await writeText(htmlPath, await page.content());

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
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeText(pathname: string, data: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(pathname, data, "utf8");
}
