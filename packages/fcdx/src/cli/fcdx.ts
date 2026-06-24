#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import type { DuckDBConnection } from "@duckdb/node-api";
import pLimit from "p-limit";
import {
  activeProfile,
  activeProfileName,
  applyFcdxConfigEnv,
  fcdxConfigPath,
  loadFcdxConfig,
  resolveDatasetPath,
  resolveDbPath,
  resolveConfigEnv,
  resolveFirecrawlCacheDir,
  resolveParquetPath,
  saveFcdxConfig,
  setActiveProfile,
  type FcdxConfig,
  type FcdxProfile,
} from "../config.js";
import { appendJsonl, safeName } from "../crawl/artifacts.js";
import type { CandidateCompany } from "../types.js";
import type { EnrichedCompany } from "../types.js";
import {
  connectFcdxDb,
  exportCompaniesParquet,
  initializeFcdxDb,
  queryCompanies,
  upsertFirecrawlCache,
} from "../db/fcdx.js";
import {
  addCompaniesToList,
  addCompaniesFromJsonlToList,
  addCompanyQueryToList,
  addTagToCompany,
  AmbiguousCompanyMatchError,
  createList,
  createTag,
  defineListField,
  deleteList,
  ensureList,
  listFields,
  listLists,
  listStats,
  listTags,
  migrateWorkspace,
  NoCompanyMatchError,
  removeCompanyFromList,
  removeTagFromCompany,
  resolveCompanyId,
  setListFieldValue,
  showList,
  tagStats,
} from "../db/workspace.js";
import { runBatchEnrichment } from "../enrich/batch.js";
import { enrichCompanyWithFirecrawl, firecrawlCompanyCacheDir } from "../enrich/firecrawl.js";
import {
  HunterApiError,
  HunterClient,
  linkedinHandleFromUrl,
  type HunterDomainSearchEmail,
  type HunterEmailFinderData,
  type HunterEmailVerifierData,
} from "../hunter/client.js";
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
  type UnipileAccount,
  type LinkedinSearchProfile,
} from "../unipile/client.js";
import { DeepResearchApiError, DeepResearchClient, type DeepResearchSubmitOptions } from "../deepresearch/client.js";

applyFcdxConfigEnv();

const program = new Command()
  .name("fcdx")
  .description("Free Company Dataset exploration CLI")
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Examples:
  fcdx config init --parquet /data/free_company_dataset.parquet --force
  fcdx db init --replace
  fcdx filterby --industry "construction" --limit 25
  fcdx list create --list thermal-cooling
  fcdx crawl --company-id pdl_company_id_here

Run "fcdx <command> --help" for command-specific examples and options.
`,
  );

const config = program
  .command("config")
  .description("Manage local FCD-X configuration")
  .addHelpText(
    "after",
    `
Examples:
  fcdx config init --parquet /data/free_company_dataset.parquet --force
  fcdx config env set FIRECRAWL_API_KEY fc-...
  fcdx config env set UNIPILE_BASE_URL https://api51.unipile.com:18107
  fcdx config env list
  fcdx config show

Subcommand options:
  fcdx config init --help
  fcdx config env set --help
  fcdx config env list --help
`,
  );

config
  .command("path")
  .description("Print the config file path")
  .addHelpText(
    "after",
    `
Example:
  fcdx config path
`,
  )
  .action(() => {
    console.log(fcdxConfigPath());
  });

config
  .command("show")
  .description("Show resolved FCD-X configuration")
  .option("--show-secrets", "Show stored credential values instead of masking them", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx config show
  fcdx config show --show-secrets
`,
  )
  .action((options) => {
    const config = loadFcdxConfig();
    console.log(
      JSON.stringify(
        {
          configPath: fcdxConfigPath(),
          config: maskConfig(config, { showSecrets: options.showSecrets }),
          resolved: {
            dbPath: resolveDbPath(),
            datasetPath: resolveDatasetPath(),
            parquetPath: resolveParquetPath(),
            firecrawlCacheDir: resolveFirecrawlCacheDir(),
            deepresearchApiUrl: resolveDeepResearchApiUrl(),
          },
        },
        null,
        2,
      ),
    );
  });

config
  .command("init")
  .description("Create or update the local FCD-X config JSON")
  .option("--path <path>", "Config file path", fcdxConfigPath())
  .option("--db <path>", "Default DuckDB path")
  .option("--dataset <path>", "Default PDL company CSV path")
  .option("--parquet <path>", "Default PDL company Parquet path")
  .option("--firecrawl-cache-dir <path>", "Default Firecrawl filesystem cache root")
  .option("--force", "Overwrite existing keys with provided values", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx config init --parquet /data/free_company_dataset.parquet --force
  fcdx config init --dataset /data/free_company_dataset.csv --db ~/.local/share/fcdx/fcdx.duckdb --force
  fcdx config init --firecrawl-cache-dir ~/.local/share/fcdx/cache/firecrawl
`,
  )
  .action(async (options) => {
    try {
      const existing = loadFcdxConfig(options.path);
      const next: FcdxConfig = { ...existing };
      if (options.db || !next.dbPath) next.dbPath = options.db ?? next.dbPath ?? resolveDbPath();
      if (options.dataset) next.datasetPath = path.resolve(options.dataset);
      if (options.parquet) next.parquetPath = path.resolve(options.parquet);
      if (options.force && options.dataset && !options.parquet) delete next.parquetPath;
      if (options.force && options.parquet && !options.dataset) delete next.datasetPath;
      if (options.firecrawlCacheDir || !next.firecrawlCacheDir) {
        next.firecrawlCacheDir = options.firecrawlCacheDir ?? next.firecrawlCacheDir ?? resolveFirecrawlCacheDir();
      }
      await fs.mkdir(path.dirname(options.path), { recursive: true });
      await fs.writeFile(options.path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ configPath: options.path, config: next }, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

const configEnv = config
  .command("env")
  .description("Store and inspect environment-style settings in the FCD-X config file")
  .addHelpText(
    "after",
    `
Examples:
  fcdx config env set FIRECRAWL_API_KEY fc-...
  fcdx config env list
  fcdx config env unset FIRECRAWL_API_KEY

Subcommand options:
  fcdx config env set --help
  fcdx config env list --help
  fcdx config env unset --help
`,
  );

configEnv
  .command("set <name> <value>")
  .description("Store an environment variable in the FCD-X config, e.g. FIRECRAWL_API_KEY")
  .option("--path <path>", "Config file path", fcdxConfigPath())
  .addHelpText(
    "after",
    `
Examples:
  fcdx config env set FIRECRAWL_API_KEY fc-...
  fcdx config env set UNIPILE_BASE_URL https://api51.unipile.com:18107
  fcdx config env set UNIPILE_ACCESS_TOKEN <token>
  fcdx config env set API_URL http://127.0.0.1:8787
`,
  )
  .action((name, value, options) => {
    const current = loadFcdxConfig(options.path);
    const next: FcdxConfig = { ...current, env: { ...(current.env ?? {}), [name]: value } };
    saveFcdxConfig(next, options.path);
    console.log(JSON.stringify({ configPath: options.path, env: { [name]: maskSecret(value) } }, null, 2));
  });

configEnv
  .command("unset <name>")
  .description("Remove an environment variable from the FCD-X config")
  .option("--path <path>", "Config file path", fcdxConfigPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx config env unset FIRECRAWL_API_KEY
`,
  )
  .action((name, options) => {
    const current = loadFcdxConfig(options.path);
    const env = { ...(current.env ?? {}) };
    const existed = Object.prototype.hasOwnProperty.call(env, name);
    delete env[name];
    const next: FcdxConfig = { ...current, env };
    saveFcdxConfig(next, options.path);
    console.log(JSON.stringify({ configPath: options.path, unset: name, existed }, null, 2));
  });

configEnv
  .command("list")
  .description("List environment variables stored in config; values are masked by default")
  .option("--path <path>", "Config file path", fcdxConfigPath())
  .option("--show-secrets", "Print raw secret values", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx config env list
  fcdx config env list --show-secrets
`,
  )
  .action((options) => {
    const env = loadFcdxConfig(options.path).env ?? {};
    const shown = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, options.showSecrets ? value : maskSecret(value)]),
    );
    console.log(JSON.stringify({ configPath: options.path, env: shown }, null, 2));
  });

const profile = program
  .command("profile")
  .description("Manage local user profiles, including the default LinkedIn account for this user")
  .addHelpText(
    "after",
    `
Examples:
  fcdx profile show
  fcdx profile use --profile tom
  fcdx linkedin auth --profile tom

Subcommand options:
  fcdx profile show --help
  fcdx profile use --help
`,
  );

profile
  .command("show")
  .description("Show the active local profile; hidden account IDs remain masked")
  .option("--show-secrets", "Show stored account IDs", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx profile show
  fcdx profile show --show-secrets
`,
  )
  .action((options) => {
    const config = loadFcdxConfig();
    const name = activeProfileName(config);
    const current = activeProfile(config);
    console.log(
      JSON.stringify(
        {
          currentProfile: name,
          profile: options.showSecrets ? current : maskProfile(current),
        },
        null,
        2,
      ),
    );
  });

profile
  .command("use [name]")
  .description("Switch the active local profile, creating it if needed")
  .option("--profile <name>", "Profile name")
  .addHelpText(
    "after",
    `
Examples:
  fcdx profile use --profile default
  fcdx profile use --profile tom
`,
  )
  .action((name, options) => {
    const profileName = resolveNamedArg("profile", name, options.profile);
    const next = setActiveProfile(profileName, { name: profileName });
    console.log(JSON.stringify({ currentProfile: activeProfileName(next), profile: maskProfile(activeProfile(next)) }, null, 2));
  });

const db = program
  .command("db")
  .description("DuckDB-backed local cache commands")
  .addHelpText(
    "after",
    `
Examples:
  fcdx db init --csv /data/free_company_dataset.csv --replace
  fcdx db init --parquet /data/free_company_dataset.parquet --replace
  fcdx db migrate
  fcdx db export-parquet --output /data/free_company_dataset.parquet

Subcommand options:
  fcdx db init --help
  fcdx db export-parquet --help
  fcdx db migrate --help
`,
  );

