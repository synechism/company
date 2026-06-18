# Datacenter Equipment Company Crawl

Scripts for triaging the People Data Labs free company dataset into candidate
companies, then crawling company websites to decide whether they manufacture
equipment serving the data center sector.

## First Pass

The initial target filter is:

- `country = united states`
- `industry in ["construction", "electrical/electronic manufacturing", "mechanical or industrial engineering"]`
- `size in ["201-500", "501-1000", "1001-5000", "5001-10000"]`
- `website` present

The strict size filter treats the requested `200-10000` range as the PDL buckets
from `201-500` through `5001-10000`. Pass `--include-51-200` to include the
neighboring `51-200` bucket for a looser mid-market pass.

## Setup

```bash
npm install
npx playwright install chromium
```

The Hyperbrowser key should be provided as an environment variable:

```bash
export HYPERBROWSER_API_KEY='...'
```

Do not commit `.env` files.

## Commands

Profile the full dataset:

```bash
npm run profile -- --input /home/abhi/data/free_company_dataset.csv
```

Write a filtered candidate queue:

```bash
npm run filter -- --input /home/abhi/data/free_company_dataset.csv --output output/candidates/strict.jsonl
```

Append known-good seed companies that metadata filters miss:

```bash
npm run filter -- --input /home/abhi/data/free_company_dataset.csv --output output/candidates/strict-with-seeds.jsonl --seed-file config/seed_companies.json
```

Check whether sanity-check domains are present:

```bash
npm run check-domains -- --domain https://www.tateglobal.com/amer/ https://www.smtc.com
```

Run a 5-company local Playwright pilot:

```bash
npm run pilot -- --input output/candidates/strict.jsonl --limit 5 --concurrency 2 --backend local
```

Run the same pilot with Hyperbrowser cloud browser sessions:

```bash
CRAWL_BACKEND=hyperbrowser npm run pilot -- --input output/candidates/strict.jsonl --limit 5 --concurrency 2
```

Run with Firecrawl extraction:

```bash
FIRECRAWL_API_KEY=... CRAWL_BACKEND=firecrawl npm run pilot -- --input output/candidates/strict.jsonl --limit 5 --concurrency 2
```

Enrich candidates with the five research questions:

```bash
FIRECRAWL_API_KEY=... npm run enrich -- --input output/candidates/strict.jsonl --output output/enriched/enriched.jsonl --csv-output output/enriched/enriched.csv --limit 5 --concurrency 2
```

The enriched JSONL preserves the source company row and appends answers,
confidence, reasons, and evidence for:

- data center supply/buildout involvement
- manufacturing/factory ownership
- high-volume or high-mix manufacturing
- large procurement team signals
- turnkey end-to-end contract manufacturing
- procurement-first target alignment with the PDF categories, including a
  0-100 agent score, manufacturing/procurement/category/data-center sub-scores,
  priority, best-fit categories, rationale, disqualifiers, and evidence

## FCD-X CLI

Use the TypeScript CLI during development:

```bash
npm run fcdx -- --help
```

Build it into `dist/` for an installable `fcdx` binary:

```bash
npm run build
```

### Environment

The CLI reads `.env` automatically. Common variables:

- `FCDX_DB_PATH`: default DuckDB path. If unset, the CLI uses `/home/abhi/data/fcdx.duckdb`.
- `FIRECRAWL_API_KEY`: required for `fcdx crawl`.
- `UNIPILE_BASE_URL`: Unipile tenant DSN/base URL, for example `https://api51.unipile.com:18107`.
- `UNIPILE_ACCESS_TOKEN`: Unipile API key.

### `fcdx db init`

Materialize the PDL CSV into DuckDB. This is the slow one-time conversion; after
it finishes, use the DB as the source of truth instead of reparsing the CSV.

```bash
npm run fcdx -- db init \
  --input /home/abhi/data/free_company_dataset.csv \
  --db output/fcdx.duckdb \
  --replace
```

Flags:

- `--input <path>`: PDL CSV path. Defaults to `PDL_COMPANY_CSV`, then `/home/abhi/data/free_company_dataset.csv`.
- `--db <path>`: DuckDB output path. Defaults to `FCDX_DB_PATH`, then `/home/abhi/data/fcdx.duckdb`.
- `--replace`: drop and rebuild cached DB tables.
- `--limit <n>`: import only N rows for a smoke test.

