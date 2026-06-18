# FCD-X CLI Architecture

This document explains how the `fcdx` CLI is put together, where each command
lives, and how data moves through the repo.

## High-Level Shape

`fcdx` is a TypeScript/Node CLI built with `commander`. The main entrypoint is
`src/cli/fcdx.ts`. It intentionally stays thin: it parses flags, calls focused
modules, writes command outputs, and handles errors. The heavier behavior lives
in smaller modules:

- `src/db/fcdx.ts`: DuckDB dataset cache, company filtering, Firecrawl cache metadata.
- `src/enrich/firecrawl.ts`: Firecrawl scrape/enrichment call and filesystem cache.
- `src/enrich/questions.ts`: agent prompt and JSON schema for enrichment.
- `src/target/companies.ts`: PDF target-list comparison, deterministic pre-rank, agent-ranked shortlist.
- `src/unipile/client.ts`: Unipile API wrapper for LinkedIn auth/search.
- `src/types.ts`: shared row/enrichment/result types.

There is also a legacy/batch enrichment CLI in `src/cli/enrich.ts`. It is still
important: it performs the parallel Firecrawl enrichment runs that create the
JSONL consumed by `fcdx target rank-enriched`.

## Command Tree

The main command tree is defined in `src/cli/fcdx.ts`:

```text
fcdx
  db init
  filterby
  crawl
  linkedin auth
  linkedin list-profiles
  target compare
  target shortlist
  target rank-enriched
```

Each command follows the same pattern:

1. Define flags with `commander`.
2. Read config from flags and/or environment variables.
3. Call a module function.
4. Write JSONL/CSV/JSON outputs.
5. Print a compact JSON summary.

## Configuration

Environment loading happens via `dotenv/config`.

- `src/config.ts` defines dataset defaults and the original target industries/size buckets.
- `src/db/fcdx.ts` defines `DEFAULT_DB_PATH`, using `FCDX_DB_PATH` when present.
- `src/cli/fcdx.ts` reads Unipile env vars for LinkedIn commands.
- `src/cli/enrich.ts` reads `FIRECRAWL_API_KEY` for batch enrichment.

Local secrets live in `.env`, which should not be committed.

## Data Model

Shared types are centralized in `src/types.ts`.

Key types:

- `CandidateCompany`: normalized working row used by filters and crawlers.
- `DatasetCompanyRow`: original-like dataset row preserved in enriched outputs.
- `CompanyEnrichment`: the agent output. It includes:
  - `company_summary`
  - five yes/no/unknown research answers
  - `target_alignment`, the agent's 0-100 fit score and rationale
  - `final_notes`
- `EnrichedCompany`: final JSONL unit combining source row, enrichment, and metadata.

The output JSONL from enrichment is the source of truth for the final
agent-ranked shortlist.

## DuckDB Dataset Cache

`src/db/fcdx.ts` owns the DuckDB layer.

Important functions:

- `connectFcdxDb`: opens a DuckDB instance/connection, optionally read-only.
- `initializeFcdxDb`: imports the PDL CSV into a `companies` table.
- `ensureSchema`: creates indexes and the `firecrawl_cache` table.
- `queryCompanies`: applies industry, country, headcount, website, and company filters.
- `upsertFirecrawlCache`: stores cache metadata for one-company crawl results.

`fcdx db init` calls `initializeFcdxDb`. `fcdx filterby` and `fcdx crawl` call
`queryCompanies`.

The DB is for structured dataset exploration. The full Firecrawl response body,
HTML, markdown, and screenshots are cached on disk.

## Firecrawl Enrichment

Firecrawl behavior is split across two files:

- `src/enrich/questions.ts`: prompt and JSON schema.
- `src/enrich/firecrawl.ts`: API call, cache reads/writes, artifact writes.

`buildEnrichmentPrompt` tells the agent to summarize the company, answer the
five research questions, and score `target_alignment` against the PDF target
profile.

`enrichmentSchema` is passed to Firecrawl's JSON extraction format. This keeps
the output structured enough for downstream sorting and CSV export.

`enrichCompanyWithFirecrawl` does the runtime work:

1. Check `output/cache/firecrawl/<company_id>/payload.firecrawl.json`.
2. If cache is missing or stale, call Firecrawl `/v2/scrape`.
3. Request markdown, HTML, screenshot, and structured JSON.
4. Write cache artifacts:
   - `payload.firecrawl.json`
   - `raw.firecrawl.json`
   - `page.md`
   - `page.html`
   - `screenshot.png` or `screenshot.txt`
