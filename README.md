# FCD-X

CLI for exploring the People Data Labs Free Company Dataset, managing durable
company lists/tags in DuckDB, and running file-backed Firecrawl enrichment.

## Setup

Prerequisites:

- Node.js 20+
- pnpm 10+
- a local copy of the People Data Labs Free Company Dataset as CSV or Parquet

If pnpm is not installed:

```bash
corepack enable
corepack prepare pnpm@10.24.0 --activate
```

Clone the repo, install dependencies, build the CLI, and install `fcdx` onto
`PATH`:

```bash
git clone <repo-url>
cd <repo>
pnpm install
pnpm install-fcdx
```

`pnpm install-fcdx` builds the CLI, installs an `fcdx` executable into a
writable directory on `PATH`, creates an FCD-X data home, and writes config.
It does not bundle or download the dataset; point the CLI at a CSV or Parquet
that you have locally, then materialize DuckDB with `fcdx db init`.

Installer paths:

- config: `~/.config/fcdx/config.json`
- data home: `~/.local/share/fcdx`
- DuckDB: `~/.local/share/fcdx/fcdx.duckdb`
- Firecrawl cache: `~/.local/share/fcdx/cache/firecrawl`

Verify the binary is available:

```bash
fcdx --help
```

Then choose one data-source setup.

CSV-backed setup:

```bash
fcdx config init \
  --db ~/.local/share/fcdx/fcdx.duckdb \
  --dataset /path/to/free_company_dataset.csv \
  --firecrawl-cache-dir ~/.local/share/fcdx/cache/firecrawl \
  --force

fcdx db init --replace
```

Parquet-backed setup:

```bash
fcdx config init \
  --db ~/.local/share/fcdx/fcdx.duckdb \
  --parquet /path/to/free_company_dataset.parquet \
  --firecrawl-cache-dir ~/.local/share/fcdx/cache/firecrawl \
  --force

fcdx db init --replace
```

This creates the `companies` table and the empty workspace/cache tables used by
lists, tags, and Firecrawl cache metadata.

You can also skip config for one-off imports:

```bash
fcdx db init --csv /path/to/free_company_dataset.csv --replace
fcdx db init --parquet /path/to/free_company_dataset.parquet --replace
```

To generate a Parquet from an existing local DuckDB:

```bash
fcdx db export-parquet --output /path/to/free_company_dataset.parquet
```

The config file defaults to `~/.config/fcdx/config.json`. Set `FCDX_CONFIG` to
use a different JSON file.

Common environment variables:

- `FCDX_CONFIG`: config JSON path.
- `FCDX_DB_PATH`: fallback DuckDB path if config does not set `dbPath`.
- `PDL_COMPANY_CSV`: fallback CSV path if config does not set `datasetPath`.
- `FCDX_PARQUET_PATH`: fallback Parquet path if config does not set `parquetPath`.
- `FIRECRAWL_API_KEY`: required for `fcdx crawl`, `fcdx enrich file`, and `fcdx enrich list`.
- `UNIPILE_BASE_URL`: Unipile tenant DSN/base URL.
- `UNIPILE_ACCESS_TOKEN`: Unipile API key.
- `HUNTER_API_KEY`: Hunter API key for verified lead email lookup.
- `API_URL`: deepresearch API URL used by `fcdx deepresearch`.
- `REDIS_URL`: Redis URL used by the deepresearch API and workers.
- `DEEPRESEARCH_COMPANY_CACHE_ROOT`: fallback per-company report cache root.

Do not commit `.env` files.

## External Service Credentials

Filtering, lists, tags, and DuckDB setup are fully local. Crawling, enrichment,
and LinkedIn lookup require API credentials.

Recommended: store credentials in the FCD-X config file so the installed `fcdx`
binary works from any directory:

```bash
fcdx config env set FIRECRAWL_API_KEY fc-...
fcdx config env set UNIPILE_BASE_URL https://api51.unipile.com:18107
fcdx config env set UNIPILE_ACCESS_TOKEN <token>
fcdx config env set HUNTER_API_KEY <token>
fcdx config env set API_URL http://127.0.0.1:8787
fcdx config env list
```

Values are masked by default in `config show` and `config env list`.

You can still use a repo-local `.env` file while developing:

```bash
cp .env.example .env
```

Then fill in the services you plan to use:

