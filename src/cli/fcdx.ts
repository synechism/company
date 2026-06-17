#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { DEFAULT_DATASET_PATH } from "../config.js";
import { appendJsonl } from "../crawl/artifacts.js";
import {
  connectFcdxDb,
  DEFAULT_DB_PATH,
  initializeFcdxDb,
  queryCompanies,
  upsertFirecrawlCache,
} from "../db/fcdx.js";
import { enrichCompanyWithFirecrawl, firecrawlCompanyCacheDir } from "../enrich/firecrawl.js";
import {
  buildAgentJudgedShortlist,
  buildTargetShortlist,
  compareAlsoMentioned,
  compareTargetCompanies,
  readCandidateJsonl,
  readEnrichedJsonl,
  readEnrichedYesCounts,
  readTargetConfig,
  writeAgentShortlistCsv,
  writeCoverageCsv,
  writeShortlistCsv,
} from "../target/companies.js";
import {
  normalizeLinkedinProfileUrl,
  UnipileApiError,
  UnipileClient,
  type LinkedinSearchProfile,
} from "../unipile/client.js";

const program = new Command()
  .name("fcdx")
  .description("Free Company Dataset exploration CLI")
  .version("0.1.0");

const db = program.command("db").description("DuckDB-backed local cache commands");

