#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import type { DuckDBConnection } from "@duckdb/node-api";
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
import { appendJsonl } from "../crawl/artifacts.js";
import type { CandidateCompany } from "../types.js";
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
  fcdx list create thermal-cooling
  fcdx crawl --company "SMTC"

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
  fcdx profile use tom
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
  .command("use <name>")
  .description("Switch the active local profile, creating it if needed")
  .addHelpText(
    "after",
    `
Examples:
  fcdx profile use default
  fcdx profile use tom
`,
  )
  .action((name) => {
    const next = setActiveProfile(name, { name });
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
  .requiredOption("--company <name>", "Company name or website substring")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--country <country>", "Country filter; pass '*' to search globally", "united states")
  .option("--cache-dir <path>", "Filesystem cache root", resolveFirecrawlCacheDir())
  .option("-o, --output <path>", "Append enriched JSONL output", "output/enriched/fcdx-crawl.jsonl")
  .option("--timeout-ms <n>", "Per-company Firecrawl timeout", parseIntArg, 120_000)
  .option("--force-refresh", "Bypass cached Firecrawl payload and spend a fresh request", false)
  .addHelpText(
    "after",
    `
Examples:
  fcdx crawl --company "SMTC"
  fcdx crawl --company "SMTC" --country "*" --output output/enriched/smtc.jsonl
  fcdx crawl --company "SMTC" --force-refresh
`,
  )
  .action(async (options) => {
    const firecrawlApiKey = resolveConfigEnv("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY is required. Set it with `fcdx config env set FIRECRAWL_API_KEY <key>` or export it.");
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const country = options.country === "*" ? undefined : options.country;
      const [company] = await queryCompanies(connection, { company: options.company, country, limit: 1 });
      if (!company) throw new Error(`No company matched ${options.company}. Try: fcdx filterby --company "${options.company}"`);
      const result = await enrichCompanyWithFirecrawl(company, {
        apiKey: firecrawlApiKey,
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

const enrich = program.command("enrich").description("Batch Firecrawl enrichment over candidate JSONL");
enrich.addHelpText(
  "after",
  `
Examples:
  fcdx enrich file --input output/candidates/targets.jsonl --output output/enriched/targets.jsonl
  fcdx enrich file --help
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
  .option("--concurrency <n>", "Parallel Firecrawl requests", parseIntArg, Number(process.env.CRAWL_CONCURRENCY ?? 2))
  .option("--timeout-ms <n>", "Per-company Firecrawl timeout", parseIntArg, 120_000)
  .option("--cache-dir <path>", "Firecrawl filesystem cache root", resolveFirecrawlCacheDir())
  .option("--force-refresh", "Bypass cached Firecrawl payloads", false)
  .option("--website <host...>", "Only enrich candidates matching these websites/domains")
  .option("--resume", "Keep existing output JSONL and skip source ids already present", false)
  .option("--progress-every <n>", "Log progress every N completed companies", parseIntArg, 25)
  .addHelpText(
    "after",
    `
Examples:
  fcdx enrich file --input output/candidates/targets.jsonl --output output/enriched/targets.jsonl --summary output/enriched/targets-summary.json
  fcdx enrich file --input output/candidates/targets.jsonl --limit 25 --concurrency 5 --resume
  fcdx enrich file --input output/candidates/targets.jsonl --website smtc.com tateglobal.com
`,
  )
  .action(async (options) => {
    try {
      const firecrawlApiKey = resolveConfigEnv("FIRECRAWL_API_KEY");
      if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY is required. Set it with `fcdx config env set FIRECRAWL_API_KEY <key>` or export it.");
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
        website: options.website,
        resume: options.resume,
        progressEvery: options.progressEvery,
      });
      console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
      exitWithError(error);
    }
  });

const list = program
  .command("list")
  .description("Create and manage durable company lists")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list create targets --description "Priority companies"
  fcdx list add targets --company "SMTC"
  fcdx list add targets --from-jsonl output/candidates/db-strict.jsonl --limit 100
  fcdx list set-field targets --field ceo_name --type person
  fcdx list set-field targets --company "SMTC" --field ceo_name --value "Jane Doe"
  fcdx list show targets --limit 25

Subcommand options:
  fcdx list create --help
  fcdx list add --help
  fcdx list set-field --help
  fcdx list show --help
  fcdx list delete --help
`,
  );

list
  .command("create <name>")
  .description("Create a durable list without modifying the source companies table")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--description <text>", "List description")
  .option("--metadata-json <json>", "Optional JSON metadata for the list")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list create targets
  fcdx list create thermal-cooling --description "Cooling and thermal companies"
  fcdx list create targets --metadata-json '{"owner":"sales","priority":"high"}'
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const created = await createList(connection, {
        name,
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
  .command("delete <name>")
  .description("Delete a list and its list-specific fields; does not delete companies")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--yes", "Confirm deletion", false)
  .addHelpText(
    "after",
    `
Example:
  fcdx list delete targets --yes
`,
  )
  .action(async (name, options) => {
    if (!options.yes) throw new Error("Refusing to delete without --yes");
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify({ deleted: await deleteList(connection, name) }, null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("add <name>")
  .description("Add companies to a list by company query, company id, or candidate JSONL")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring to add")
  .option("--company-id <id>", "Exact company id to add")
  .option("--from-jsonl <path>", "Candidate JSONL file to add")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .option("--limit <n>", "Max companies to add for --company or --from-jsonl", parseIntArg)
  .option("--source <source>", "Source/provenance label for membership")
  .option("--reason <reason>", "Reason this company/list batch was added")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list add targets --company "SMTC"
  fcdx list add targets --company "SMTC" --country "*"
  fcdx list add targets --company-id pdl_company_id_here
  fcdx list add targets --from-jsonl output/candidates/db-strict.jsonl --limit 100 --source filterby
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const country = options.country === "*" ? undefined : options.country;
      if (options.fromJsonl) {
        const result = await addCompaniesFromJsonlToList(connection, {
          listName: name,
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
          listName: name,
          companies: [company],
          source: options.source ?? "company-id",
          reason: options.reason ?? options.companyId,
        });
        console.log(JSON.stringify({ ...result, matches: [company] }, null, 2));
        return;
      }
      if (options.company) {
        const result = await addCompanyQueryToList(connection, {
          listName: name,
          company: options.company,
          country,
          source: options.source,
          reason: options.reason,
          limit: options.limit ?? 1,
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
  .command("remove <name>")
  .description("Remove a company from a list without deleting the source company")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring")
  .option("--company-id <id>", "Exact company id")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .addHelpText(
    "after",
    `
Examples:
  fcdx list remove targets --company "SMTC"
  fcdx list remove targets --company-id pdl_company_id_here
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      const country = options.country === "*" ? undefined : options.country;
      const company = await resolveCompanyId(connection, {
        companyId: options.companyId,
        company: options.company,
        country,
      });
      console.log(JSON.stringify(await removeCompanyFromList(connection, { listName: name, companyId: company.id }), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("show <name>")
  .description("Show list members with list-specific fields and global tags")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--limit <n>", "Maximum rows to show", parseIntArg, 50)
  .addHelpText(
    "after",
    `
Examples:
  fcdx list show targets
  fcdx list show targets --limit 25
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify(await showList(connection, { listName: name, limit: options.limit }), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("stats <name>")
  .description("Summarize list membership by industry, size, tags, and list-specific fields")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx list stats targets
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify(await listStats(connection, name), null, 2));
    } catch (error) {
      exitWithError(error);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

list
  .command("set-field <name>")
  .description("Define a list-specific field, or set that field for one company")
  .requiredOption("--field <key>", "List field key")
  .option("--value <value>", "Field value; use --json-value for structured JSON")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--company <name>", "Company name, website, or LinkedIn substring")
  .option("--company-id <id>", "Exact company id")
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
  fcdx list set-field targets --field ceo_name --type person --description "CEO name"

  # Set the field for one company in this list.
  fcdx list set-field targets --company "SMTC" --field ceo_name --value "John Stone" --source linkedin

  # Store a structured value.
  fcdx list set-field targets --company "SMTC" --field ceo --json-value \\
    --value '{"name":"John Stone","linkedin_url":"https://www.linkedin.com/in/..."}'
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      if (!options.value && (options.company || options.companyId)) {
        throw new Error("Provide --value when setting a field for a company. Omit --company/--company-id to define the field only.");
      }
      if (!options.value) {
        console.log(
          JSON.stringify(
            await defineListField(connection, {
              listName: name,
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
            listName: name,
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
  .command("fields <name>")
  .description("List field definitions and value counts for a list")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .addHelpText(
    "after",
    `
Example:
  fcdx list fields targets
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(JSON.stringify(await listFields(connection, name), null, 2));
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
  fcdx tag create buyer:contract_manufacturer --description "Contract manufacturing target"
  fcdx tag add --company "SMTC" --tag buyer:contract_manufacturer --confidence 0.9
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
  .command("create <name>")
  .description("Create a tag definition")
  .option("--db <path>", "DuckDB path", resolveDbPath())
  .option("--description <text>", "Tag description")
  .option("--metadata-json <json>", "Optional JSON metadata for the tag")
  .addHelpText(
    "after",
    `
Examples:
  fcdx tag create buyer:contract_manufacturer
  fcdx tag create category:thermal_cooling --description "Thermal/cooling company"
  fcdx tag create priority:high --metadata-json '{"owner":"sales"}'
`,
  )
  .action(async (name, options) => {
    const { instance, connection } = await connectFcdxDb(options.db);
    try {
      console.log(
        JSON.stringify(
          { tag: await createTag(connection, { name, description: options.description, metadata: parseJsonOption(options.metadataJson) }) },
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
  .option("--company <name>", "Company name, website, or LinkedIn substring")
  .option("--company-id <id>", "Exact company id")
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
  .option("--company <name>", "Company name, website, or LinkedIn substring")
  .option("--company-id <id>", "Exact company id")
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
  .option("--company <name>", "Company name, website, or LinkedIn substring")
  .option("--company-id <id>", "Exact company id")
  .option("--country <country>", "Country filter for --company; pass '*' to search globally", "united states")
  .addHelpText(
    "after",
    `
Examples:
  fcdx tag list
  fcdx tag list --company "SMTC"
  fcdx tag list --company-id pdl_company_id_here
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
        console.log(JSON.stringify({ profile: options.profile, company: options.company, profiles, rawPaging: response.paging }, null, 2));
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

function createUnipileClient(options: { baseUrl?: string; accessToken?: string }): UnipileClient {
  const baseUrl = options.baseUrl || resolveConfigEnv("UNIPILE_BASE_URL");
  const accessToken = options.accessToken || resolveConfigEnv("UNIPILE_ACCESS_TOKEN");
  if (!baseUrl) throw new Error("UNIPILE_BASE_URL is required. Set it with `fcdx config env set UNIPILE_BASE_URL <url>` or pass --base-url.");
  if (!accessToken) throw new Error("UNIPILE_ACCESS_TOKEN is required. Set it with `fcdx config env set UNIPILE_ACCESS_TOKEN <token>` or pass --access-token.");
  return new UnipileClient({ baseUrl, accessToken });
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
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