```env
# Required for fcdx crawl, fcdx enrich file, and fcdx enrich list
FIRECRAWL_API_KEY=fc-...

# Required for fcdx linkedin auth, list-profiles, and people
UNIPILE_BASE_URL=https://api51.unipile.com:18107
UNIPILE_ACCESS_TOKEN=...

# Required for fcdx lead find-email
HUNTER_API_KEY=...

# Required for fcdx deepresearch commands
API_URL=http://127.0.0.1:8787

# Required for the deepresearch API/worker service
REDIS_URL=redis://127.0.0.1:6379
DEEPRESEARCH_COMPANY_CACHE_ROOT=output/cache/firecrawl
DEEPRESEARCH_RUNNER=open-deep-research
```

You can also pass credentials for a single command:

```bash
FIRECRAWL_API_KEY=fc-... fcdx crawl --company SMTC
```

The CLI loads both config-stored env values and repo-local `.env` values. Config
env is the portable option after installing `fcdx` onto `PATH`.

LinkedIn accounts are stored on local profiles so users do not need to pass raw
Unipile account IDs:

```bash
fcdx profile show
fcdx linkedin auth
fcdx linkedin accounts
fcdx linkedin use-account --handle "Jane Doe"
fcdx linkedin list-profiles --company "cronwell ai" --p CEO --n 5
fcdx linkedin people --list qualified-targets --role "procurement supply chain" --json
```

## Development

The repo is a pnpm workspace. The CLI package lives in `packages/fcdx`.

```bash
pnpm check
pnpm build
pnpm fcdx --help
```

Once installed, use the binary directly:

```bash
fcdx --help
fcdx list --help
fcdx list add --help
fcdx tag --help
fcdx tag add --help
fcdx enrich --help
fcdx enrich file --help
```

Parent command help shows available subcommands. To see the full option list for
a subcommand, run help on that exact command, e.g. `fcdx list add --help`,
`fcdx list set-field --help`, or `fcdx linkedin list-profiles --help`.

## CLI Style

FCD-X examples use a consistent flag style:

- Prefer `--flag value`, not `--flag=value`.
- Quote values only when they contain spaces, commas, `*`, or shell-sensitive
  characters.
- Use repeated flags or comma-separated values when a command says it supports
  multiple values.
- Use kebab-case for list names, snake_case for list field names, and namespaced
  tags such as `buyer:contract_manufacturer`.

Examples:

```bash
fcdx list add --list targets --company SMTC
fcdx list add --list targets --company-id pdl_company_id_here
fcdx linkedin list-profiles --company "cronwell ai" --p CEO --n 5
fcdx filterby --industry "construction,electrical/electronic manufacturing"
fcdx list delete-entry --list targets --company-id pdl_company_id_here
```

## Core Workflow

Materialize the PDL CSV or Parquet into DuckDB once:

```bash
fcdx db init --replace
```

`db init` also creates the workspace/cache tables. Use `fcdx db migrate` only
when you already have an existing DuckDB and want to add/update those tables
without reimporting the dataset.

The default target filter is:

- `country = united states`
- `industry in ["construction", "electrical/electronic manufacturing", "mechanical or industrial engineering"]`
- `size in ["201-500", "501-1000", "1001-5000", "5001-10000"]`
- `website` present

Generate the strict candidate JSONL:

```bash
fcdx filterby \
  --industry "construction,electrical/electronic manufacturing,mechanical or industrial engineering" \
  --headcount-min 200 \
  --headcount-max 10000 \
  --limit 10000 \
  --output output/candidates/db-strict.jsonl
```

Or filter and save directly into a durable list:

```bash
fcdx filterby \
  --industry "construction,electrical/electronic manufacturing,mechanical or industrial engineering" \
  --headcount-min 200 \
  --headcount-max 10000 \
  --limit 10000 \
  --to-list strict-midmarket-candidates \
  --create-list \
  --list-description "US 200-10000 employee candidates from target PDL industries"
```

## Enrichment

Single-company crawl/enrichment:

```bash
FIRECRAWL_API_KEY=... fcdx crawl --company SMTC
FIRECRAWL_API_KEY=... fcdx crawl --company-id pdl_company_id_here
```

Batch file-backed enrichment:

```bash
FIRECRAWL_API_KEY=... fcdx enrich file \
  --input output/candidates/db-strict.jsonl \
  --output output/enriched/enriched.jsonl \
  --summary output/enriched/enriched-summary.json \
  --csv-output output/enriched/enriched.csv \
  --limit 5 \
  --concurrency 2
```