For a fast smoke test:

```bash
npm run fcdx -- db init --limit 10000 --db output/fcdx-smoke.duckdb --replace
```

### `fcdx filterby`

Filter companies from DuckDB:

```bash
npm run fcdx -- filterby \
  --industry='electronic' \
  --headcount-min=200 \
  --headcount-max=10000 \
  --output output/candidates/electronic-midmarket.jsonl
```

The industry filter is substring-based, so `electronic` matches
`electrical/electronic manufacturing`.

Flags:

- `--db <path>`: DuckDB path.
- `--industry <value...>`: industry substring filter. Repeat it or pass comma-separated values.
- `--country <country>`: headquarters country. Defaults to `united states`.
- `--headcount-min <n>`: minimum employee count interpreted against PDL size buckets.
- `--headcount-max <n>`: maximum employee count interpreted against PDL size buckets.
- `--company <name>`: company name, website, or domain substring.
- `--limit <n>`: max rows to return. Defaults to `50`.
- `--output <path>`: write matching rows as JSONL.

The strict 7.4k candidate pool can be regenerated with:

```bash
npm run fcdx -- filterby \
  --industry='construction,electrical/electronic manufacturing,mechanical or industrial engineering' \
  --headcount-min=200 \
  --headcount-max=10000 \
  --limit=10000 \
  --output output/candidates/db-strict.jsonl
```

### `fcdx crawl`

Run a single-company enrichment using the local Firecrawl cache:

```bash
FIRECRAWL_API_KEY=... npm run fcdx -- crawl --company='SMTC'
```

By default, Firecrawl payloads are cached under `output/cache/firecrawl/<company_id>/`
and cache metadata is stored in the DuckDB `firecrawl_cache` table. Re-running the
same command reuses the cached payload unless `--force-refresh` is passed.

Flags:

- `--company <name>`: required company name, website, or domain substring.
- `--db <path>`: DuckDB path.
- `--country <country>`: country filter. Defaults to `united states`; pass `'*'` to search globally.
- `--cache-dir <path>`: Firecrawl filesystem cache root. Defaults to `output/cache/firecrawl`.
- `--output <path>`: append enriched JSONL output. Defaults to `output/enriched/fcdx-crawl.jsonl`.
- `--timeout-ms <n>`: per-company Firecrawl timeout. Defaults to `120000`.
- `--force-refresh`: bypass the cache and spend a fresh Firecrawl request.

### `fcdx linkedin auth`

Set the Unipile tenant API base URL and API key in your shell or `.env` file:

```bash
export UNIPILE_BASE_URL='https://apiXXX.unipile.com:PORT'
export UNIPILE_ACCESS_TOKEN='...'
```

Generate a hosted authentication link for connecting LinkedIn:

```bash
npm run fcdx -- linkedin auth
```

The command prints the hosted auth URL and tries to open it in a browser. Add
`--no-open` to only print the URL.

Flags:

- `--base-url <url>`: Unipile DSN/base URL.
- `--access-token <token>`: Unipile API key.
- `--expires-minutes <n>`: hosted-auth link lifetime. Defaults to `60`.
- `--name <name>`: optional internal user ID/name echoed by Unipile.
- `--notify-url <url>`: optional webhook URL to receive `account_id`.
- `--success-url <url>`: browser redirect after success.
- `--failure-url <url>`: browser redirect after failure.
- `--reconnect-account <accountId>`: reconnect an existing account.
- `--no-open`: print the URL without launching a browser.

### `fcdx linkedin list-profiles`

Search for employees at a company:

```bash
npm run fcdx -- linkedin list-profiles --company='cronwell' --n=5
```

Search for a specific role/title at a company:

```bash
npm run fcdx -- linkedin list-profiles --company='cronwell' --p='CEO' --n=5
```

If more than one LinkedIn account is connected, pass `--account-id`. The default
search backend is LinkedIn Classic; use `--api sales_navigator` or
`--api recruiter` when the connected LinkedIn account has those products.

Flags:

