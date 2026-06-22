# FCD-X

CLI for exploring the People Data Labs Free Company Dataset, managing durable
company lists/tags in DuckDB, and running file-backed Firecrawl enrichment.

## Setup

```bash
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
- `FIRECRAWL_API_KEY`: required for `fcdx crawl` and `fcdx enrich file`.
- `UNIPILE_BASE_URL`: Unipile tenant DSN/base URL.
- `UNIPILE_ACCESS_TOKEN`: Unipile API key.

Do not commit `.env` files.

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
fcdx tag --help
fcdx enrich --help
```

## Core Workflow

Materialize the PDL CSV or Parquet into DuckDB once:

```bash
fcdx db init --replace
fcdx db migrate
```

The default target filter is:

- `country = united states`
- `industry in ["construction", "electrical/electronic manufacturing", "mechanical or industrial engineering"]`
- `size in ["201-500", "501-1000", "1001-5000", "5001-10000"]`
- `website` present

Generate the strict candidate JSONL:

```bash
fcdx filterby \
  --industry='construction,electrical/electronic manufacturing,mechanical or industrial engineering' \
  --headcount-min=200 \
  --headcount-max=10000 \
  --limit=10000 \
  --output output/candidates/db-strict.jsonl
```

Or filter and save directly into a durable list:

```bash
fcdx filterby \
  --industry='construction,electrical/electronic manufacturing,mechanical or industrial engineering' \
  --headcount-min=200 \
  --headcount-max=10000 \
  --limit=10000 \
  --to-list strict-midmarket-candidates \
  --create-list \
  --list-description "US 200-10000 employee candidates from target PDL industries"
```

## Enrichment

Single-company crawl/enrichment:

```bash
FIRECRAWL_API_KEY=... fcdx crawl --company='SMTC'
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

The enriched JSONL preserves the source company row and appends answers,
confidence, reasons, and evidence for:

- data center supply/buildout involvement
- manufacturing/factory ownership
- high-volume or high-mix manufacturing
- large procurement team signals
- turnkey end-to-end contract manufacturing
- procurement-first target alignment with the PDF categories, including
  manufacturing/procurement/category/data-center sub-scores

Full enrichment outputs are intentionally file-backed. DuckDB stores company
data, Firecrawl cache metadata, lists, list-local fields, tags, and tag mappings.

## Lists

Lists are durable named collections backed by separate DuckDB tables. They do
not modify the source `companies` table. List-specific columns, such as a CEO
found by LinkedIn, are stored as flexible fields on that list.

```bash
fcdx list create thermal-cooling --description "Cooling and thermal targets"
fcdx list add thermal-cooling --company='SMTC'
fcdx list add thermal-cooling --from-jsonl output/candidates/db-strict.jsonl --limit 100
fcdx list set-field thermal-cooling --company='SMTC' --field ceo_name --value 'Jane Doe' --type person
fcdx list show thermal-cooling --limit 25
fcdx list stats thermal-cooling
```

Useful commands:

- `list create <name>`: create a named list.
- `list ls`: show all lists.
- `list add <name>`: add by `--company`, `--company-id`, or `--from-jsonl`.
- `list remove <name>`: remove one company from a list.
- `list show <name>`: show members with list-specific fields and global tags.
- `list stats <name>`: summarize industry, size, fields, and tags.
- `list set-field <name>`: set a list-local field value for a company.
- `list fields <name>`: show list-local field definitions and value counts.
- `list delete <name> --yes`: delete list state only, never source company rows.

## Tags

Tags are global company annotations backed by a tag definition table plus a
company-to-tag mapping table. They accumulate over time as the agent inspects
companies.

```bash
fcdx tag create buyer:contract_manufacturer --description "Contract manufacturing buyer profile"
fcdx tag add --company='SMTC' --tag buyer:contract_manufacturer --confidence 0.9 --reason 'EMS target'
fcdx tag list --company='SMTC'
fcdx tag stats
```

DuckDB permits one writer at a time, so serialize mutating list/tag commands
from an agent loop or add a bulk command when applying many updates.

## LinkedIn

LinkedIn commands use Unipile.

```bash
fcdx linkedin auth
fcdx linkedin list-profiles --company='cronwell ai' --n=5
fcdx linkedin list-profiles --company='cronwell ai' --p='CEO' --n=5
```

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
