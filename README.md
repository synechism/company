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