For task-specific sourcing, prefer enriching the full bounded candidate set
instead of doing narrow keyword filtering over company names/domains. For
example, if a list or candidate file has fewer than about 10,000 companies:

```bash
fcdx list export --list water-infra --format candidates-jsonl --output output/candidates/water-infra.jsonl

FIRECRAWL_API_KEY=... fcdx enrich file \
  --input output/candidates/water-infra.jsonl \
  --output output/enriched/water-infra.jsonl \
  --summary output/enriched/water-infra-summary.json \
  --csv-output output/enriched/water-infra.csv \
  --question "Does this company manufacture water valves or waterworks flow-control valves?" \
  --concurrency 10 \
  --resume
```

Or enrich a DuckDB list directly and store the result back on that list:

```bash
fcdx enrich list \
  --list water-infra \
  --field water_valve_enrichment \
  --question "Does this company manufacture water valves or waterworks flow-control valves?" \
  --concurrency 10

fcdx list show --list water-infra --limit 10
```

`enrich list` caches raw Firecrawl page data per company and stores the
prompt-specific answer in list-local DuckDB fields. Overlapping lists can have
different enrichment columns, e.g. `thermal_enrichment` on one list and
`water_valve_enrichment` on another, without mutating the source company table.

The enriched JSONL preserves the source company row and appends answers,
confidence, reasons, and evidence for:

- data center supply/buildout involvement
- manufacturing/factory ownership
- high-volume or high-mix manufacturing
- large procurement team signals
- turnkey end-to-end contract manufacturing
- procurement-first target alignment with the PDF categories, including
  manufacturing/procurement/category/data-center sub-scores

File enrichment outputs are file-backed. List enrichment writes prompt-specific
results into `list_field_values` while DuckDB continues to store company data,
Firecrawl cache metadata, lists, list-local fields, tags, and tag mappings.

## Company Resolution

Commands that mutate or inspect one DB company, such as `crawl`, `list add`,
`list set-field`, and `tag add`, accept either `--company` or `--company-id`.
`--company` is intentionally strict: it succeeds only when the search resolves
to exactly one company row. If multiple rows match, FCD-X prints the matched
company rows, including ids, websites, industry, size, region, locality, and
LinkedIn URL, then exits without making changes.

When that happens, rerun the original command with the intended id:

```bash
fcdx list add --list targets --company "SMTC"
fcdx list add --list targets --company-id pdl_company_id_here
```

Use `fcdx filterby --company "SMTC"` when you want an exploratory search that
can return many rows.

## Lists

Lists are durable named collections backed by separate DuckDB tables. They do
not modify the source `companies` table. List-specific columns, such as a CEO
found by LinkedIn, are stored as flexible fields on that list.

```bash
fcdx list create --list thermal-cooling --description "Cooling and thermal targets"
fcdx list add --list thermal-cooling --company SMTC
fcdx list add --list thermal-cooling --company-id pdl_company_id_here
fcdx list add --list thermal-cooling --from-jsonl output/candidates/db-strict.jsonl --limit 100
fcdx list set-field --list thermal-cooling --company-id pdl_company_id_here --field ceo_name --value "Jane Doe" --type person
fcdx list show --list thermal-cooling --limit 25
fcdx list stats --list thermal-cooling
fcdx list export --list thermal-cooling --format csv --output output/lists/thermal-cooling.csv
fcdx list export --list thermal-cooling --format candidates-jsonl --output output/candidates/thermal-cooling.jsonl
fcdx list delete-entry --list thermal-cooling --company-id pdl_company_id_here
```

Useful commands:

- `list create <name>`: create a named list.
- `list ls`: show all lists.
- `list add --list <name>`: add by unambiguous `--company`, exact `--company-id`, or `--from-jsonl`.
- `list remove --list <name>`: remove one company from a list by unambiguous name or exact id.
- `list delete-entry --list <name> --company-id <id>`: remove a specific list entry by id.
- `list show --list <name>`: show members with list-specific fields and global tags.
- `list export --list <name>`: export to `csv`, member `jsonl`, or `candidates-jsonl` for `fcdx enrich file`.
- `list stats --list <name>`: summarize industry, size, fields, and tags.
- `list set-field --list <name>`: define a list-local field or set a field value for one company.
- `list fields --list <name>`: show list-local field definitions and value counts.
- `list delete --list <name> --yes`: delete list state only, never source company rows.