- `--company <name>`: required company name.
- `--n <n>`: number of profiles to return. Defaults to `5`.
- `--p <title>`: optional role/title query, for example `CEO`.
- `--api <api>`: `classic`, `sales_navigator`, or `recruiter`.
- `--company-id <id...>`: LinkedIn company parameter IDs to use directly.
- `--no-resolve-company`: skip company-ID resolution and run a text search.
- `--show-company-matches`: print the LinkedIn company IDs selected for filtering.
- `--account-id <accountId>`: Unipile LinkedIn account ID.
- `--base-url <url>`: Unipile DSN/base URL.
- `--access-token <token>`: Unipile API key.
- `--json`: print normalized JSON instead of tab-separated rows.

### `fcdx target compare`

Compare the PDF target-company list against the candidate pool:

```bash
npm run fcdx -- target compare \
  --candidates output/candidates/db-strict.jsonl \
  --output output/target/doc-company-coverage.json \
  --csv-output output/target/doc-company-coverage.csv
```

Flags:

- `--config <path>`: target company/category config. Defaults to `config/target_companies_and_categories.json`.
- `--candidates <path>`: candidate JSONL path. Defaults to `output/candidates/db-strict.jsonl`.
- `--output <path>`: JSON summary output path.
- `--csv-output <path>`: CSV coverage output path.

### `fcdx target shortlist`

Create a deterministic pre-rank against the PDF target categories, excluding
companies already named in the PDF config. This is useful for choosing which
companies to spend agent credits on, but it is not the final agent-judged
shortlist.

```bash
npm run fcdx -- target shortlist \
  --candidates output/candidates/db-strict.jsonl \
  --limit 200 \
  --output output/target/shortlist-200.jsonl \
  --csv-output output/target/shortlist-200.csv
```

Flags:

- `--config <path>`: target company/category config. Defaults to `config/target_companies_and_categories.json`.
- `--candidates <path>`: candidate JSONL path. Defaults to `output/candidates/db-strict.jsonl`.
- `--enriched <path>`: optional enriched JSONL used to boost companies with prior yes answers.
- `--limit <n>`: number of rows to write. Defaults to `200`.
- `--output <path>`: JSONL shortlist output path.
- `--csv-output <path>`: CSV shortlist output path.

### `fcdx target rank-enriched`

Sort an agent-enriched JSONL by the agent's `target_alignment.score` and write
the top rows as JSONL and CSV. This is the preferred way to produce the final
target shortlist once candidates have gone through Firecrawl enrichment. The
ranker applies procurement/manufacturing guardrails: weak manufacturing,
procurement, or category fit can cap the effective ranking score even if the
agent's raw blended score is high.

```bash
npm run fcdx -- target rank-enriched \
  --enriched output/enriched/target-agent-enriched.jsonl \
  --min-score 70 \
  --min-manufacturing-fit 65 \
  --min-procurement-fit 65 \
  --min-category-fit 40 \
  --limit 200 \
  --output output/target/agent-shortlist-200.jsonl \
  --csv-output output/target/agent-shortlist-200.csv
```

Flags:

- `--config <path>`: target company/category config. Defaults to `config/target_companies_and_categories.json`.
- `--enriched <path>`: required enriched JSONL with `target_alignment` fields.
- `--min-score <n>`: minimum final target-alignment score.
- `--min-manufacturing-fit <n>`: minimum manufacturing/fabrication/assembly fit sub-score.
- `--min-procurement-fit <n>`: minimum procurement-complexity fit sub-score.
- `--min-category-fit <n>`: minimum PDF category fit sub-score.
- `--min-datacenter-fit <n>`: minimum data-center/critical-infrastructure fit sub-score.
- `--limit <n>`: number of ranked rows to write. Defaults to `200`.
- `--output <path>`: JSONL ranked shortlist output path.
- `--csv-output <path>`: CSV ranked shortlist output path.

## Docker

```bash
docker build -t dc-equipment-crawl .
docker run --rm \
  -v /home/abhi/data:/data:ro \
  -v "$PWD/output:/app/output" \
  --env PDL_COMPANY_CSV=/data/free_company_dataset.csv \
  dc-equipment-crawl npm run profile
```

For Hyperbrowser-backed jobs, pass `--env HYPERBROWSER_API_KEY`.