db.command("init")
  .description("Import the Free Company Dataset CSV into a local DuckDB database")
  .option("-i, --input <path>", "PDL company CSV path", DEFAULT_DATASET_PATH)
  .option("--db <path>", "DuckDB path", DEFAULT_DB_PATH)
  .option("--replace", "Drop and rebuild existing cached tables", false)
  .option("--limit <n>", "Import only N rows for a smoke test", parseIntArg)
  .action(async (options) => {
    try {
      const summary = await initializeFcdxDb({
        dbPath: options.db,
        csvPath: options.input,
        replace: options.replace,
        limit: options.limit,
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

program
  .command("filterby")
  .description("Filter companies from the DuckDB cache")
  .option("--db <path>", "DuckDB path", DEFAULT_DB_PATH)
  .option("--industry <industry...>", "Industry filter; may be repeated or comma-separated")
  .option("--country <country>", "Country filter", "united states")
  .option("--headcount-min <n>", "Minimum employee count", parseIntArg)
  .option("--headcount-max <n>", "Maximum employee count", parseIntArg)
  .option("--company <name>", "Company name or website substring")
  .option("--limit <n>", "Maximum rows to return", parseIntArg, 50)
  .option("-o, --output <path>", "Optional JSONL output path")
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db, { readOnly: true });
    try {
      const rows = await queryCompanies(connection, {
        industry: splitOptionValues(options.industry),
        country: options.country,
        headcountMin: options.headcountMin,
        headcountMax: options.headcountMax,
        company: options.company,
        limit: options.limit,
      });
      if (options.output) {
        await fs.mkdir(path.dirname(options.output), { recursive: true });
        await fs.writeFile(options.output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
      }
      console.log(
        JSON.stringify(
          {
            dbPath: options.db,
            rows: rows.length,
            output: options.output,
            companies: options.output ? rows.slice(0, 10) : rows,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

program
  .command("crawl")
  .description("Enrich one company with Firecrawl, using the local filesystem cache")
  .requiredOption("--company <name>", "Company name or website substring")
  .option("--db <path>", "DuckDB path", DEFAULT_DB_PATH)
  .option("--cache-dir <path>", "Filesystem cache root", "output/cache/firecrawl")
  .option("-o, --output <path>", "Append enriched JSONL output", "output/enriched/fcdx-crawl.jsonl")
  .option("--timeout-ms <n>", "Per-company Firecrawl timeout", parseIntArg, 120_000)
  .option("--force-refresh", "Bypass cached Firecrawl payload and spend a fresh request", false)
  .action(async (options) => {
    if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required");
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const [company] = await queryCompanies(connection, { company: options.company, limit: 1 });
      if (!company) throw new Error(`No company matched ${options.company}. Try fcdx filterby --company='${options.company}'.`);
      const result = await enrichCompanyWithFirecrawl(company, {
        apiKey: process.env.FIRECRAWL_API_KEY,
        outputDir: path.dirname(options.output),
        timeoutMs: options.timeoutMs,
        cacheDir: options.cacheDir,
        forceRefresh: options.forceRefresh,
      });
      await appendJsonl(options.output, result);
      await upsertFirecrawlCache(connection, {
        companyId: company.id,
        companyName: company.name,
        website: company.website,
        url: company.url,
        cacheDir: firecrawlCompanyCacheDir(company, options.cacheDir),
        rawOutputPath: result.agent_metadata.raw_output_path,
        finalUrl: result.agent_metadata.final_url,
        title: result.agent_metadata.title,
        error: result.agent_metadata.error,
        elapsedMs: result.agent_metadata.elapsed_ms,
      });
      console.log(JSON.stringify({ output: options.output, company: company.name, cacheDir: firecrawlCompanyCacheDir(company, options.cacheDir), error: result.agent_metadata.error }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

const linkedin = program.command("linkedin").description("LinkedIn workflows backed by Unipile");

linkedin
  .command("auth")
  .description("Create a Unipile hosted-auth URL for connecting a LinkedIn account")
  .option("--base-url <url>", "Unipile DSN/base URL", process.env.UNIPILE_BASE_URL)
  .option("--access-token <token>", "Unipile access token", process.env.UNIPILE_ACCESS_TOKEN)
  .option("--expires-minutes <n>", "Hosted-auth link lifetime in minutes", parseIntArg, 60)
  .option("--name <name>", "Optional internal user ID/name echoed by notify_url")
  .option("--notify-url <url>", "Optional webhook URL to receive account_id after success")
  .option("--success-url <url>", "Optional browser redirect URL after success")
  .option("--failure-url <url>", "Optional browser redirect URL after failure")
  .option("--reconnect-account <accountId>", "Reconnect an existing account instead of creating a new one")
  .option("--no-open", "Print the hosted-auth URL without trying to open a browser")
  .action(async (options) => {
    try {
      const client = createUnipileClient(options);
      const url = await client.createHostedAuthLink({
        type: options.reconnectAccount ? "reconnect" : "create",
        providers: ["LINKEDIN"],
        expiresOn: new Date(Date.now() + options.expiresMinutes * 60 * 1000).toISOString(),
        name: options.name,
        notifyUrl: options.notifyUrl,
        successRedirectUrl: options.successUrl,
        failureRedirectUrl: options.failureUrl,
        reconnectAccount: options.reconnectAccount,
      });

      console.log(url);
      if (options.open) {
        const opened = openBrowser(url);
        if (!opened) console.error("Could not open a browser automatically; paste the URL above into a browser.");
      }
    } catch (error) {
      exitWithError(error);
    }
  });

linkedin
  .command("list-profiles")
  .description("Search LinkedIn for employees at a company")
  .requiredOption("--company <name>", "Company name to search")
  .option("--n <n>", "Number of profiles to return", parseIntArg, 5)
  .option("--p <title>", "Optional person/title query, e.g. CEO")
  .option("--api <api>", "LinkedIn search API: classic, sales_navigator, or recruiter", "classic")
  .option("--company-id <id...>", "LinkedIn company parameter ID(s) to use as current-company filter")
  .option("--no-resolve-company", "Do not resolve company name to LinkedIn company IDs before searching")
  .option("--show-company-matches", "Print the LinkedIn company parameter matches used for filtering", false)
  .option("--account-id <accountId>", "Unipile LinkedIn account ID; auto-detected if one LinkedIn account exists")
  .option("--base-url <url>", "Unipile DSN/base URL", process.env.UNIPILE_BASE_URL)
  .option("--access-token <token>", "Unipile access token", process.env.UNIPILE_ACCESS_TOKEN)
  .option("--json", "Print full normalized JSON instead of a table", false)
  .action(async (options) => {
    try {
      if (!["classic", "sales_navigator", "recruiter"].includes(options.api)) {
        throw new Error("--api must be one of classic, sales_navigator, recruiter");
      }

      const client = createUnipileClient(options);
      const accountId = await client.resolveLinkedinAccountId(options.accountId);
      const companyMatches =
        options.resolveCompany && !options.companyId
          ? await client.searchCompanyParameters({
              accountId,
              keywords: options.company,
              service: serviceForApi(options.api),
              limit: 5,
            })
          : [];
      const companyIds = options.companyId ?? bestCompanyIds(options.company, companyMatches);
      if (options.showCompanyMatches) {
        console.error(
          JSON.stringify(
            {
              company: options.company,
              companyIds,
              matches: companyMatches.map((match) => ({ id: match.id, title: match.title })),
            },
            null,
            2,
          ),
        );
      }
      const response = await client.searchLinkedinProfiles({
        accountId,
        company: options.company,
        personTitle: options.p,
        n: options.n,
        api: options.api,
        companyIds,
      });

      const profiles = (response.items ?? []).slice(0, options.n).map(normalizeProfile);
      if (options.json) {
        console.log(JSON.stringify({ accountId, company: options.company, profiles, rawPaging: response.paging }, null, 2));
        return;
      }

      if (profiles.length === 0) {
        console.log("No profiles found.");
        return;
      }

      for (const profile of profiles) {
        console.log(`${profile.name || "(unknown)"}\t${profile.linkedin_url || ""}${profile.headline ? `\t${profile.headline}` : ""}`);
      }
    } catch (error) {
      exitWithError(error);
    }
  });

const target = program.command("target").description("Target-category comparison and shortlist commands");

target
  .command("compare")
  .description("Compare PDF target companies against the candidate pool")
  .option("--config <path>", "Target company/category config", "config/target_companies_and_categories.json")
  .option("--candidates <path>", "Candidate JSONL path", "output/candidates/db-strict.jsonl")
  .option("-o, --output <path>", "JSON summary output path", "output/target/doc-company-coverage.json")
  .option("--csv-output <path>", "CSV coverage output path", "output/target/doc-company-coverage.csv")
  .action(async (options) => {
    try {
      const config = await readTargetConfig(options.config);
      const candidates = await readCandidateJsonl(options.candidates);
      const targetMatches = compareTargetCompanies(config, candidates);
      const alsoMentionedMatches = compareAlsoMentioned(config, candidates);
      const matchedTargets = targetMatches.filter((match) => match.matchType !== "none");
      const matchedAlsoMentioned = alsoMentionedMatches.filter((match) => match.matchType !== "none");
      const byCategory = summarizeMatchesByCategory(targetMatches);
      const summary = {
        source: config.source,
        candidates: candidates.length,
        targetCompanies: targetMatches.length,
        targetMatched: matchedTargets.length,
        targetNotMatched: targetMatches.length - matchedTargets.length,
        alsoMentioned: alsoMentionedMatches.length,
        alsoMentionedMatched: matchedAlsoMentioned.length,
        alsoMentionedNotMatched: alsoMentionedMatches.length - matchedAlsoMentioned.length,
        byCategory,
        matches: targetMatches,
        missing: targetMatches.filter((match) => match.matchType === "none").map((match) => match.targetName),
        alsoMentionedMatches,
      };
      await fs.mkdir(path.dirname(options.output), { recursive: true });
      await fs.writeFile(options.output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      await writeCoverageCsv(options.csvOutput, targetMatches);
      console.log(
        JSON.stringify(
          {
            output: options.output,
            csvOutput: options.csvOutput,
            candidates: candidates.length,
            targetMatched: `${summary.targetMatched}/${summary.targetCompanies}`,
            alsoMentionedMatched: `${summary.alsoMentionedMatched}/${summary.alsoMentioned}`,
            byCategory,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      exitWithError(error);
    }
  });

target
  .command("shortlist")
  .description("Create a deterministic pre-rank matching the PDF target categories")
  .option("--config <path>", "Target company/category config", "config/target_companies_and_categories.json")
  .option("--candidates <path>", "Candidate JSONL path", "output/candidates/db-strict.jsonl")
  .option("--enriched <path>", "Optional enriched JSONL whose 5-question yes-counts should boost scoring", "output/enriched/electrical800-construction700.jsonl")
  .option("--limit <n>", "Number of shortlist rows", parseIntArg, 200)
  .option("-o, --output <path>", "JSONL shortlist output path", "output/target/shortlist-200.jsonl")
  .option("--csv-output <path>", "CSV shortlist output path", "output/target/shortlist-200.csv")
  .action(async (options) => {
    try {
      const config = await readTargetConfig(options.config);
      const candidates = await readCandidateJsonl(options.candidates);
      const enrichedYesCounts = await readEnrichedYesCounts(options.enriched);
      const rows = buildTargetShortlist(config, candidates, {
        limit: options.limit,
        enrichedYesCounts,
      });
      await fs.mkdir(path.dirname(options.output), { recursive: true });
      await fs.writeFile(options.output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
      await writeShortlistCsv(options.csvOutput, rows);
      console.log(
        JSON.stringify(
          {
            output: options.output,
            csvOutput: options.csvOutput,
            candidates: candidates.length,
            shortlistRows: rows.length,
            enrichedRowsUsed: enrichedYesCounts.size,
            categoryCounts: summarizeShortlistCategories(rows),
            topCompanies: rows.slice(0, 10).map((row) => ({
              score: row.score,
              name: row.candidate.name,
              industry: row.candidate.industry,
              size: row.candidate.size,
              categories: row.categories,
            })),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      exitWithError(error);
    }
  });

target
  .command("rank-enriched")
  .description("Sort agent-enriched companies by the agent's target-alignment score")
  .option("--config <path>", "Target company/category config", "config/target_companies_and_categories.json")
  .requiredOption("--enriched <path>", "Agent-enriched JSONL path with target_alignment")
  .option("--limit <n>", "Number of rows to write", parseIntArg, 200)
  .option("-o, --output <path>", "JSONL ranked shortlist output path", "output/target/agent-shortlist-200.jsonl")
  .option("--csv-output <path>", "CSV ranked shortlist output path", "output/target/agent-shortlist-200.csv")
  .action(async (options) => {
    try {
      const config = await readTargetConfig(options.config);
      const enrichedRows = await readEnrichedJsonl(options.enriched);
      const enrichedRowsWithTargetAlignment = enrichedRows.filter((row) => row.enrichment.target_alignment).length;
      if (enrichedRowsWithTargetAlignment === 0) {
        console.error("Warning: no rows contain enrichment.target_alignment; rerun enrichment with the current schema before using this as a final shortlist.");
      }
      const rows = buildAgentJudgedShortlist(config, enrichedRows, { limit: options.limit });
      await fs.mkdir(path.dirname(options.output), { recursive: true });
      await fs.writeFile(options.output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
      await writeAgentShortlistCsv(options.csvOutput, rows);
      console.log(
        JSON.stringify(
          {
            output: options.output,
            csvOutput: options.csvOutput,
            enrichedRows: enrichedRows.length,
            enrichedRowsWithTargetAlignment,
            shortlistRows: rows.length,
            topCompanies: rows.slice(0, 10).map((row) => ({
              score: row.score,
              priority: row.priority,
              name: row.source_row.name,
              industry: row.source_row.industry,
              size: row.source_row.size,
              categories: row.categories,
            })),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      exitWithError(error);
    }
  });

await program.parseAsync(process.argv);

function createUnipileClient(options: { baseUrl?: string; accessToken?: string }): UnipileClient {
  if (!options.baseUrl) throw new Error("UNIPILE_BASE_URL or --base-url is required");
  if (!options.accessToken) throw new Error("UNIPILE_ACCESS_TOKEN or --access-token is required");
  return new UnipileClient({ baseUrl: options.baseUrl, accessToken: options.accessToken });
}

function normalizeProfile(profile: LinkedinSearchProfile): Record<string, unknown> {
  const url = normalizeLinkedinProfileUrl(profile);
  return {
    name: profile.name ?? [profile.first_name, profile.last_name].filter(Boolean).join(" "),
    linkedin_url: url,
    headline: profile.headline,
    location: profile.location,
    public_identifier: profile.public_identifier,
    id: profile.id,
  };
}

function serviceForApi(api: "classic" | "sales_navigator" | "recruiter"): "CLASSIC" | "SALES_NAVIGATOR" | "RECRUITER" {
  if (api === "sales_navigator") return "SALES_NAVIGATOR";
  if (api === "recruiter") return "RECRUITER";
  return "CLASSIC";
}

function bestCompanyIds(company: string, matches: Array<{ id?: string; title?: string }>): string[] {
  const normalizedCompany = normalizeForMatch(company);
  const exact = matches.filter((match) => match.id && normalizeForMatch(match.title ?? "") === normalizedCompany);
  if (exact.length > 0) return exact.map((match) => match.id as string);

  const contains = matches.filter((match) => {
    if (!match.id || !match.title) return false;
    const title = normalizeForMatch(match.title);
    return title.includes(normalizedCompany) || normalizedCompany.includes(title);
  });
  if (contains.length > 0) return [contains[0].id as string];

  return matches[0]?.id ? [matches[0].id] : [];
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|company|co)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function openBrowser(url: string): boolean {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function splitOptionValues(values: string[] | undefined): string[] | undefined {
  const split = (values ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  return split.length ? split : undefined;
}

function summarizeMatchesByCategory(matches: ReturnType<typeof compareTargetCompanies>): Record<string, { total: number; matched: number }> {
  const summary: Record<string, { total: number; matched: number }> = {};
  for (const match of matches) {
    const category = match.category ?? "uncategorized";
    summary[category] ??= { total: 0, matched: 0 };
    summary[category].total += 1;
    if (match.matchType !== "none") summary[category].matched += 1;
  }
  return summary;
}

function summarizeShortlistCategories(rows: ReturnType<typeof buildTargetShortlist>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const category of row.categories) counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

function exitWithError(error: unknown): never {
  if (error instanceof UnipileApiError) {
    console.error(error.message);
    console.error(JSON.stringify(error.body, null, 2));
    if (
      error.body &&
      typeof error.body === "object" &&
      (error.body as Record<string, unknown>).type === "errors/no_client_session"
    ) {
      console.error("Hint: verify UNIPILE_BASE_URL is the tenant DSN from the Unipile dashboard and that the API workspace is active.");
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
