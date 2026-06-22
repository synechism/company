# FCD-X CLI Architecture

FCD-X is now a pnpm workspace. The CLI package lives at `packages/fcdx`, and the
installable command is `fcdx`.

## Package Layout

```text
.
├── package.json                 # pnpm workspace scripts
├── pnpm-workspace.yaml
├── scripts/install-fcdx.mjs      # installs the built fcdx binary onto PATH
└── packages/fcdx
    ├── package.json              # @fcdx/cli
    ├── tsconfig.json
    └── src
        ├── cli/fcdx.ts           # commander command tree
        ├── config.ts             # env + ~/.config/fcdx/config.json resolution
        ├── db/fcdx.ts            # DuckDB companies + firecrawl_cache
        ├── db/workspace.ts       # lists, list fields, tags
        ├── enrich/firecrawl.ts   # one-company Firecrawl enrichment/cache
        ├── enrich/batch.ts       # file-backed batch enrichment
        ├── enrich/questions.ts   # prompt/schema
        ├── target/companies.ts   # target comparison/ranking helpers
        └── unipile/client.ts     # LinkedIn/Unipile client
```

The old standalone CSV/pilot scripts were removed. CSV import is now handled by
DuckDB through `fcdx db init`, and exploration happens through `fcdx filterby`,
lists, tags, and target helpers.

## Command Tree

The main command tree is defined in `packages/fcdx/src/cli/fcdx.ts`:

```text
fcdx
  config path|show|init
  db init|migrate
  filterby
  crawl
  enrich file
  list ...
  tag ...
  linkedin auth|list-profiles
  target compare|shortlist|rank-enriched
```

Each command is meant to be discoverable directly:

```bash
fcdx --help
fcdx list --help
fcdx enrich --help
```

## Configuration

Config resolution is centralized in `packages/fcdx/src/config.ts`.

The default config path is:

```text
~/.config/fcdx/config.json
```

Override it with:

```bash
FCDX_CONFIG=/path/to/config.json
```

Supported config keys:

```json
{
  "dbPath": "/home/abhi/data/fcdx.duckdb",
  "datasetPath": "/home/abhi/data/free_company_dataset.csv",
  "firecrawlCacheDir": "output/cache/firecrawl"
}
```

`--db` flags still override the configured DB path for one command.

## DuckDB Layer

`packages/fcdx/src/db/fcdx.ts` owns the core DuckDB cache:

- `companies`: imported PDL company rows
- `firecrawl_cache`: latest Firecrawl cache pointer/metadata per company

`packages/fcdx/src/db/workspace.ts` owns agent/user workspace state:

- `lists`
- `list_members`
- `list_fields`
- `list_field_values`
- `tags`
- `company_tags`

The implemented schema is visualized in:

```text
docs/fcdx-current-schema.dbml
```

The source `companies` table is kept clean. Lists are disposable workspaces;
tags are persistent company knowledge; list fields are list-local enrichment.

## Enrichment

There are two Firecrawl paths:

- `fcdx crawl --company ...`: one company, writes enriched JSONL and updates
  DuckDB `firecrawl_cache` metadata.
- `fcdx enrich file --input ...`: batch file-backed enrichment over candidate
  JSONL, writing enriched JSONL/CSV/summary files.

Full agent enrichment remains file-backed by design. DuckDB stores stable
workspace/indexing state and cache pointers.

## Installation

Root workspace scripts:

```bash
pnpm install
pnpm check
pnpm build
pnpm install-fcdx
```

`pnpm install-fcdx` builds `packages/fcdx/dist/cli/fcdx.js` and symlinks it into
a stable writable PATH directory, preferring the active Node/NVM bin directory.
It also creates an FCD-X data home and config file. Dataset files are not
bundled with the package; the user supplies a local CSV or Parquet and runs
`fcdx db init` to materialize DuckDB.

```text
~/.local/share/fcdx/fcdx.duckdb
~/.local/share/fcdx/cache/firecrawl
~/.config/fcdx/config.json
```

The config can point at either format:

```bash
fcdx config init --dataset /path/to/free_company_dataset.csv --force
fcdx config init --parquet /path/to/free_company_dataset.parquet --force
fcdx db init --replace
```

## Adding Commands

Preferred pattern:

1. Put reusable logic in a focused module under `packages/fcdx/src`.
2. Keep `packages/fcdx/src/cli/fcdx.ts` as a thin command wrapper.
3. Keep stdout machine-readable JSON where practical.
4. Add examples to README.
5. Run `pnpm check` and `pnpm build`.