## Tags

Tags are global company annotations backed by a tag definition table plus a
company-to-tag mapping table. They accumulate over time as the agent inspects
companies.

```bash
fcdx tag create --tag buyer:contract_manufacturer --description "Contract manufacturing buyer profile"
fcdx tag add --company SMTC --tag buyer:contract_manufacturer --confidence 0.9 --reason "EMS target"
fcdx tag add --company-id pdl_company_id_here --tag buyer:contract_manufacturer
fcdx tag list --company SMTC
fcdx tag stats
```

DuckDB permits one writer at a time, so serialize mutating list/tag commands
from an agent loop or add a bulk command when applying many updates.

## LinkedIn

LinkedIn commands use Unipile. `list-profiles` is useful for one-off searches;
`people` is intended for the qualified-list workflow and does not write to the
database.

```bash
fcdx linkedin auth
fcdx linkedin list-profiles --company "cronwell ai" --n 5
fcdx linkedin list-profiles --company "cronwell ai" --p CEO --n 5
fcdx linkedin people --list water-valve-qualified --role "procurement supply chain" --limit-per-company 10 --json
```

After the agent selects a contact from `linkedin people`, use Hunter to find and
verify the email. Verified leads are stored as a list-local `leads` array field.

```bash
fcdx lead find-email \
  --list water-valve-qualified \
  --company-id pdl_company_id_here \
  --first-name Jane \
  --last-name Doe \
  --domain example.com \
  --role "VP Supply Chain"

fcdx list show --list water-valve-qualified --limit 10
```

## Deep Research Jobs

Deep research runs asynchronously through `packages/deepresearch`: the API
accepts jobs, Redis/BullMQ stores the queue, and one or more workers claim jobs
and write `report.txt` artifacts.

Start Redis, then run the API and a worker together from the repo root:

```bash
pnpm dev
```

For a cheap local queue smoke test that never launches the real research model:

```bash
pnpm dev:stub
```

The `fcdx` CLI is not a daemon; use it from another terminal while `pnpm dev`
keeps the API and worker running.

You can still run the pieces separately when debugging:

```bash
pnpm deepresearch:api
pnpm deepresearch:worker
```

Configure the installed CLI to point at the API:

```bash
fcdx config env set API_URL http://127.0.0.1:8787
```

Submit one prompt file:

```bash
fcdx deepresearch submit \
  --prompt-file packages/deepresearch/results/water-valves/tasks/kennedy-valve-company-BFKJ7LbO.md
```

Submit one job per company in a list:

```bash
fcdx deepresearch submit-list \
  --list water-valve-qualified \
  --prompt-file packages/deepresearch/prompts/manufacturing-outreach-research.md \
  --limit 5 \
  --output output/deepresearch/water-valve-jobs.json
```

Inspect a whole submitted list or fetch one report:

```bash
fcdx deepresearch status-list --jobs-file output/deepresearch/water-valve-jobs.json
fcdx deepresearch status --job-id <job_id>
fcdx deepresearch wait --job-id <job_id> --output output/reports/company.txt
fcdx deepresearch report --job-id <job_id>
```

Use `--runner stub` for cheap queue/API smoke tests. Use the default
`open-deep-research` runner for real research.

When a job has a `company_id`, deepresearch caches the finished report under the
same company cache root as Firecrawl, but in its own subfolder:
`<firecrawl-cache-root>/<safe-company-id>/deepresearch/report.txt`. Re-running
the same company returns that cached report unless you pass `--force-refresh`.

Implementation details and the runbook are documented in
[docs/deepresearch-async-api.md](docs/deepresearch-async-api.md).

## Target Helpers

```bash
fcdx target compare \
  --config config/target_companies_and_categories.json \
  --candidates output/candidates/db-strict.jsonl

fcdx target shortlist \
  --config config/target_companies_and_categories.json \
  --candidates output/candidates/db-strict.jsonl \
  --limit 200

fcdx target rank-enriched \
  --config config/target_companies_and_categories.json \
  --enriched output/enriched/target-agent-enriched.jsonl \
  --limit 200
```

## Schema

The current implemented DB schema is documented in DBML:

[docs/fcdx-current-schema.dbml](docs/fcdx-current-schema.dbml)