db.command("init")
  .description("Import the Free Company Dataset CSV or Parquet into a local DuckDB database")
  .option("--csv <path>", "PDL company CSV path")
  .option("-i, --input <path>", "Alias for --csv")
  .option("--parquet <path>", "PDL company Parquet path")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--replace", "Drop and rebuild existing cached tables", false)
  .option("--limit <n>", "Import only N rows for a smoke test", parseIntArg)
  .addHelpText(
    "after",
    `
Examples:
  fcdx db init --replace
  fcdx db init --csv /data/free_company_dataset.csv --replace
  fcdx db init --parquet /data/free_company_dataset.parquet --replace
  fcdx db init --parquet /data/free_company_dataset.parquet --limit 1000 --replace
`,
  )
  .action(async (options) => {
    try {
      const configuredParquet = resolveParquetPath();
      const configuredCsv = resolveDatasetPath();
      const sourcePath = options.parquet ?? options.csv ?? options.input ?? configuredParquet ?? configuredCsv;
      const sourceType = options.parquet || (!options.csv && !options.input && configuredParquet)
        ? "parquet"
        : "csv";
      if (!sourcePath) throw new Error("Provide --csv or --parquet, or configure datasetPath/parquetPath with fcdx config init");
      await fs.access(sourcePath);
      const summary = await initializeFcdxDb({
        dbPath: options.db,
        sourcePath,
        sourceType,
        replace: options.replace,
        limit: options.limit,
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

db.command("export-parquet")
  .description("Export the current companies table as a shippable Parquet artifact")
  .requiredOption("-o, --output <path>", "Output Parquet path")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--compression <type>", "Parquet compression: zstd, snappy, or uncompressed", "zstd")
  .addHelpText(
    "after",
    `
Examples:
  fcdx db export-parquet --output /data/free_company_dataset.parquet
  fcdx db export-parquet --db ~/.local/share/fcdx/fcdx.duckdb --output /tmp/fcdx.parquet --compression snappy
`,
  )
  .action(async (options) => {
    try {
      if (!["zstd", "snappy", "uncompressed"].includes(options.compression)) {
        throw new Error("--compression must be zstd, snappy, or uncompressed");
      }
      const summary = await exportCompaniesParquet({
        dbPath: options.db,
        outputPath: options.output,
        compression: options.compression,
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

db.command("migrate")
  .description("Create or update FCD-X workspace tables without touching the source companies table")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx db migrate
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      await migrateWorkspace(connection);
      console.log(JSON.stringify({ dbPath: options.db, migrated: true }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

program
  .command("filterby")
  .description("Filter companies from the DuckDB cache")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--industry <industry...>", "Industry filter; may be repeated or comma-separated")
  .option("--country <country>", "Country filter", "united states")
  .option("--headcount-min <n>", "Minimum employee count", parseIntArg)
  .option("--headcount-max <n>", "Maximum employee count", parseIntArg)
  .option("--company <name>", "Company name or website substring")
  .option("--limit <n>", "Maximum rows to return", parseIntArg, 50)
  .option("-o, --output <path>", "Optional JSONL output path")
  .option("--to-list <name>", "Add all filtered rows to a durable list")
  .option("--create-list", "Create --to-list when it does not exist", false)
  .option("--list-description <text>", "Description to use when creating --to-list")
  .option("--source <source>", "Source/provenance label when adding rows to --to-list")
  .option("--reason <reason>", "Reason to store on list memberships created by --to-list")
  .addHelpText(
    "after",
    `
Examples:
  fcdx filterby --company "SMTC"
  fcdx filterby --industry "construction" --headcount-min 200 --headcount-max 10000 --limit 100
  fcdx filterby --industry "construction,electrical/electronic manufacturing" --output output/candidates/targets.jsonl
  fcdx filterby --industry "construction" --to-list construction-targets --create-list --limit 500
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db, { readOnly: !options.toList });
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
      const listResult = options.toList
        ? await addFilteredRowsToList(connection, {
            listName: options.toList,
            rows,
            createList: options.createList,
            description: options.listDescription,
            source: options.source,
            reason: options.reason,
          })
        : undefined;
      console.log(
        JSON.stringify(
          {
            dbPath: options.db,
            rows: rows.length,
            output: options.output,
            list: listResult,
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
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id>", "Exact PDL company id; preferred when the name is ambiguous")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--country <country>", "Country filter; pass '*' to search globally", "united states")
  .option("--cache-dir <path>", "Filesystem cache root", resolveFirecrawlCacheDir())
  .option("-o, --output <path>", "Append enriched JSONL output", "output/enriched/fcdx-crawl.jsonl")
  .option("--timeout-ms <n>", "Per-company Firecrawl timeout", parseIntArg, 45_000)
  .option("--force-refresh", "Bypass cached Firecrawl payload and spend a fresh request", false)
  .option("--full-page", "Scrape the full page instead of Firecrawl main-content mode; slower", false)
  .option("--include-html", "Cache HTML artifacts; slower and heavier", false)
  .option("--include-screenshot", "Cache screenshot artifacts; much slower and heavier", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx crawl --company "SMTC"
  fcdx crawl --company-id pdl_company_id_here --output output/enriched/smtc.jsonl
  fcdx crawl --company-id pdl_company_id_here --include-html --include-screenshot
  fcdx crawl --company-id pdl_company_id_here --force-refresh

If --company matches multiple rows, retry with the company id printed in the
ambiguity response.
`,
  )
  .action(async (options) => {
    const firecrawlApiKey = resolveConfigEnv("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY is required. Set it with `fcdx config env set FIRECRAWL_API_KEY <key>` or export it.");
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const country = options.country === "*" ? undefined : options.country;
      const company = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      const result = await enrichCompanyWithFirecrawl(company, {
        apiKey: firecrawlApiKey,
        outputDir: path.dirname(options.output),
        timeoutMs: options.timeoutMs,
        cacheDir: options.cacheDir,
        forceRefresh: options.forceRefresh,
        fullPage: options.fullPage,
        includeHtml: options.includeHtml,
        includeScreenshot: options.includeScreenshot,
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

const enrich = program.command("enrich").description("Batch Firecrawl enrichment over candidate JSONL");
enrich.addHelpText(
  "after",
  `
Examples:
  fcdx enrich file --input output/candidates/targets.jsonl --output output/enriched/targets.jsonl
  fcdx enrich list --list water-infra --question "Does this company manufacture water valves?"
  fcdx enrich file --help
  fcdx enrich list --help
`,
);

enrich
  .command("file")
  .alias("jsonl")
  .description("Enrich companies from a candidate JSONL file and write file-backed JSONL/CSV outputs")
  .option("-i, --input <path>", "Candidate JSONL path", "output/candidates/strict.jsonl")
  .option("-o, --output <path>", "Output enriched JSONL path", "output/enriched/enriched.jsonl")
  .option("--summary <path>", "Output summary JSON path", "output/enriched/summary.json")
  .option("--csv-output <path>", "Optional flattened CSV output path")
  .option("--limit <n>", "Maximum companies to enrich", parseIntArg)
  .option("--offset <n>", "Skip this many candidates before enriching", parseIntArg, 0)
  .option("--concurrency <n>", "Parallel Firecrawl requests", parseIntArg, Number(process.env.CRAWL_CONCURRENCY ?? 10))
  .option("--timeout-ms <n>", "Per-company Firecrawl timeout", parseIntArg, 45_000)
  .option("--cache-dir <path>", "Firecrawl filesystem cache root", resolveFirecrawlCacheDir())
  .option("--force-refresh", "Bypass cached Firecrawl payloads", false)
  .option("--full-page", "Scrape full pages instead of Firecrawl main-content mode; slower", false)
  .option("--include-html", "Cache HTML artifacts; slower and heavier", false)
  .option("--include-screenshot", "Cache screenshot artifacts; much slower and heavier", false)
  .option("--question <text>", "Experiment-specific yes/no question to answer for every company")
  .option("--prompt <text>", "Alias for --question; use for task-specific enrichment criteria")
  .option("--website <host...>", "Only enrich candidates matching these websites/domains")
  .option("--resume", "Keep existing output JSONL and skip source ids already present", false)
  .option("--progress-every <n>", "Log progress every N completed companies", parseIntArg, 25)
  .addHelpText(
    "after",
    `
Examples:
  fcdx enrich file --input output/candidates/targets.jsonl --output output/enriched/targets.jsonl --summary output/enriched/targets-summary.json
  fcdx enrich file --input output/candidates/targets.jsonl --limit 25 --concurrency 20 --resume
  fcdx enrich file --input output/candidates/water-infra.jsonl --question "Does this company manufacture water valves or waterworks flow-control valves?"
  fcdx enrich file --input output/candidates/targets.jsonl --website smtc.com tateglobal.com
  fcdx enrich file --input output/candidates/targets.jsonl --include-html --include-screenshot
`,
  )
  .action(async (options) => {
    try {
      const firecrawlApiKey = resolveConfigEnv("FIRECRAWL_API_KEY");
      if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY is required. Set it with `fcdx config env set FIRECRAWL_API_KEY <key>` or export it.");
      const customQuestion = resolveCustomQuestion(options.question, options.prompt);
      const summary = await runBatchEnrichment({
        apiKey: firecrawlApiKey,
        input: options.input,
        output: options.output,
        summary: options.summary,
        csvOutput: options.csvOutput,
        limit: options.limit,
        offset: options.offset,
        concurrency: options.concurrency,
        timeoutMs: options.timeoutMs,
        cacheDir: options.cacheDir,
        forceRefresh: options.forceRefresh,
        customQuestion,
        fullPage: options.fullPage,
        includeHtml: options.includeHtml,
        includeScreenshot: options.includeScreenshot,
        website: options.website,
        resume: options.resume,
        progressEvery: options.progressEvery,
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

enrich
  .command("list")
  .description("Enrich every company in a durable list and write the result into list-local fields")
  .requiredOption("--list <name>", "List name")
  .requiredOption("--question <text>", "Experiment-specific yes/no question to answer for every company")
  .option("--field <key>", "List field key that stores the full enrichment object", "enrichment")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--limit <n>", "Maximum list members to enrich", parseIntArg)
  .option("--concurrency <n>", "Parallel crawl/enrichment requests", parseIntArg, Number(process.env.CRAWL_CONCURRENCY ?? 10))
  .option("--timeout-ms <n>", "Per-company crawl/enrichment timeout", parseIntArg, 45_000)
  .option("--cache-dir <path>", "Firecrawl filesystem cache root", resolveFirecrawlCacheDir())
  .option("--force-refresh", "Bypass cached raw page payloads and crawl fresh pages", false)
  .option("--full-page", "Scrape full pages instead of Firecrawl main-content mode; slower", false)
  .option("--include-html", "Cache HTML artifacts; slower and heavier", false)
  .option("--include-screenshot", "Cache screenshot artifacts; much slower and heavier", false)
  .option("--no-skip-existing", "Re-enrich list members that already have the target --field")
  .option("--progress-every <n>", "Log progress every N completed companies", parseIntArg, 25)
  .option("--jsonl-output <path>", "Optional debug JSONL copy of enriched rows")
  .addHelpText(
    "after",
    `
Examples:
  fcdx enrich list --list water-infra --question "Does this company manufacture water valves?"
  fcdx enrich list --list thermal --field thermal_enrichment --question "Does this company manufacture thermal or cooling equipment?" --concurrency 40
  fcdx enrich list --list water-infra --field water_valve_enrichment --question "Does this company manufacture water valves?" --no-skip-existing
  fcdx list show --list water-infra --limit 10

This command does not require an intermediate JSONL file. It stores a full
enrichment object in the list-local field named by --field. The raw Firecrawl
page cache is per company; the prompt-specific answer is list-local DB state.
It uses Firecrawl for both raw page caching and prompt-specific extraction.
By default this uses the fast path: markdown plus Firecrawl JSON extraction,
main-content mode, no HTML, and no screenshot. Add --include-html,
--include-screenshot, or --full-page only when you need heavier artifacts.
By default it skips members that already have the target --field so large runs
can be resumed safely.
`,
  )
  .action(async (options) => {
    const started = Date.now();
    let readInstance: Awaited<ReturnType<typeof connectFcdxDb>>["instance"] | undefined;
    let readConnection: Awaited<ReturnType<typeof connectFcdxDb>>["connection"] | undefined;
    try {
      const firecrawlApiKey = resolveConfigEnv("FIRECRAWL_API_KEY");
      if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY is required. Set it with `fcdx config env set FIRECRAWL_API_KEY <key>` or export it.");
      const connected = await connectFcdxDb(options.db);
      readInstance = connected.instance;
      readConnection = connected.connection;
      const data = await showList(readConnection, { listName: options.list, limit: options.limit });
      readConnection.closeSync();
      readInstance.closeSync();
      readConnection = undefined;
      readInstance = undefined;

      if (data.members.length === 0) throw new Error(`List has no members: ${options.list}`);
      const skippedExisting = options.skipExisting
        ? data.members.filter((member) => hasListField(member.fields, options.field)).length
        : 0;
      const members = options.skipExisting
        ? data.members.filter((member) => !hasListField(member.fields, options.field))
        : data.members;
      if (members.length === 0) {
        console.log(
          JSON.stringify(
            {
              list: options.list,
              field: options.field,
              companies: 0,
              skippedExisting,
              question: options.question,
              elapsedMs: Date.now() - started,
            },
            null,
            2,
          ),
        );
        return;
      }
      const { instance: writeInstance, connection: writeConnection } = await connectFcdxDb(options.db);
      const limiter = pLimit(options.concurrency);
      const writeLimiter = pLimit(1);
      const results: EnrichedCompany[] = [];
      let completed = 0;
      let errors = 0;
      try {
        await Promise.all(
          members.map((member) =>
            limiter(async () => {
              const result = await enrichCompanyWithFirecrawl(member.company, {
                apiKey: firecrawlApiKey,
                outputDir: options.jsonlOutput ? path.dirname(options.jsonlOutput) : "output/enriched",
                timeoutMs: options.timeoutMs,
                cacheDir: options.cacheDir,
                forceRefresh: options.forceRefresh,
                customQuestion: options.question,
                fullPage: options.fullPage,
                includeHtml: options.includeHtml,
                includeScreenshot: options.includeScreenshot,
              });
              await writeLimiter(async () => {
                results.push(result);
                if (result.agent_metadata.error) errors += 1;
                if (options.jsonlOutput) await appendJsonl(options.jsonlOutput, result);
                await setListFieldValue(writeConnection, {
                  listName: options.list,
                  companyId: result.source_row.id,
                  fieldKey: options.field,
                  value: listEnrichmentValue(result),
                  fieldType: "object",
                  description: `Enrichment result for: ${options.question}`,
                  source: "enrich:list",
                  confidence: result.enrichment.custom_evaluation?.confidence,
                });
                await upsertFirecrawlCache(writeConnection, {
                  companyId: result.source_row.id,
                  companyName: result.source_row.name,
                  website: result.source_row.website,
                  url: result.agent_metadata.url,
                  cacheDir: result.agent_metadata.cache_dir ?? path.join(options.cacheDir, result.source_row.id),
                  rawOutputPath: result.agent_metadata.raw_output_path,
                  finalUrl: result.agent_metadata.final_url,
                  title: result.agent_metadata.title,
                  error: result.agent_metadata.error,
                  elapsedMs: result.agent_metadata.elapsed_ms,
                });
                completed += 1;
                if (options.progressEvery > 0 && (completed % options.progressEvery === 0 || completed === members.length)) {
                  console.error(`enriched ${completed}/${members.length} errors=${errors} skipped_existing=${skippedExisting}`);
                }
              });
            }),
          ),
        );
      } finally {
        writeConnection.closeSync();
        writeInstance.closeSync();
      }

      console.log(
        JSON.stringify(
          {
            list: options.list,
            field: options.field,
            companies: results.length,
            skippedExisting,
            errors,
            question: options.question,
            jsonlOutput: options.jsonlOutput,
            elapsedMs: Date.now() - started,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      exitWithError(error);
    } finally {
      readConnection?.closeSync();
      readInstance?.closeSync();
    }
  });

const list = program
  .command("list")
  .description("Create and manage durable company lists")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list create --list targets --description "Priority companies"
  fcdx list add --list targets --company "SMTC"
  fcdx list add --list targets --company-id pdl_company_id_here
  fcdx list add --list targets --from-jsonl output/candidates/db-strict.jsonl --limit 100
  fcdx list set-field --list targets --field ceo_name --type person
  fcdx list set-field --list targets --company-id pdl_company_id_here --field ceo_name --value "Jane Doe"
  fcdx list delete-entry --list targets --company-id pdl_company_id_here
  fcdx list export --list targets --format csv --output output/lists/targets.csv
  fcdx list show --list targets --limit 25

Subcommand options:
  fcdx list create --help
  fcdx list add --help
  fcdx list delete-entry --help
  fcdx list export --help
  fcdx list set-field --help
  fcdx list show --help
  fcdx list delete --help
`,
  );

list
  .command("create [name]")
  .description("Create a durable list without modifying the source companies table")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--description <text>", "List description")
  .option("--metadata-json <json>", "Optional JSON metadata for the list")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list create --list targets
  fcdx list create --list thermal-cooling --description "Cooling and thermal companies"
  fcdx list create --list targets --metadata-json '{"owner":"sales","priority":"high"}'
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const listName = resolveListName(name, options.list);
      const created = await createList(connection, {
        name: listName,
        description: options.description,
        metadata: parseJsonOption(options.metadataJson),
      });
      console.log(JSON.stringify({ list: created }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("ls")
  .alias("list")
  .description("List durable company lists")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx list ls
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify({ lists: await listLists(connection) }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("delete [name]")
  .description("Delete a list and its list-specific fields; does not delete companies")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--yes", "Confirm deletion", false)
  .addHelpText(
    "after",
    `
Example:
  fcdx list delete --list targets --yes
`,
  )
  .action(async (name, options) => {
    if (!options.yes) throw new Error("Refusing to delete without --yes");
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify({ deleted: await deleteList(connection, resolveListName(name, options.list)) }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("add [name]")
  .description("Add companies to a list by unambiguous company name, company id, or candidate JSONL")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id>", "Exact PDL company id to add; preferred when the name is ambiguous")
  .option("--from-jsonl <path>", "Candidate JSONL file to add")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .option("--limit <n>", "Max companies to add from --from-jsonl", parseIntArg)
  .option("--source <source>", "Source/provenance label for membership")
  .option("--reason <reason>", "Reason this company/list batch was added")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list add --list targets --company "SMTC"
  fcdx list add --list targets --company-id pdl_company_id_here
  fcdx list add --list targets --from-jsonl output/candidates/db-strict.jsonl --limit 100 --source filterby

If --company matches multiple rows, FCD-X prints the candidate rows and exits.
Retry the same command with --company-id using the intended id.
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const listName = resolveListName(name, options.list);
      const country = options.country === "*" ? undefined : options.country;
      if (options.fromJsonl) {
        const result = await addCompaniesFromJsonlToList(connection, {
          listName,
          pathname: options.fromJsonl,
          source: options.source,
          reason: options.reason,
          limit: options.limit,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (options.companyId) {
        const company = await resolveCompanyId(connection, { companyId: options.companyId });
        const result = await addCompaniesToList(connection, {
          listName,
          companies: [company],
          source: options.source ?? "company-id",
          reason: options.reason ?? options.companyId,
        });
        console.log(JSON.stringify({ ...result, matches: [company] }, null, 2));
        return;
      }
      if (options.company) {
        const result = await addCompanyQueryToList(connection, {
          listName,
          company: options.company,
          country,
          source: options.source,
          reason: options.reason,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      throw new Error("Provide --company, --company-id, or --from-jsonl");
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("remove [name]")
  .description("Remove a company from a list without deleting the source company")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id>", "Exact PDL company id")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list remove --list targets --company "SMTC"
  fcdx list remove --list targets --company-id pdl_company_id_here
  fcdx list delete-entry --list targets --company-id pdl_company_id_here
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const listName = resolveListName(name, options.list);
      const country = options.country === "*" ? undefined : options.country;
      const company = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      console.log(JSON.stringify(await removeCompanyFromList(connection, { listName, companyId: company.id }), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("delete-entry [name]")
  .description("Delete one list entry by exact company id; does not delete the source company")
  .option("--list <name>", "List name")
  .requiredOption("--company-id <id>", "Exact PDL company id to remove from this list")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx list delete-entry --list targets --company-id pdl_company_id_here

Use this when --company is ambiguous. It removes list membership and any
list-local field values for that company/list pair only.
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const listName = resolveListName(name, options.list);
      console.log(JSON.stringify(await removeCompanyFromList(connection, { listName, companyId: options.companyId }), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("show [name]")
  .description("Show list members with list-specific fields and global tags")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--limit <n>", "Maximum rows to show", parseIntArg, 50)
  .addHelpText(
    "after",
    `
Examples:
  fcdx list show --list targets
  fcdx list show --list targets --limit 25
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify(await showList(connection, { listName: resolveListName(name, options.list), limit: options.limit }), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("export [name]")
  .description("Export a list to CSV, member JSONL, candidate JSONL, or a flat lead summary CSV")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--format <format>", "Export format: csv, jsonl, candidates-jsonl, or lead-summary", "csv")
  .requiredOption("-o, --output <path>", "Output path")
  .option("--limit <n>", "Maximum rows to export", parseIntArg)
  .addHelpText(
    "after",
    `
Examples:
  fcdx list export --list targets --format csv --output output/lists/targets.csv
  fcdx list export --list targets --format jsonl --output output/lists/targets.jsonl
  fcdx list export --list targets --format lead-summary --output output/lists/targets-leads.csv

  # Candidate JSONL is compatible with fcdx enrich file.
  fcdx list export --list targets --format candidates-jsonl --output output/candidates/targets.jsonl
  fcdx enrich file --input output/candidates/targets.jsonl --question "Does this company manufacture water valves?"
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const listName = resolveListName(name, options.list);
      const data = await showList(connection, { listName, limit: options.limit });
      await writeListExport(options.output, data.members, options.format);
      console.log(JSON.stringify({ list: data.list.name, rows: data.members.length, format: options.format, output: options.output }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("stats [name]")
  .description("Summarize list membership by industry, size, tags, and list-specific fields")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx list stats --list targets
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify(await listStats(connection, resolveListName(name, options.list)), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("set-field [name]")
  .description("Define a list-specific field, or set that field for one company")
  .option("--list <name>", "List name")
  .requiredOption("--field <key>", "List field key")
  .option("--value <value>", "Field value; use --json-value for structured JSON")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id>", "Exact PDL company id; preferred when the name is ambiguous")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .option("--type <type>", "Field type, e.g. string, url, person, number, boolean")
  .option("--description <text>", "Field description")
  .option("--source <source>", "Source/provenance label for the field value")
  .option("--confidence <n>", "Confidence from 0 to 1", parseFloatArg)
  .option("--json-value", "Parse --value as JSON", false)
  .addHelpText(
    "after",
    `
Examples:
  # Define a field for this list only; no companies get a value yet.
  fcdx list set-field --list targets --field ceo_name --type person --description "CEO name"

  # Set the field for one company in this list.
  fcdx list set-field --list targets --company "SMTC" --field ceo_name --value "John Stone" --source linkedin
  fcdx list set-field --list targets --company-id pdl_company_id_here --field ceo_name --value "John Stone"

  # Store a structured value.
  fcdx list set-field --list targets --company-id pdl_company_id_here --field ceo --json-value \\
    --value '{"name":"John Stone","linkedin_url":"https://www.linkedin.com/in/..."}'

If --company matches multiple rows, retry with --company-id from the printed
ambiguity response.
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const listName = resolveListName(name, options.list);
      if (!options.value && (options.company || options.companyId)) {
        throw new Error("Provide --value when setting a field for a company. Omit --company/--company-id to define the field only.");
      }
      if (!options.value) {
        console.log(
          JSON.stringify(
            await defineListField(connection, {
              listName,
              fieldKey: options.field,
              fieldType: options.type,
              description: options.description,
            }),
            null,
            2,
          ),
        );
        return;
      }
      const country = options.country === "*" ? undefined : options.country;
      const company = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      console.log(
        JSON.stringify(
          await setListFieldValue(connection, {
            listName,
            companyId: company.id,
            fieldKey: options.field,
            value: options.jsonValue ? parseJsonOption(options.value) : options.value,
            fieldType: options.type,
            description: options.description,
            source: options.source,
            confidence: options.confidence,
          }),
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

list
  .command("fields [name]")
  .description("List field definitions and value counts for a list")
  .option("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx list fields --list targets
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify(await listFields(connection, resolveListName(name, options.list)), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

const tag = program
  .command("tag")
  .description("Create and manage durable company tags")
  .addHelpText(
    "after",
    `
Examples:
  fcdx tag create --tag buyer:contract_manufacturer --description "Contract manufacturing target"
  fcdx tag add --company "SMTC" --tag buyer:contract_manufacturer --confidence 0.9
  fcdx tag add --company-id pdl_company_id_here --tag priority:high
  fcdx tag list --company "SMTC"
  fcdx tag stats

Subcommand options:
  fcdx tag create --help
  fcdx tag add --help
  fcdx tag list --help
  fcdx tag remove --help
`,
  );

tag
  .command("create [name]")
  .description("Create a tag definition")
  .option("--tag <name>", "Tag name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--description <text>", "Tag description")
  .option("--metadata-json <json>", "Optional JSON metadata for the tag")
  .addHelpText(
    "after",
    `
Examples:
  fcdx tag create --tag buyer:contract_manufacturer
  fcdx tag create --tag category:thermal_cooling --description "Thermal/cooling company"
  fcdx tag create --tag priority:high --metadata-json '{"owner":"sales"}'
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const tagName = resolveNamedArg("tag", name, options.tag);
      console.log(
        JSON.stringify(
          { tag: await createTag(connection, { name: tagName, description: options.description, metadata: parseJsonOption(options.metadataJson) }) },
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

tag
  .command("add")
  .description("Add a tag to one company")
  .requiredOption("--tag <name>", "Tag name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id>", "Exact PDL company id; preferred when the name is ambiguous")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .option("--value <value>", "Optional tag value")
  .option("--source <source>", "Source/provenance label")
  .option("--confidence <n>", "Confidence from 0 to 1", parseFloatArg)
  .option("--reason <reason>", "Reason for the tag")
  .addHelpText(
    "after",
    `
Examples:
  fcdx tag add --company "SMTC" --tag buyer:contract_manufacturer
  fcdx tag add --company "SMTC" --tag category:thermal_cooling --confidence 0.8 --source agent
  fcdx tag add --company-id pdl_company_id_here --tag priority:high --reason "Strong procurement fit"

If --company matches multiple rows, FCD-X prints the candidate rows and exits.
Retry with --company-id using the intended id.
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const country = options.country === "*" ? undefined : options.country;
      const company = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      console.log(
        JSON.stringify(
          await addTagToCompany(connection, {
            companyId: company.id,
            tagName: options.tag,
            value: options.value,
            source: options.source,
            confidence: options.confidence,
            reason: options.reason,
          }),
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

tag
  .command("remove")
  .description("Remove a tag from one company")
  .requiredOption("--tag <name>", "Tag name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id>", "Exact PDL company id")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .addHelpText(
    "after",
    `
Examples:
  fcdx tag remove --company "SMTC" --tag priority:high
  fcdx tag remove --company-id pdl_company_id_here --tag priority:high
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const country = options.country === "*" ? undefined : options.country;
      const company = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      console.log(JSON.stringify(await removeTagFromCompany(connection, { companyId: company.id, tagName: options.tag }), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

tag
  .command("list")
  .description("List all tags, or tags for one company")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id>", "Exact PDL company id")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .addHelpText(
    "after",
    `
Examples:
  fcdx tag list
  fcdx tag list --company "SMTC"
  fcdx tag list --company-id pdl_company_id_here

If --company is ambiguous, use --company-id from the printed match list.
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      if (options.company || options.companyId) {
        const country = options.country === "*" ? undefined : options.country;
        const company = await resolveCompanyId(connection, {
          companyId: options.companyId,
          company: options.company,
          country,
        });
        console.log(JSON.stringify(await listTags(connection, { companyId: company.id }), null, 2));
        return;
      }
      console.log(JSON.stringify(await listTags(connection), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

tag
  .command("stats")
  .description("Show tag usage counts")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx tag stats
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify(await tagStats(connection), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

const linkedin = program
  .command("linkedin")
  .description("LinkedIn workflows backed by Unipile")
  .addHelpText(
    "after",
    `
Examples:
  fcdx config env set UNIPILE_BASE_URL https://api51.unipile.com:18107
  fcdx config env set UNIPILE_ACCESS_TOKEN <token>
  fcdx linkedin auth
  fcdx linkedin accounts
  fcdx linkedin list-profiles --company "cronwell ai" --p CEO --n 5

Subcommand options:
  fcdx linkedin auth --help
  fcdx linkedin accounts --help
  fcdx linkedin use-account --help
  fcdx linkedin list-profiles --help
`,
  );

linkedin
  .command("auth")
  .description("Create a Unipile hosted-auth URL for connecting a LinkedIn account")
  .option("--base-url <url>", "Unipile DSN/base URL; defaults to config env UNIPILE_BASE_URL")
  .option("--access-token <token>", "Unipile access token; defaults to config env UNIPILE_ACCESS_TOKEN")
  .option("--expires-minutes <n>", "Hosted-auth link lifetime in minutes", parseIntArg, 60)
  .option("--name <name>", "Optional internal user ID/name echoed by notify_url")
  .option("--notify-url <url>", "Optional webhook URL to receive account_id after success")
  .option("--success-url <url>", "Optional browser redirect URL after success")
  .option("--failure-url <url>", "Optional browser redirect URL after failure")
  .option("--reconnect-account <accountId>", "Reconnect an existing account instead of creating a new one")
  .option("--profile <name>", "Local FCD-X profile to store the connected LinkedIn account on", activeProfileName())
  .option("--wait-timeout-seconds <n>", "How long to poll Unipile for the connected account", parseIntArg, 180)
  .option("--no-wait", "Do not wait for the browser auth flow to complete")
  .option("--no-open", "Print the hosted-auth URL without trying to open a browser")
  .addHelpText(
    "after",
    `
Examples:
  fcdx linkedin auth
  fcdx linkedin auth --profile tom
  fcdx linkedin auth --no-open

After successful auth, FCD-X stores the preferred LinkedIn account ID in the
local profile, but command output keeps that ID hidden.
`,
  )
  .action(async (options) => {
    try {
      const client = createUnipileClient(options);
      const before = options.wait ? await linkedinAccountIds(client) : new Set<string>();
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
      if (options.wait) {
        const account = await waitForLinkedinAccount(client, before, options.waitTimeoutSeconds * 1000);
        if (account) {
          storeLinkedinAccountOnProfile(options.profile, account);
          console.error(`LinkedIn account stored on profile "${options.profile}": ${linkedinAccountLabel(account)}`);
        } else {
          console.error("Timed out waiting for LinkedIn auth to finish. Re-run `fcdx linkedin auth` or set a profile with `fcdx linkedin use-account`.");
        }
      }
    } catch (error) {
      exitWithError(error);
    }
  });

linkedin
  .command("accounts")
  .description("List connected LinkedIn accounts without exposing raw Unipile account IDs")
  .option("--base-url <url>", "Unipile DSN/base URL; defaults to config env UNIPILE_BASE_URL")
  .option("--access-token <token>", "Unipile access token; defaults to config env UNIPILE_ACCESS_TOKEN")
  .option("--json", "Print JSON", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx linkedin accounts
  fcdx linkedin accounts --json
`,
  )
  .action(async (options) => {
    try {
      const client = createUnipileClient(options);
      const selected = activeProfile().unipileLinkedinAccountId;
      const accounts = (await client.listAccounts()).filter((account) => account.type === "LINKEDIN");
      const rows = accounts.map((account) => ({
        selected: selected === account.id,
        handle: linkedinAccountHandle(account),
        name: account.name,
        label: linkedinAccountLabel(account),
        status: account.sources?.map((source) => source.status).filter(Boolean).join(", ") || undefined,
      }));
      if (options.json) console.log(JSON.stringify({ profile: activeProfileName(), accounts: rows }, null, 2));
      else {
        if (rows.length === 0) console.log("No LinkedIn accounts connected. Run `fcdx linkedin auth` first.");
        for (const row of rows) {
          console.log(`${row.selected ? "*" : " "}\t${row.handle || "(no handle)"}\t${row.name || ""}\t${row.status || ""}`);
        }
      }
    } catch (error) {
      exitWithError(error);
    }
  });

linkedin
  .command("use-account")
  .description("Set the default LinkedIn account for the active local profile")
  .option("--handle <handle>", "LinkedIn handle/public identifier shown by `fcdx linkedin accounts`")
  .option("--name <name>", "Connected account display name")
  .option("--profile <name>", "Local FCD-X profile to update", activeProfileName())
  .option("--base-url <url>", "Unipile DSN/base URL; defaults to config env UNIPILE_BASE_URL")
  .option("--access-token <token>", "Unipile access token; defaults to config env UNIPILE_ACCESS_TOKEN")
  .addHelpText(
    "after",
    `
Examples:
  fcdx linkedin use-account --handle "Jane Doe"
  fcdx linkedin use-account --name "Jane Doe" --profile sales
`,
  )
  .action(async (options) => {
    try {
      const client = createUnipileClient(options);
      const account = await resolveLinkedinAccountBySafeSelector(client, { handle: options.handle, name: options.name });
      storeLinkedinAccountOnProfile(options.profile, account);
      console.log(JSON.stringify({ profile: options.profile, account: publicLinkedinAccount(account) }, null, 2));
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
  .option("--account-id <accountId>", "Advanced: explicit Unipile LinkedIn account ID; otherwise uses the active profile")
  .option("--profile <name>", "Local FCD-X profile whose LinkedIn account should be used", activeProfileName())
  .option("--base-url <url>", "Unipile DSN/base URL; defaults to config env UNIPILE_BASE_URL")
  .option("--access-token <token>", "Unipile access token; defaults to config env UNIPILE_ACCESS_TOKEN")
  .option("--json", "Print full normalized JSON instead of a table", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx linkedin list-profiles --company "cronwell ai" --n 5
  fcdx linkedin list-profiles --company "cronwell ai" --p CEO --json
  fcdx linkedin list-profiles --company "SMTC" --p "Head of Procurement" --n 10

By default this command uses the LinkedIn account stored on the active local
profile by "fcdx linkedin auth".
`,
  )
  .action(async (options) => {
    try {
      if (!["classic", "sales_navigator", "recruiter"].includes(options.api)) {
        throw new Error("--api must be one of classic, sales_navigator, recruiter");
      }

      const client = createUnipileClient(options);
      const accountId = await resolveLinkedinAccountForProfile(client, options.profile, options.accountId);
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
      let response = await client.searchLinkedinProfiles({
        accountId,
        company: options.company,
        personTitle: options.p,
        n: options.n,
        api: options.api,
        companyIds,
      });
      let searchMode = companyIds.length > 0 ? "company_id" : "keyword";
      if ((response.items ?? []).length === 0 && companyIds.length > 0) {
        response = await client.searchLinkedinProfiles({
          accountId,
          company: options.company,
          personTitle: options.p,
          n: options.n,
          api: options.api,
          companyIds: [],
        });
        searchMode = "keyword_fallback";
      }

      const profiles = (response.items ?? []).slice(0, options.n).map(normalizeProfile);
      if (options.json) {
        console.log(JSON.stringify({ profile: options.profile, company: options.company, searchMode, profiles, rawPaging: response.paging }, null, 2));
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

linkedin
  .command("people")
  .description("Inspect LinkedIn people for companies in a list or one resolved company; does not write to DuckDB")
  .option("--list <name>", "List name to inspect")
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--company-id <id...>", "Exact PDL company id(s); filters --list or selects specific companies")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--role <query>", "Role/title query for likely procurement influencers", "procurement supply chain operations manufacturing")
  .option("--limit-companies <n>", "Maximum list companies to inspect", parseIntArg)
  .option("--limit-per-company <n>", "Maximum LinkedIn profiles to return per company", parseIntArg, 10)
  .option("--api <api>", "LinkedIn search API: classic, sales_navigator, or recruiter", "classic")
  .option("--no-resolve-company", "Do not resolve company name to LinkedIn company IDs before searching")
  .option("--account-id <accountId>", "Advanced: explicit Unipile LinkedIn account ID; otherwise uses the active profile")
  .option("--profile <name>", "Local FCD-X profile whose LinkedIn account should be used", activeProfileName())
  .option("--base-url <url>", "Unipile DSN/base URL; defaults to config env UNIPILE_BASE_URL")
  .option("--access-token <token>", "Unipile access token; defaults to config env UNIPILE_ACCESS_TOKEN")
  .option("--json", "Print JSON instead of a compact table", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx linkedin people --list water-valve-qualified --role "procurement supply chain" --limit-per-company 10
  fcdx linkedin people --company-id pdl_company_id_here --role "VP Procurement" --json
  fcdx linkedin people --company "SMTC" --role "supply chain" --json

Use this after qualification. It is intentionally read-only: the agent should
inspect these people, choose the best contact, then call "fcdx lead find-email".
`,
  )
  .action(async (options) => {
    let instance: Awaited<ReturnType<typeof connectFcdxDb>>["instance"] | undefined;
    let connection: Awaited<ReturnType<typeof connectFcdxDb>>["connection"] | undefined;
    try {
      if (!["classic", "sales_navigator", "recruiter"].includes(options.api)) {
        throw new Error("--api must be one of classic, sales_navigator, recruiter");
      }
      const companyIds = optionArray(options.companyId);
      const connected = await connectFcdxDb(options.db);
      instance = connected.instance;
      connection = connected.connection;
      const companies = await resolvePeopleSearchCompanies(connection, {
        listName: options.list,
        company: options.company,
        companyIds,
        country: options.country === "*" ? undefined : options.country,
        limitCompanies: options.limitCompanies,
      });
      connection.closeSync();
      instance.closeSync();
      connection = undefined;
      instance = undefined;

      const client = createUnipileClient(options);
      const accountId = await resolveLinkedinAccountForProfile(client, options.profile, options.accountId);
      const results: Array<{ company: CandidateCompany; roleQuery: string; profiles: Record<string, unknown>[] }> = [];
      for (const company of companies) {
        const collected: LinkedinSearchProfile[] = [];
        const profileMeta = new Map<string, { roleQuery: string; searchMode: string; companyQuery: string }>();
        for (const companyQuery of linkedinCompanyQueries(company)) {
          const companyMatches =
            options.resolveCompany
              ? await client.searchCompanyParameters({
                  accountId,
                  keywords: companyQuery,
                  service: serviceForApi(options.api),
                  limit: 5,
                })
              : [];
          const linkedinCompanyIds = options.resolveCompany ? bestCompanyIds(companyQuery, companyMatches) : [];
          for (const roleQuery of expandLinkedinRoleQueries(options.role)) {
            let response = await client.searchLinkedinProfiles({
              accountId,
              company: companyQuery,
              personTitle: roleQuery,
              n: options.limitPerCompany,
              api: options.api,
              companyIds: linkedinCompanyIds,
            });
            let searchMode = linkedinCompanyIds.length > 0 ? "company_id" : "keyword";
            if ((response.items ?? []).length === 0 && linkedinCompanyIds.length > 0) {
              response = await client.searchLinkedinProfiles({
                accountId,
                company: companyQuery,
                personTitle: roleQuery,
                n: options.limitPerCompany,
                api: options.api,
                companyIds: [],
              });
              searchMode = "keyword_fallback";
            }
            for (const profile of response.items ?? []) {
              const key = profileKey(profile);
              if (!key || profileMeta.has(key)) continue;
              collected.push(profile);
              profileMeta.set(key, { roleQuery, searchMode, companyQuery });
              if (collected.length >= options.limitPerCompany) break;
            }
            if (collected.length >= options.limitPerCompany) break;
          }
          if (collected.length >= options.limitPerCompany) break;
        }
        const profiles = collected.slice(0, options.limitPerCompany).map((profile, index) => {
          const meta = profileMeta.get(profileKey(profile));
          return {
            rank: index + 1,
            ...normalizeProfile(profile),
            role_query: meta?.roleQuery ?? options.role,
            search_mode: meta?.searchMode ?? "keyword",
            company_query: meta?.companyQuery ?? company.name,
            relevance_reason: procurementRelevanceReason(profile),
          };
        });
        results.push({ company, roleQuery: options.role, profiles });
      }

      if (options.json) {
        console.log(JSON.stringify({ profile: options.profile, results }, null, 2));
        return;
      }
      for (const result of results) {
        console.log(`${result.company.name}\t${result.company.id}\t${result.company.website}`);
        if (result.profiles.length === 0) {
          console.log("  No profiles found.");
          continue;
        }
        for (const profile of result.profiles) {
          console.log(`  ${profile.rank}. ${profile.name || "(unknown)"}\t${profile.linkedin_url || ""}\t${profile.headline || ""}`);
        }
      }
    } catch (error) {
      exitWithError(error);
    } finally {
      connection?.closeSync();
      instance?.closeSync();
    }
  });

const lead = program
  .command("lead")
  .description("Lead discovery and verified email workflows")
  .addHelpText(
    "after",
    `
Examples:
  fcdx linkedin people --list water-valve-qualified --role "procurement supply chain" --json
  fcdx lead find-email --list water-valve-qualified --company-id pdl_company_id_here --first-name Jane --last-name Doe --domain example.com --role "VP Supply Chain"
  fcdx lead domain-search --list water-valve-qualified --company-id pdl_company_id_here --allow-accept-all
  fcdx list show --list water-valve-qualified --limit 10

Subcommand options:
  fcdx lead find-email --help
  fcdx lead domain-search --help
`,
  );

lead
  .command("find-email")
  .description("Find and verify one selected person's email with Hunter, then store it as a list-local lead")
  .requiredOption("--list <name>", "List name whose member should receive the lead field")
  .option("--company-id <id>", "Exact PDL company id; preferred and required when names are ambiguous")
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--first-name <name>", "Lead first name")
  .option("--last-name <name>", "Lead last name")
  .option("--full-name <name>", "Lead full name; used if first/last are not supplied")
  .option("--role <role>", "Lead role/title at the company")
  .option("--domain <domain>", "Company email domain; defaults to the company website domain")
  .option("--linkedin-url <url>", "LinkedIn profile URL for provenance and Hunter linkedin_handle lookup")
  .option("--field <key>", "List field that stores the lead array", "leads")
  .option("--hunter-api-key <key>", "Hunter API key; defaults to config env HUNTER_API_KEY")
  .option("--max-duration <n>", "Hunter Email Finder max duration in seconds", parseIntArg, 10)
  .option("--allow-accept-all", "Allow Hunter accept_all results; default writes only status=valid", false)
  .option("--replace", "Replace existing leads in this field instead of appending", false)
  .option("--dry-run", "Print Hunter result but do not write to DuckDB", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx lead find-email --list water-valve-qualified --company-id pdl_company_id_here --first-name Jane --last-name Doe --domain example.com --role "VP Supply Chain"
  fcdx lead find-email --list targets --company-id pdl_company_id_here --full-name "Jane Doe" --linkedin-url "https://www.linkedin.com/in/janedoe"
  fcdx lead find-email --list targets --company "SMTC" --first-name Jane --last-name Doe --role "Chief Procurement Officer"

This command writes only verified emails by default. Hunter Email Finder must
return verification.status=valid, and Hunter Email Verifier must also return
status=valid. Use --allow-accept-all only when you explicitly want riskier
accept-all addresses stored.
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const apiKey = options.hunterApiKey || resolveConfigEnv("HUNTER_API_KEY");
      if (!apiKey) throw new Error("HUNTER_API_KEY is required. Set it with `fcdx config env set HUNTER_API_KEY <key>` or pass --hunter-api-key.");
      const country = options.country === "*" ? undefined : options.country;
      const resolvedCompany = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      const data = await showList(connection, { listName: options.list });
      const member = data.members.find((row) => row.company.id === resolvedCompany.id);
      if (!member) {
        throw new Error(`Company ${resolvedCompany.id} is not a member of list ${options.list}`);
      }

      const name = resolveLeadName({ firstName: options.firstName, lastName: options.lastName, fullName: options.fullName });
      const domain = normalizeEmailDomain(options.domain || domainFromWebsite(member.company.website || member.company.url));
      const hunter = new HunterClient({ apiKey });
      const finder = await hunter.findEmail({
        domain,
        firstName: name.firstName,
        lastName: name.lastName,
        fullName: name.fullName,
        linkedinHandle: domain ? undefined : linkedinHandleFromUrl(options.linkedinUrl),
        maxDuration: options.maxDuration,
      });
      const found = finder.data;
      const email = found?.email;
      if (!email) {
        console.log(JSON.stringify({ written: false, reason: "Hunter did not return an email", finder: summarizeHunterFinder(found) }, null, 2));
        return;
      }
      const verifier = await hunter.verifyEmail(email);
      const allowedStatuses = new Set(options.allowAcceptAll ? ["valid", "accept_all"] : ["valid"]);
      const finderStatus = found?.verification?.status;
      const verifierStatus = verifier.data?.status;
      const verified = Boolean(finderStatus && verifierStatus && allowedStatuses.has(finderStatus) && allowedStatuses.has(verifierStatus));
      const leadValue = buildLeadValue({
        requestedName: name,
        role: options.role,
        linkedinUrl: options.linkedinUrl,
        company: member.company,
        domain,
        finder: found,
        verifier: verifier.data,
      });
      if (!verified) {
        console.log(
          JSON.stringify(
            {
              written: false,
              reason: "Hunter email was not verified enough to store",
              requiredStatuses: [...allowedStatuses],
              finderStatus,
              verifierStatus,
              lead: leadValue,
            },
            null,
            2,
          ),
        );
        return;
      }

      const existing = member.fields[options.field];
      const nextLeads = options.replace ? [leadValue] : appendLeadValue(existing, leadValue);
      if (!options.dryRun) {
        await setListFieldValue(connection, {
          listName: options.list,
          companyId: member.company.id,
          fieldKey: options.field,
          value: nextLeads,
          fieldType: "array",
          description: "Verified lead contacts selected after LinkedIn inspection and Hunter email verification",
          source: "hunter:email-finder",
          confidence: typeof verifier.data?.score === "number" ? verifier.data.score / 100 : undefined,
        });
      }
      console.log(
        JSON.stringify(
          {
            written: !options.dryRun,
            list: options.list,
            field: options.field,
            company: member.company,
            lead: leadValue,
            totalLeads: nextLeads.length,
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

lead
  .command("domain-search")
  .description("Find multiple company-domain emails with Hunter Domain Search and store them as list-local leads")
  .requiredOption("--list <name>", "List name whose member should receive the lead field")
  .option("--company-id <id>", "Exact PDL company id; preferred and required when names are ambiguous")
  .option("--company <name>", "Company name, website, or LinkedIn substring; must resolve to exactly one DB row")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--domain <domain>", "Company email domain; defaults to the company website domain")
  .option("--field <key>", "List field that stores the lead array", "leads")
  .option("--hunter-api-key <key>", "Hunter API key; defaults to config env HUNTER_API_KEY")
  .option("--limit <n>", "Maximum Hunter Domain Search emails to fetch", parseIntArg, 25)
  .option("--max-write <n>", "Maximum matching emails to store", parseIntArg, 1)
  .option("--role-keywords <text>", "Rank/write emails whose title matches these terms first", "procurement supply chain sourcing purchasing operations manufacturing plant")
  .option("--department <text>", "Optional Hunter department filter")
  .option("--seniority <text>", "Optional Hunter seniority filter")
  .option("--type <type>", "Hunter email type filter: personal or generic", "personal")
  .option("--allow-accept-all", "Allow Hunter accept_all emails in addition to valid emails", false)
  .option("--include-unverified", "Also write unknown/unverified Hunter emails", false)
  .option("--replace", "Replace existing leads in this field instead of appending", false)
  .option("--dry-run", "Print Hunter result but do not write to DuckDB", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx lead domain-search --list water-valve-qualified --company-id pdl_company_id_here --allow-accept-all
  fcdx lead domain-search --list targets --company "Apollo Valves" --domain apollovalves.com --role-keywords "procurement supply chain operations manufacturing" --allow-accept-all

This command is broader than find-email. It does not require a selected LinkedIn
person first; it asks Hunter for emails on the company domain, ranks likely
procurement/operations/manufacturing contacts first, and stores the single best
matching email by default. Pass --max-write >1 only when you explicitly want
alternates stored. Companies with no stored lead still remain in lead-summary
exports.
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const apiKey = options.hunterApiKey || resolveConfigEnv("HUNTER_API_KEY");
      if (!apiKey) throw new Error("HUNTER_API_KEY is required. Set it with `fcdx config env set HUNTER_API_KEY <key>` or pass --hunter-api-key.");
      const country = options.country === "*" ? undefined : options.country;
      const resolvedCompany = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      const data = await showList(connection, { listName: options.list });
      const member = data.members.find((row) => row.company.id === resolvedCompany.id);
      if (!member) {
        throw new Error(`Company ${resolvedCompany.id} is not a member of list ${options.list}`);
      }

      const domain = normalizeEmailDomain(options.domain || domainFromWebsite(member.company.website || member.company.url));
      if (!domain) throw new Error(`Could not infer an email domain for ${member.company.name}; pass --domain.`);
      const hunter = new HunterClient({ apiKey });
      const response = await hunter.domainSearch({
        domain,
        limit: options.limit,
        type: options.type === "generic" ? "generic" : "personal",
        department: options.department,
        seniority: options.seniority,
      });
      const allowedStatuses = hunterAllowedStatuses(options);
      const roleKeywords = splitWords(options.roleKeywords);
      const emails = (response.data?.emails ?? [])
        .filter((email) => email.value)
        .filter((email) => allowedStatuses.has(email.verification?.status ?? "unknown"))
        .map((email) => ({ email, score: scoreHunterDomainEmail(email, roleKeywords) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.maxWrite);
      const leadValues = emails.map(({ email, score }) =>
        buildDomainLeadValue({
          email,
          company: member.company,
          domain,
          score,
        }),
      );

      const existing = member.fields[options.field];
      const nextLeads = options.replace ? leadValues : leadValues.reduce((rows, leadValue) => appendLeadValue(rows, leadValue), existing);
      if (!options.dryRun && leadValues.length > 0) {
        await setListFieldValue(connection, {
          listName: options.list,
          companyId: member.company.id,
          fieldKey: options.field,
          value: nextLeads,
          fieldType: "array",
          description: "Lead contacts found with Hunter Domain Search",
          source: "hunter:domain-search",
          confidence: bestLeadConfidence(leadValues),
        });
      }

      console.log(
        JSON.stringify(
          {
            written: !options.dryRun && leadValues.length > 0,
            list: options.list,
            field: options.field,
            company: member.company,
            domain,
            fetchedEmails: response.data?.emails?.length ?? 0,
            allowedStatuses: [...allowedStatuses],
            writtenLeads: leadValues.length,
            totalLeads: Array.isArray(nextLeads) ? nextLeads.length : leadValues.length,
            leads: leadValues,
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

const deepresearch = program
  .command("deepresearch")
  .description("Submit and inspect asynchronous deep-research jobs")
  .addHelpText(
    "after",
    `
Examples:
  fcdx config env set API_URL http://127.0.0.1:8787
  fcdx deepresearch submit --prompt-file packages/deepresearch/results/water-valves/tasks/kennedy-valve-company-BFKJ7LbO.md
  fcdx deepresearch submit-list --list water-valve-qualified --prompt-file packages/deepresearch/prompts/manufacturing-outreach-research.md --limit 5
  fcdx deepresearch status --job-id job_id_here
  fcdx deepresearch status-list --jobs-file output/deepresearch/jobs.json
  fcdx deepresearch report --job-id job_id_here --output output/reports/company.txt

Subcommand options:
  fcdx deepresearch submit --help
  fcdx deepresearch submit-list --help
  fcdx deepresearch status --help
  fcdx deepresearch status-list --help
  fcdx deepresearch wait --help
  fcdx deepresearch report --help
`,
  );

deepresearch
  .command("submit")
  .description("Submit one prompt to the deepresearch API queue")
  .option("--api-url <url>", "Deepresearch API URL; defaults to config env API_URL", resolveDeepResearchApiUrl())
  .option("--job-id <id>", "Optional deterministic job id")
  .option("--prompt <text>", "Prompt text to submit")
  .option("--prompt-file <path>", "Prompt file to submit")
  .option("--company-id <id>", "Optional company id used for deepresearch cache lookup/write")
  .option("--company-name <name>", "Optional company name stored in job metadata")
  .option("--website <domain>", "Optional company website stored in job metadata")
  .option("--cache-dir <path>", "Company cache root; deepresearch uses <root>/<company-id>/deepresearch", resolveFirecrawlCacheDir())
  .option("--metadata-json <json>", "Optional JSON metadata stored on the job")
  .option("--runner <name>", "Runner: open-deep-research or stub")
  .option("--search-api <name>", "Search backend for Open Deep Research, e.g. firecrawl")
  .option("--model <model>", "Research model, e.g. openai:deepseek-chat")
  .option("--max-concurrent-research-units <n>", "Open Deep Research concurrency", parseIntArg)
  .option("--max-researcher-iterations <n>", "Open Deep Research supervisor iterations", parseIntArg)
  .option("--max-react-tool-calls <n>", "Open Deep Research tool-call budget", parseIntArg)
  .option("--force-refresh", "Bypass a cached deepresearch report for this company", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx deepresearch submit --prompt-file packages/deepresearch/results/water-valves/tasks/kennedy-valve-company-BFKJ7LbO.md
  fcdx deepresearch submit --prompt "Research Kennedy Valve for procurement outreach" --metadata-json '{"company":"kennedy valve"}'
  fcdx deepresearch submit --company-id pdl_company_id_here --prompt-file /tmp/task.md
  fcdx deepresearch submit --prompt-file /tmp/task.md --runner stub

The API URL is read from --api-url, then config env API_URL, then
http://127.0.0.1:8787.
`,
  )
  .action(async (options) => {
    try {
      const client = createDeepResearchClient(options.apiUrl);
      const prompt = await readPromptOption(options);
      const response = await client.submit({
        jobId: options.jobId,
        prompt,
        metadata: deepResearchMetadata({
          metadata: parseJsonOption(options.metadataJson) as Record<string, unknown> | undefined,
          companyId: options.companyId,
          companyName: options.companyName,
          website: options.website,
          cacheDir: options.cacheDir,
        }),
        options: deepResearchSubmitOptions(options),
      });
      console.log(JSON.stringify(response, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

deepresearch
  .command("submit-list")
  .description("Submit one deepresearch job per company in a durable list")
  .requiredOption("--list <name>", "List name")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--api-url <url>", "Deepresearch API URL; defaults to config env API_URL", resolveDeepResearchApiUrl())
  .option("--prompt <text>", "Prompt template text; company context is appended")
  .option("--prompt-file <path>", "Prompt template file; company context is appended")
  .option("--limit <n>", "Maximum list members to submit", parseIntArg)
  .option("--cache-dir <path>", "Company cache root; deepresearch uses <root>/<company-id>/deepresearch", resolveFirecrawlCacheDir())
  .option("--metadata-json <json>", "Optional JSON metadata merged into every job")
  .option("-o, --output <path>", "Optional JSON manifest output path for status-list")
  .option("--runner <name>", "Runner: open-deep-research or stub")
  .option("--search-api <name>", "Search backend for Open Deep Research, e.g. firecrawl")
  .option("--model <model>", "Research model, e.g. openai:deepseek-chat")
  .option("--max-concurrent-research-units <n>", "Open Deep Research concurrency", parseIntArg)
  .option("--max-researcher-iterations <n>", "Open Deep Research supervisor iterations", parseIntArg)
  .option("--max-react-tool-calls <n>", "Open Deep Research tool-call budget", parseIntArg)
  .option("--force-refresh", "Bypass cached deepresearch reports for this list run", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx deepresearch submit-list --list water-valve-qualified --prompt-file packages/deepresearch/prompts/manufacturing-outreach-research.md --limit 3
  fcdx deepresearch submit-list --list water-valve-qualified --prompt-file packages/deepresearch/prompts/manufacturing-outreach-research.md --output output/deepresearch/jobs.json
  fcdx deepresearch submit-list --list targets --prompt "Research this company for Cronwell outreach" --runner stub

Each job receives the prompt template plus the company row, list membership
metadata, tags, and list-local fields from DuckDB.
`,
  )
  .action(async (options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const client = createDeepResearchClient(options.apiUrl);
      const template = await readPromptOption(options);
      const metadata = parseJsonOption(options.metadataJson) as Record<string, unknown> | undefined;
      const listData = await showList(connection, { listName: options.list, limit: options.limit });
      const submitted: Array<Record<string, unknown>> = [];
      for (const member of listData.members) {
        const response = await client.submit({
          prompt: buildListDeepResearchPrompt(template, member),
          metadata: {
            ...(metadata ?? {}),
            list: listData.list.name,
            company_id: member.company.id,
            company_name: member.company.name,
            website: member.company.website,
            deepresearch_cache_dir: deepResearchCompanyCacheDir(member.company.id, options.cacheDir),
          },
          options: deepResearchSubmitOptions(options),
        });
        submitted.push({
          company_id: member.company.id,
          company_name: member.company.name,
          ...response,
        });
      }
      const output = { list: listData.list.name, jobs: submitted.length, submitted };
      if (options.output) {
        await fs.mkdir(path.dirname(options.output), { recursive: true });
        await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
      }
      console.log(JSON.stringify({ ...output, output: options.output }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

deepresearch
  .command("status")
  .description("Fetch deepresearch job status from the API")
  .requiredOption("--job-id <id>", "Job id returned by fcdx deepresearch submit")
  .option("--api-url <url>", "Deepresearch API URL; defaults to config env API_URL", resolveDeepResearchApiUrl())
  .addHelpText(
    "after",
    `
Example:
  fcdx deepresearch status --job-id job_id_here
`,
  )
  .action(async (options) => {
    try {
      const client = createDeepResearchClient(options.apiUrl);
      console.log(JSON.stringify(await client.status(options.jobId), null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

deepresearch
  .command("status-list")
  .description("Fetch aggregate status for jobs written by deepresearch submit-list")
  .requiredOption("--jobs-file <path>", "JSON manifest from fcdx deepresearch submit-list --output")
  .option("--api-url <url>", "Deepresearch API URL; defaults to config env API_URL", resolveDeepResearchApiUrl())
  .option("-o, --output <path>", "Optional JSON status output path")
  .addHelpText(
    "after",
    `
Examples:
  fcdx deepresearch status-list --jobs-file output/deepresearch/jobs.json
  fcdx deepresearch status-list --jobs-file output/deepresearch/jobs.json --output output/deepresearch/status.json
`,
  )
  .action(async (options) => {
    try {
      const client = createDeepResearchClient(options.apiUrl);
      const manifest = parseJsonOption(await fs.readFile(options.jobsFile, "utf8")) as { submitted?: Array<Record<string, unknown>> };
      const submitted = manifest.submitted ?? [];
      const rows: Array<Record<string, unknown>> = [];
      for (const row of submitted) {
        const jobId = String(row.job_id ?? "");
        if (!jobId) continue;
        const status = await client.status(jobId);
        const result = status.result && typeof status.result === "object" ? status.result as Record<string, unknown> : {};
        rows.push({
          company_id: row.company_id,
          company_name: row.company_name,
          job_id: jobId,
          state: status.state,
          failed_reason: status.failed_reason,
          cache_hit: result.cache_hit,
          report_path: result.report_path,
          cache_dir: result.cache_dir,
          finished_at: status.finished_at,
        });
      }
      const counts = rows.reduce<Record<string, number>>((acc, row) => {
        const state = String(row.state ?? "unknown");
        acc[state] = (acc[state] ?? 0) + 1;
        return acc;
      }, {});
      const output = { jobsFile: options.jobsFile, jobs: rows.length, counts, rows };
      if (options.output) {
        await fs.mkdir(path.dirname(options.output), { recursive: true });
        await fs.writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
      }
      console.log(JSON.stringify({ ...output, output: options.output }, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

deepresearch
  .command("wait")
  .description("Poll a deepresearch job until completion, then print or save report.txt")
  .requiredOption("--job-id <id>", "Job id returned by fcdx deepresearch submit")
  .option("--api-url <url>", "Deepresearch API URL; defaults to config env API_URL", resolveDeepResearchApiUrl())
  .option("-o, --output <path>", "Optional path to write report.txt")
  .option("--timeout-ms <n>", "Maximum wait time", parseIntArg, 900_000)
  .option("--poll-ms <n>", "Polling interval", parseIntArg, 5000)
  .addHelpText(
    "after",
    `
Examples:
  fcdx deepresearch wait --job-id job_id_here
  fcdx deepresearch wait --job-id job_id_here --output output/reports/company.txt --timeout-ms 1800000
`,
  )
  .action(async (options) => {
    try {
      const client = createDeepResearchClient(options.apiUrl);
      await waitForDeepResearchJob(client, options.jobId, {
        timeoutMs: options.timeoutMs,
        pollMs: options.pollMs,
      });
      const report = await client.report(options.jobId);
      if (options.output) {
        await fs.mkdir(path.dirname(options.output), { recursive: true });
        await fs.writeFile(options.output, report, "utf8");
        console.log(JSON.stringify({ jobId: options.jobId, output: options.output, bytes: report.length }, null, 2));
      } else {
        console.log(report);
      }
    } catch (error) {
      exitWithError(error);
    }
  });

deepresearch
  .command("report")
  .description("Fetch report.txt for a completed deepresearch job")
  .requiredOption("--job-id <id>", "Job id returned by fcdx deepresearch submit")
  .option("--api-url <url>", "Deepresearch API URL; defaults to config env API_URL", resolveDeepResearchApiUrl())
  .option("-o, --output <path>", "Optional path to write report.txt")
  .addHelpText(
    "after",
    `
Examples:
  fcdx deepresearch report --job-id job_id_here
  fcdx deepresearch report --job-id job_id_here --output output/reports/company.txt
`,
  )
  .action(async (options) => {
    try {
      const client = createDeepResearchClient(options.apiUrl);
      const report = await client.report(options.jobId);
      if (options.output) {
        await fs.mkdir(path.dirname(options.output), { recursive: true });
        await fs.writeFile(options.output, report, "utf8");
        console.log(JSON.stringify({ jobId: options.jobId, output: options.output, bytes: report.length }, null, 2));
      } else {
        console.log(report);
      }
    } catch (error) {
      exitWithError(error);
    }
  });

const target = program
  .command("target")
  .description("Target-category comparison and shortlist commands")
  .addHelpText(
    "after",
    `
Examples:
  fcdx target compare --candidates output/candidates/db-strict.jsonl
  fcdx target shortlist --candidates output/candidates/db-strict.jsonl --limit 200
  fcdx target rank-enriched --enriched output/enriched/target-agent-enriched.jsonl --limit 200

Subcommand options:
  fcdx target compare --help
  fcdx target shortlist --help
  fcdx target rank-enriched --help
`,
  );

target
  .command("compare")
  .description("Compare PDF target companies against the candidate pool")
  .option("--config <path>", "Target company/category config", "config/target_companies_and_categories.json")
  .option("--candidates <path>", "Candidate JSONL path", "output/candidates/db-strict.jsonl")
  .option("-o, --output <path>", "JSON summary output path", "output/target/doc-company-coverage.json")
  .option("--csv-output <path>", "CSV coverage output path", "output/target/doc-company-coverage.csv")
  .addHelpText(
    "after",
    `
Examples:
  fcdx target compare --candidates output/candidates/db-strict.jsonl
  fcdx target compare --config config/target_companies_and_categories.json --csv-output output/target/coverage.csv
`,
  )
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
  .addHelpText(
    "after",
    `
Examples:
  fcdx target shortlist --candidates output/candidates/db-strict.jsonl --limit 200
  fcdx target shortlist --candidates output/candidates/db-strict.jsonl --enriched output/enriched/electrical800-construction700.jsonl --csv-output output/target/shortlist.csv
`,
  )
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
  .option("--min-score <n>", "Minimum final target-alignment score", parseIntArg)
  .option("--min-manufacturing-fit <n>", "Minimum manufacturing/fabrication/assembly fit sub-score", parseIntArg)
  .option("--min-procurement-fit <n>", "Minimum procurement-complexity fit sub-score", parseIntArg)
  .option("--min-category-fit <n>", "Minimum PDF category fit sub-score", parseIntArg)
  .option("--min-datacenter-fit <n>", "Minimum data-center/critical-infrastructure fit sub-score", parseIntArg)
  .option("-o, --output <path>", "JSONL ranked shortlist output path", "output/target/agent-shortlist-200.jsonl")
  .option("--csv-output <path>", "CSV ranked shortlist output path", "output/target/agent-shortlist-200.csv")
  .addHelpText(
    "after",
    `
Examples:
  fcdx target rank-enriched --enriched output/enriched/target-agent-enriched.jsonl --limit 200
  fcdx target rank-enriched --enriched output/enriched/target-agent-enriched.jsonl --min-manufacturing-fit 4 --min-procurement-fit 3
`,
  )
  .action(async (options) => {
    try {
      const config = await readTargetConfig(options.config);
      const enrichedRows = await readEnrichedJsonl(options.enriched);
      const enrichedRowsWithTargetAlignment = enrichedRows.filter((row) => row.enrichment.target_alignment).length;
      if (enrichedRowsWithTargetAlignment === 0) {
        console.error("Warning: no rows contain enrichment.target_alignment; rerun enrichment with the current schema before using this as a final shortlist.");
      }
      const rows = buildAgentJudgedShortlist(config, enrichedRows, {
        limit: options.limit,
        minScore: options.minScore,
        minManufacturingFit: options.minManufacturingFit,
        minProcurementFit: options.minProcurementFit,
        minCategoryFit: options.minCategoryFit,
        minDatacenterFit: options.minDatacenterFit,
      });
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
              manufacturingFit: row.manufacturingFit,
              procurementFit: row.procurementFit,
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

function createDeepResearchClient(apiUrl?: string): DeepResearchClient {
  return new DeepResearchClient(apiUrl || resolveDeepResearchApiUrl());
}

function resolveDeepResearchApiUrl(explicitUrl?: string): string {
  return (
    explicitUrl ||
    resolveConfigEnv("API_URL") ||
    resolveConfigEnv("FCDX_DEEPRESEARCH_API_URL") ||
    resolveConfigEnv("DEEPRESEARCH_API_URL") ||
    "http://127.0.0.1:8787"
  );
}

async function readPromptOption(options: { prompt?: string; promptFile?: string }): Promise<string> {
  if (options.prompt && options.promptFile) throw new Error("Provide either --prompt or --prompt-file, not both");
  if (options.prompt) return options.prompt;
  if (options.promptFile) return fs.readFile(options.promptFile, "utf8");
  throw new Error("Provide --prompt or --prompt-file");
}

function deepResearchSubmitOptions(options: {
  runner?: string;
  searchApi?: string;
  model?: string;
  maxConcurrentResearchUnits?: number;
  maxResearcherIterations?: number;
  maxReactToolCalls?: number;
  forceRefresh?: boolean;
}): DeepResearchSubmitOptions | undefined {
  if (options.runner && options.runner !== "open-deep-research" && options.runner !== "stub") {
    throw new Error("--runner must be open-deep-research or stub");
  }
  const result: DeepResearchSubmitOptions = {
    runner: options.runner as DeepResearchSubmitOptions["runner"],
    searchApi: options.searchApi,
    model: options.model,
    maxConcurrentResearchUnits: options.maxConcurrentResearchUnits,
    maxResearcherIterations: options.maxResearcherIterations,
    maxReactToolCalls: options.maxReactToolCalls,
    forceRefresh: options.forceRefresh || undefined,
  };
  const cleaned = Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as DeepResearchSubmitOptions;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function deepResearchMetadata(input: {
  metadata?: Record<string, unknown>;
  companyId?: string;
  companyName?: string;
  website?: string;
  cacheDir?: string;
}): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (input.companyId) {
    metadata.company_id = input.companyId;
    metadata.deepresearch_cache_dir = deepResearchCompanyCacheDir(input.companyId, input.cacheDir ?? resolveFirecrawlCacheDir());
  }
  if (input.companyName) metadata.company_name = input.companyName;
  if (input.website) metadata.website = input.website;
  return Object.keys(metadata).length ? metadata : undefined;
}

function deepResearchCompanyCacheDir(companyId: string, cacheRoot: string): string {
  return path.resolve(cacheRoot, safeName(companyId), "deepresearch");
}

function buildListDeepResearchPrompt(
  template: string,
  member: Awaited<ReturnType<typeof showList>>["members"][number],
): string {
  const company = member.company;
  const companyContext: Record<string, unknown> = {
    id: company.id,
    name: company.name,
    website: company.website,
    url: company.url,
    industry: company.industry,
    size: company.size,
    country: company.country,
    region: company.region,
    locality: company.locality,
    linkedin_url: company.linkedinUrl,
    founded: company.founded,
    list_membership: {
      source: member.source,
      reason: member.reason,
      rank: member.rank,
      score: member.score,
    },
    tags: member.tags,
    list_fields: member.fields,
  };
  return `${template.trim()}

## Company Input

\`\`\`json
${JSON.stringify(companyContext, null, 2)}
\`\`\`
`;
}

async function waitForDeepResearchJob(
  client: DeepResearchClient,
  jobId: string,
  options: { timeoutMs: number; pollMs: number },
): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started <= options.timeoutMs) {
    const status = await client.status(jobId);
    const state = String(status.state ?? "");
    if (state === "completed") return status;
    if (state === "failed") {
      throw new Error(`Deepresearch job failed: ${String(status.failed_reason ?? "unknown reason")}`);
    }
    await sleep(options.pollMs);
  }
  throw new Error(`Timed out waiting for deepresearch job ${jobId}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createUnipileClient(options: { baseUrl?: string; accessToken?: string }): UnipileClient {
  const baseUrl = options.baseUrl || resolveConfigEnv("UNIPILE_BASE_URL");
  const accessToken = options.accessToken || resolveConfigEnv("UNIPILE_ACCESS_TOKEN");
  if (!baseUrl) throw new Error("UNIPILE_BASE_URL is required. Set it with `fcdx config env set UNIPILE_BASE_URL <url>` or pass --base-url.");
  if (!accessToken) throw new Error("UNIPILE_ACCESS_TOKEN is required. Set it with `fcdx config env set UNIPILE_ACCESS_TOKEN <token>` or pass --access-token.");
  return new UnipileClient({ baseUrl, accessToken });
}

async function resolvePeopleSearchCompanies(
  connection: DuckDBConnection,
  input: {
    listName?: string;
    company?: string;
    companyIds?: string[];
    country?: string;
    limitCompanies?: number;
  },
): Promise<CandidateCompany[]> {
  if (!input.listName && !input.company && (!input.companyIds || input.companyIds.length === 0)) {
    throw new Error("Provide --list, --company, or --company-id");
  }

  const companyIdSet = new Set(input.companyIds ?? []);
  if (input.listName) {
    const list = await showList(connection, { listName: input.listName });
    let companies = list.members.map((member) => member.company);
    if (companyIdSet.size > 0) companies = companies.filter((company) => companyIdSet.has(company.id));
    if (input.limitCompanies !== undefined) companies = companies.slice(0, input.limitCompanies);
    if (companies.length === 0) throw new Error(`No companies selected from list ${input.listName}`);
    return companies;
  }

  const companies: CandidateCompany[] = [];
  if (input.companyIds) {
    for (const companyId of input.companyIds) {
      companies.push(await resolveCompanyId(connection, { companyId }));
    }
  }
  if (input.company) {
    companies.push(await resolveCompanyId(connection, { company: input.company, country: input.country }));
  }
  return dedupeCompanies(companies).slice(0, input.limitCompanies);
}

function dedupeCompanies(companies: CandidateCompany[]): CandidateCompany[] {
  const seen = new Set<string>();
  const rows: CandidateCompany[] = [];
  for (const company of companies) {
    if (seen.has(company.id)) continue;
    seen.add(company.id);
    rows.push(company);
  }
  return rows;
}

function dedupeProfiles(profiles: LinkedinSearchProfile[]): LinkedinSearchProfile[] {
  const seen = new Set<string>();
  const rows: LinkedinSearchProfile[] = [];
  for (const profile of profiles) {
    const key = profileKey(profile);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    rows.push(profile);
  }
  return rows;
}

function profileKey(profile: LinkedinSearchProfile): string {
  return normalizeLinkedinProfileUrl(profile) || profile.id || profile.public_identifier || profile.name || "";
}

function expandLinkedinRoleQueries(role: string): string[] {
  const normalized = role.trim();
  const queries = [
    normalized,
    ...normalized.split(/[,/|]+/).map((part) => part.trim()),
    "procurement",
    "supply chain",
    "sourcing",
    "purchasing",
    "operations",
    "manufacturing",
    "president",
  ];
  if (/supply\s+chain/i.test(normalized)) queries.push("supply chain");
  return [...new Set(queries.filter(Boolean))];
}

function linkedinCompanyQueries(company: CandidateCompany): string[] {
  const queries = [
    company.name,
    normalizeForMatch(company.name),
    domainLabel(company.website || company.url),
    linkedinCompanySlug(company.linkedinUrl),
  ];
  const manufacturedBy = company.name.match(/manufactured by\s+(.+)$/i)?.[1];
  if (manufacturedBy) queries.push(manufacturedBy);
  if (/apollo/i.test(company.name) || /apollo/i.test(company.website)) queries.push("Apollo Valves", "Conbraco Industries");
  return [...new Set(queries.map((query) => query?.replace(/[-_]+/g, " ").trim()).filter(Boolean) as string[])];
}

function domainLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const domain = normalizeEmailDomain(domainFromWebsite(value));
  return domain.split(".")[0];
}

function linkedinCompanySlug(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/linkedin\.com\/company\/([^/?#]+)/i);
  return match?.[1];
}

function procurementRelevanceReason(profile: LinkedinSearchProfile): string {
  const text = `${profile.headline ?? ""} ${profile.name ?? ""}`.toLowerCase();
  if (/chief|cpo|vp|vice president|head|director/.test(text) && /procurement|supply chain|sourcing|purchasing/.test(text)) {
    return "Senior procurement/supply-chain title; likely close to purchasing decisions.";
  }
  if (/procurement|supply chain|sourcing|purchasing/.test(text)) return "Procurement or supply-chain title.";
  if (/operations|manufacturing|plant|general manager|gm/.test(text)) return "Operations/manufacturing leadership title; may influence procurement.";
  if (/chief|president|founder|owner|ceo|coo/.test(text)) return "Executive title; may influence vendor decisions.";
  return "Returned by LinkedIn role query; inspect manually before lead lookup.";
}

function optionArray(value: string[] | string | undefined): string[] | undefined {
  if (Array.isArray(value)) return value.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return undefined;
}

function resolveLeadName(input: { firstName?: string; lastName?: string; fullName?: string }): { firstName?: string; lastName?: string; fullName?: string } {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  const fullName = input.fullName?.trim();
  if (firstName && lastName) return { firstName, lastName, fullName: fullName || `${firstName} ${lastName}` };
  if (!fullName) throw new Error("Provide --first-name and --last-name, or --full-name");
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new Error("--full-name must include at least first and last name");
  return {
    firstName: firstName || parts[0],
    lastName: lastName || parts.slice(1).join(" "),
    fullName,
  };
}

function domainFromWebsite(website: string): string {
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname;
  } catch {
    return website;
  }
}

function normalizeEmailDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split("?")[0]
    .toLowerCase();
}

function summarizeHunterFinder(data: HunterEmailFinderData | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return {
    email: data.email,
    score: data.score,
    domain: data.domain,
    company: data.company,
    position: data.position,
    verification_status: data.verification?.status,
  };
}

function buildLeadValue(input: {
  requestedName: { firstName?: string; lastName?: string; fullName?: string };
  role?: string;
  linkedinUrl?: string;
  company: CandidateCompany;
  domain: string;
  finder?: HunterEmailFinderData;
  verifier?: HunterEmailVerifierData;
}): Record<string, unknown> {
  const found = input.finder;
  const firstName = input.requestedName.firstName || found?.first_name;
  const lastName = input.requestedName.lastName || found?.last_name;
  return {
    first_name: firstName,
    last_name: lastName,
    full_name: input.requestedName.fullName || [firstName, lastName].filter(Boolean).join(" "),
    email: found?.email,
    role: input.role || found?.position,
    company_id: input.company.id,
    company_name: input.company.name,
    domain: input.domain,
    linkedin_url: input.linkedinUrl || found?.linkedin_url,
    source: "hunter:email-finder",
    verification_status: found?.verification?.status,
    verifier_status: input.verifier?.status,
    verifier_result: input.verifier?.result,
    confidence: typeof input.verifier?.score === "number" ? input.verifier.score / 100 : typeof found?.score === "number" ? found.score / 100 : undefined,
    hunter: {
      email_finder: {
        score: found?.score,
        domain: found?.domain,
        company: found?.company,
        position: found?.position,
        source_type: found?.source_type,
        verification: found?.verification,
        sources: found?.sources,
      },
      verifier: input.verifier,
    },
    added_at: new Date().toISOString(),
  };
}

function buildDomainLeadValue(input: {
  email: HunterDomainSearchEmail;
  company: CandidateCompany;
  domain: string;
  score: number;
}): Record<string, unknown> {
  const status = input.email.verification?.status;
  const confidence = typeof input.email.confidence === "number" ? input.email.confidence / 100 : undefined;
  return {
    first_name: input.email.first_name,
    last_name: input.email.last_name,
    full_name: [input.email.first_name, input.email.last_name].filter(Boolean).join(" "),
    email: input.email.value,
    role: input.email.position,
    company_id: input.company.id,
    company_name: input.company.name,
    domain: input.domain,
    linkedin_url: input.email.linkedin,
    source: "hunter:domain-search",
    verification_status: status,
    verifier_status: status,
    verifier_result: status === "valid" ? "deliverable" : status === "accept_all" ? "risky" : "unknown",
    confidence,
    domain_search_score: input.score,
    hunter: {
      domain_search: {
        type: input.email.type,
        confidence: input.email.confidence,
        seniority: input.email.seniority,
        department: input.email.department,
        verification: input.email.verification,
        sources: input.email.sources,
      },
    },
    added_at: new Date().toISOString(),
  };
}

function appendLeadValue(existing: unknown, lead: Record<string, unknown>): Record<string, unknown>[] {
  const rows = Array.isArray(existing)
    ? existing.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    : existing && typeof existing === "object"
      ? [existing as Record<string, unknown>]
      : [];
  const email = typeof lead.email === "string" ? lead.email.toLowerCase() : undefined;
  const filtered = email ? rows.filter((row) => String(row.email ?? "").toLowerCase() !== email) : rows;
  return [...filtered, lead];
}

function hunterAllowedStatuses(options: { allowAcceptAll?: boolean; includeUnverified?: boolean }): Set<string> {
  const statuses = new Set(["valid"]);
  if (options.allowAcceptAll) statuses.add("accept_all");
  if (options.includeUnverified) statuses.add("unknown");
  return statuses;
}

function scoreHunterDomainEmail(email: HunterDomainSearchEmail, roleKeywords: string[]): number {
  const text = `${email.position ?? ""} ${email.department ?? ""} ${email.seniority ?? ""}`.toLowerCase();
  let score = typeof email.confidence === "number" ? email.confidence : 0;
  for (const keyword of roleKeywords) {
    if (text.includes(keyword)) score += 25;
  }
  if (/procurement|purchas|sourcing|supply/.test(text)) score += 100;
  if (/operations|manufacturing|plant|production|logistics/.test(text)) score += 60;
  if (/vp|vice president|director|chief|president|manager/.test(text)) score += 30;
  if (email.verification?.status === "valid") score += 20;
  if (email.verification?.status === "accept_all") score += 5;
  return score;
}

function splitWords(value: string | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function bestLeadConfidence(leads: Record<string, unknown>[]): number | undefined {
  const confidences = leads.map((lead) => (typeof lead.confidence === "number" ? lead.confidence : undefined)).filter((value): value is number => value !== undefined);
  return confidences.length ? Math.max(...confidences) : undefined;
}

async function resolveLinkedinAccountForProfile(
  client: UnipileClient,
  profileName: string,
  explicitAccountId?: string,
): Promise<string> {
  if (explicitAccountId) return explicitAccountId;
  const config = loadFcdxConfig();
  const stored = config.profiles?.[profileName]?.unipileLinkedinAccountId;
  if (stored) return stored;
  const accountId = await client.resolveLinkedinAccountId();
  const account = (await client.listAccounts()).find((row) => row.id === accountId);
  if (account) storeLinkedinAccountOnProfile(profileName, account);
  return accountId;
}

async function linkedinAccountIds(client: UnipileClient): Promise<Set<string>> {
  return new Set((await client.listAccounts()).filter((account) => account.type === "LINKEDIN").map((account) => account.id));
}

async function waitForLinkedinAccount(
  client: UnipileClient,
  before: Set<string>,
  timeoutMs: number,
): Promise<UnipileAccount | undefined> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const accounts = (await client.listAccounts()).filter((account) => account.type === "LINKEDIN");
    const added = accounts.filter((account) => !before.has(account.id));
    if (added.length === 1) return added[0];
    if (added.length > 1) return newestAccount(added);
    if (before.size === 0 && accounts.length === 1) return accounts[0];
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return undefined;
}

function newestAccount(accounts: UnipileAccount[]): UnipileAccount {
  return accounts[accounts.length - 1];
}

async function resolveLinkedinAccountBySafeSelector(
  client: UnipileClient,
  selector: { handle?: string; name?: string },
): Promise<UnipileAccount> {
  const accounts = (await client.listAccounts()).filter((account) => account.type === "LINKEDIN");
  if (!selector.handle && !selector.name) {
    if (accounts.length === 1) return accounts[0];
    throw new Error("Provide --handle or --name. Run `fcdx linkedin accounts` to see available handles.");
  }
  const normalizedHandle = selector.handle?.toLowerCase();
  const normalizedName = selector.name?.toLowerCase();
  const matches = accounts.filter((account) => {
    const handle = linkedinAccountHandle(account)?.toLowerCase();
    const name = account.name?.toLowerCase();
    return (normalizedHandle && handle === normalizedHandle) || (normalizedName && name === normalizedName);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error("No LinkedIn account matched that handle/name.");
  throw new Error("Multiple LinkedIn accounts matched. Use a more specific --handle.");
}

function storeLinkedinAccountOnProfile(profileName: string, account: UnipileAccount): void {
  setActiveProfile(profileName, {
    name: profileName,
    unipileLinkedinAccountId: account.id,
    unipileLinkedinHandle: linkedinAccountHandle(account),
    unipileLinkedinName: account.name,
  });
}

function publicLinkedinAccount(account: UnipileAccount): Record<string, unknown> {
  return {
    handle: linkedinAccountHandle(account),
    name: account.name,
    label: linkedinAccountLabel(account),
    status: account.sources?.map((source) => source.status).filter(Boolean).join(", ") || undefined,
  };
}

function linkedinAccountHandle(account: UnipileAccount): string | undefined {
  return account.connection_params?.im?.username || account.connection_params?.im?.publicIdentifier;
}

function linkedinAccountLabel(account: UnipileAccount): string {
  return linkedinAccountHandle(account) || account.name || "(connected LinkedIn account)";
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

async function addFilteredRowsToList(
  connection: DuckDBConnection,
  input: {
    listName: string;
    rows: CandidateCompany[];
    createList: boolean;
    description?: string;
    source?: string;
    reason?: string;
  },
): Promise<unknown> {
  const ensured = input.createList
    ? await ensureList(connection, { name: input.listName, description: input.description })
    : undefined;
  const result = await addCompaniesToList(connection, {
    listName: input.listName,
    companies: input.rows,
    source: input.source ?? "filterby",
    reason: input.reason ?? "filterby result",
  });
  return {
    id: result.list.id,
    name: result.list.name,
    created: ensured?.created ?? false,
    added: result.added,
    existing: result.existing,
  };
}

function parseFloatArg(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function parseJsonOption(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON: ${value}`);
  }
}

function splitOptionValues(values: string[] | undefined): string[] | undefined {
  const split = (values ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  return split.length ? split : undefined;
}

function resolveListName(positionalName?: string, optionName?: string): string {
  return resolveNamedArg("list", positionalName, optionName);
}

function resolveNamedArg(label: string, positionalName?: string, optionName?: string): string {
  if (positionalName && optionName && positionalName !== optionName) {
    throw new Error(`${label} was provided twice with different values: ${positionalName} and ${optionName}`);
  }
  const name = optionName ?? positionalName;
  if (!name) throw new Error(`Provide --${label} <name>`);
  return name;
}

function resolveCustomQuestion(question?: string, prompt?: string): string | undefined {
  const normalizedQuestion = question?.trim();
  const normalizedPrompt = prompt?.trim();
  if (normalizedQuestion && normalizedPrompt && normalizedQuestion !== normalizedPrompt) {
    throw new Error("--question and --prompt were both provided with different values");
  }
  return normalizedQuestion || normalizedPrompt || undefined;
}

function listEnrichmentValue(result: EnrichedCompany): Record<string, unknown> {
  return {
    question: result.enrichment.custom_evaluation?.question,
    custom_evaluation: result.enrichment.custom_evaluation,
    company_summary: result.enrichment.company_summary,
    target_alignment: result.enrichment.target_alignment,
    standard_questions: {
      supplies_datacenters: result.enrichment.supplies_datacenters,
      manufacturing_or_factories: result.enrichment.manufacturing_or_factories,
      high_volume_or_high_mix: result.enrichment.high_volume_or_high_mix,
      large_procurement_team: result.enrichment.large_procurement_team,
      turnkey_contract_manufacturer: result.enrichment.turnkey_contract_manufacturer,
    },
    final_notes: result.enrichment.final_notes,
    agent_metadata: result.agent_metadata,
  };
}

async function writeListExport(
  pathname: string,
  members: Awaited<ReturnType<typeof showList>>["members"],
  format: string,
): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  if (format === "candidates-jsonl") {
    await fs.writeFile(pathname, members.map((member) => JSON.stringify(member.company)).join("\n") + (members.length ? "\n" : ""), "utf8");
    return;
  }
  if (format === "jsonl") {
    await fs.writeFile(pathname, members.map((member) => JSON.stringify(member)).join("\n") + (members.length ? "\n" : ""), "utf8");
    return;
  }
  if (format === "lead-summary") {
    await writeLeadSummaryCsv(pathname, members);
    return;
  }
  if (format !== "csv") throw new Error("--format must be one of csv, jsonl, candidates-jsonl, lead-summary");

  const fieldKeys = Array.from(new Set(members.flatMap((member) => Object.keys(member.fields)))).sort();
  const columns = [
    "id",
    "name",
    "website",
    "url",
    "industry",
    "size",
    "country",
    "region",
    "locality",
    "linkedin_url",
    "founded",
    "membership_source",
    "membership_reason",
    "rank",
    "score",
    "tags",
    "tags_json",
    ...fieldKeys.map((key) => `field_${key}`),
  ];
  const lines = [columns.map(escapeCsv).join(",")];
  for (const member of members) {
    const row: Record<string, unknown> = {
      id: member.company.id,
      name: member.company.name,
      website: member.company.website,
      url: member.company.url,
      industry: member.company.industry,
      size: member.company.size,
      country: member.company.country,
      region: member.company.region,
      locality: member.company.locality,
      linkedin_url: member.company.linkedinUrl,
      founded: member.company.founded,
      membership_source: member.source,
      membership_reason: member.reason,
      rank: member.rank,
      score: member.score,
      tags: member.tags.map((tag) => tag.name).join("; "),
      tags_json: member.tags,
    };
    for (const key of fieldKeys) row[`field_${key}`] = member.fields[key];
    lines.push(columns.map((column) => escapeCsv(formatExportValue(row[column]))).join(","));
  }
  await fs.writeFile(pathname, `${lines.join("\n")}\n`, "utf8");
}

async function writeLeadSummaryCsv(
  pathname: string,
  members: Awaited<ReturnType<typeof showList>>["members"],
): Promise<void> {
  const columns = [
    "id",
    "name",
    "website",
    "size",
    "industry",
    "region",
    "locality",
    "product_catalog_answer",
    "product_catalog_summary",
    "product_catalog_evidence",
    "product_catalog_confidence",
    "selected_name",
    "selected_role",
    "selected_linkedin_url",
    "selected_location",
    "selected_reason",
    "verified_email",
    "verified_email_status",
    "verified_email_confidence",
    "email_lookup_written",
    "email_lookup_reason",
    "finder_status",
    "verifier_status",
    "verifier_result",
    "email_confidence",
  ];
  const lines = [columns.map(escapeCsv).join(",")];
  for (const member of members) {
    const enrichment = bestListEnrichment(member.fields);
    const leadCandidate = asRecord(member.fields.lead_candidate);
    const leads = listLeadRows(member.fields.leads);
    const bestLead = chooseBestLead(leads);
    const selectedName = textValue(leadCandidate?.name) || textValue(bestLead?.full_name);
    const selectedRole = textValue(leadCandidate?.role) || textValue(bestLead?.role);
    const selectedLinkedinUrl = textValue(leadCandidate?.linkedin_url) || textValue(bestLead?.linkedin_url);
    const row: Record<string, unknown> = {
      id: member.company.id,
      name: member.company.name,
      website: member.company.website,
      size: member.company.size,
      industry: member.company.industry,
      region: member.company.region,
      locality: member.company.locality,
      product_catalog_answer: textValue(enrichment?.custom_evaluation?.answer),
      product_catalog_summary: textValue(enrichment?.custom_evaluation?.reason) || textValue(enrichment?.company_summary),
      product_catalog_evidence: arrayText(enrichment?.custom_evaluation?.evidence),
      product_catalog_confidence: enrichment?.custom_evaluation?.confidence,
      selected_name: selectedName,
      selected_role: selectedRole,
      selected_linkedin_url: selectedLinkedinUrl,
      selected_location: textValue(leadCandidate?.location),
      selected_reason: textValue(leadCandidate?.reason) || (bestLead ? "Stored lead selected from list leads field." : ""),
      verified_email: textValue(bestLead?.email),
      verified_email_status: textValue(bestLead?.verification_status) || textValue(bestLead?.verifier_status),
      verified_email_confidence: bestLead?.confidence,
      email_lookup_written: Boolean(bestLead?.email),
      email_lookup_reason: bestLead?.email ? "hunter email written" : "No lead email stored",
      finder_status: textValue(bestLead?.verification_status),
      verifier_status: textValue(bestLead?.verifier_status),
      verifier_result: textValue(bestLead?.verifier_result),
      email_confidence: bestLead?.confidence,
    };
    lines.push(columns.map((column) => escapeCsv(formatExportValue(row[column]))).join(","));
  }
  await fs.writeFile(pathname, `${lines.join("\n")}\n`, "utf8");
}

function formatExportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function hasListField(fields: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(fields, field);
}

function bestListEnrichment(fields: Record<string, unknown>): Record<string, any> | undefined {
  const priority = [
    "product_catalog_enrichment",
    "water_valve_enrichment",
    "water_valve_full_enrichment_20260624",
    "enrichment",
  ];
  for (const key of priority) {
    const value = asRecord(fields[key]);
    if (value?.custom_evaluation || value?.company_summary) return value as Record<string, any>;
  }
  for (const value of Object.values(fields)) {
    const record = asRecord(value);
    if (record?.custom_evaluation || record?.company_summary) return record as Record<string, any>;
  }
  return undefined;
}

function listLeadRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  const record = asRecord(value);
  return record ? [record] : [];
}

function chooseBestLead(leads: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return [...leads]
    .filter((lead) => textValue(lead.email))
    .sort((a, b) => leadScore(b) - leadScore(a))[0];
}

function leadScore(lead: Record<string, unknown>): number {
  const status = textValue(lead.verification_status) || textValue(lead.verifier_status);
  const role = textValue(lead.role).toLowerCase();
  let score = typeof lead.confidence === "number" ? lead.confidence * 100 : 0;
  if (status === "valid") score += 100;
  if (status === "accept_all") score += 50;
  if (/procurement|purchas|sourcing|supply/.test(role)) score += 80;
  if (/operations|manufacturing|plant|production|logistics/.test(role)) score += 40;
  if (/vp|vice president|director|chief|president|manager/.test(role)) score += 25;
  return score;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function arrayText(value: unknown): string {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  return textValue(value);
}

function maskConfig(config: FcdxConfig, options: { showSecrets: boolean }): FcdxConfig {
  if (options.showSecrets) return config;
  return {
    ...config,
    env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, maskSecret(value)])),
    profiles: Object.fromEntries(
      Object.entries(config.profiles ?? {}).map(([name, profile]) => [name, maskProfile(profile)]),
    ),
  };
}

function maskProfile(profile: FcdxProfile): FcdxProfile {
  return {
    ...profile,
    ...(profile.unipileLinkedinAccountId
      ? { unipileLinkedinAccountId: maskSecret(profile.unipileLinkedinAccountId) }
      : {}),
  };
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
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
  } else if (error instanceof HunterApiError) {
    console.error(error.message);
    console.error(JSON.stringify(error.body, null, 2));
  } else if (error instanceof DeepResearchApiError) {
    console.error(error.message);
    console.error(JSON.stringify(error.body, null, 2));
  } else if (error instanceof AmbiguousCompanyMatchError) {
    console.error(error.message);
    console.error(
      JSON.stringify(
        {
          company: error.company,
          country: error.country ?? "*",
          hint: "Multiple DB rows matched. Showing up to maxShown rows. Retry the original command with --company-id set to the intended id.",
          shown: error.matches.length,
          maxShown: error.limit,
          matches: error.matches,
        },
        null,
        2,
      ),
    );
  } else if (error instanceof NoCompanyMatchError) {
    console.error(error.message);
    console.error(
      JSON.stringify(
        {
          company: error.company,
          country: error.country ?? "*",
          hint: "Try a narrower/wider name with fcdx filterby --company, or use --country \"*\" if the row is outside the default country.",
        },
        null,
        2,
      ),
    );
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