5. Return an `EnrichedCompany`.

Old cache payloads without `target_alignment` are treated as stale so the newer
agent schema can be used.

## Batch Enrichment

`src/cli/enrich.ts` is the batch runner for enrichment. It is separate from the
main `fcdx` CLI because it predates the CLI formalization, but it remains the
right tool for large parallel Firecrawl jobs.

Main features:

- Reads candidate JSONL.
- Supports `--limit`, `--offset`, and `--website`.
- Uses `p-limit` for concurrency.
- Supports `--resume` by skipping IDs already present in output JSONL.
- Supports `--cache-dir` and `--force-refresh`.
- Writes:
  - enriched JSONL
  - flattened CSV
  - summary JSON
  - progress logs via stderr/stdout

The final target run uses this command to create
`output/enriched/target-agent-enriched.jsonl`.

## Target Comparison And Ranking

`src/target/companies.ts` owns the target-specific logic.

Inputs:

- `config/target_companies_and_categories.json`: codified PDF companies, aliases,
  categories, and also-mentioned incumbents.
- candidate JSONL from `fcdx filterby`.
- enriched JSONL from `npm run enrich`.

Main functions:

- `compareTargetCompanies`: checks how many PDF companies are in the candidate pool.
- `compareAlsoMentioned`: checks the also-mentioned/incumbent list.
- `buildTargetShortlist`: deterministic pre-rank for choosing what to enrich next.
- `buildAgentJudgedShortlist`: final shortlist by agent `target_alignment.score`.
- `writeCoverageCsv`, `writeShortlistCsv`, `writeAgentShortlistCsv`: CSV writers.

Important distinction:

- `fcdx target shortlist` is deterministic and lossy. It is a cheap pre-rank.
- `fcdx target rank-enriched` is the final path. It sorts enriched rows using the
  agent's understanding of each company.

## LinkedIn / Unipile

`src/unipile/client.ts` is a small typed API client for Unipile.

Main functions:

- `createHostedAuthLink`: creates the hosted LinkedIn auth URL.
- `listAccounts`: lists connected Unipile accounts.
- `resolveLinkedinAccountId`: picks the connected LinkedIn account or asks for `--account-id`.
- `searchCompanyParameters`: resolves a company name to LinkedIn company IDs.
- `searchLinkedinProfiles`: searches profiles using current-company filters.

`src/cli/fcdx.ts` wraps these in:

- `fcdx linkedin auth`
- `fcdx linkedin list-profiles`

The CLI resolves company IDs first to avoid broad text search results like
people whose names merely contain the company query.

## Filesystem Outputs

Common output locations:

- `output/candidates/*.jsonl`: candidate pools.
- `output/enriched/*.jsonl`: agent-enriched rows.
- `output/enriched/*.csv`: flattened enriched data.
- `output/enriched/*-summary.json`: run summaries.
- `output/enriched/*.log`: long-running job logs.
- `output/cache/firecrawl/<company_id>/`: Firecrawl cache artifacts.
- `output/target/doc-company-coverage.*`: PDF coverage comparison.
- `output/target/shortlist-200.*`: deterministic pre-rank.
- `output/target/agent-shortlist-200.*`: final agent-ranked shortlist.

## Adding A New Command

Preferred pattern:

1. Put reusable logic in a focused module, not directly in `src/cli/fcdx.ts`.
2. Add shared types to `src/types.ts` if the shape crosses module boundaries.
3. Add a small command wrapper in `src/cli/fcdx.ts`.
4. Make command output machine-readable where possible.
5. Add README/docs examples for the command.
6. Run `npm run check` and `npm run build`.

For long-running jobs, prefer a resumable JSONL output and a `tmux` wrapper.

## Current Design Tradeoffs

- The batch enrichment CLI is still `npm run enrich`, not a nested `fcdx enrich`
  command. It works well, but could be folded into `fcdx` later for consistency.
- CSV writing is intentionally local/simple. If schemas keep expanding, a shared
  CSV helper would reduce duplication.
- The deterministic target pre-rank is useful for triage only. It should not be
  treated as final ranking because the agent summary and target-alignment score
  preserve far more signal.
- Cache invalidation is schema-aware only for `target_alignment` right now. If
  the enrichment schema changes again, update the stale-cache check in
  `src/enrich/firecrawl.ts`.

