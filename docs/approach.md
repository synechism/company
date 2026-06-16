# Approach Notes

## Pipeline

1. Stream the PDL CSV and produce counts for the exact business filters.
2. Write a compact JSONL candidate queue with only fields needed for crawling.
3. Crawl candidate websites in parallel with bounded concurrency.
4. Save raw artifacts per company: HTML, visible text, screenshot, crawl result JSON.
5. Score each result with an explainable classifier, then replace or augment it with
   an LLM/agent verdict once the crawl prompt is validated.
6. Shard the queue by line range or hash prefix for production-scale parallel runs.

The first-pass metadata filter uses US companies with websites, `201-10000`
employees, and industries `construction`, `electrical/electronic manufacturing`,
or `mechanical or industrial engineering`.

The main output is an enriched dataset, not a filtered shortlist. Each candidate
keeps its source row and receives five yes/no/unknown answers with confidence,
reasoning, and evidence for data-center involvement, manufacturing/factories,
high-volume or high-mix manufacturing, procurement-team scale, and turnkey
contract-manufacturer status.

## Crawler Choice

Local Playwright is best for cheap pilot timing and artifact control.
Hyperbrowser is a better production candidate when we need cloud browser scale,
recordings, managed sessions, stealth/CAPTCHA support, and agentic tasks.
Firecrawl is worth benchmarking for cheaper content extraction when screenshots
and browser-state inspection are not required for every company.

## Production Orchestration

The first scalable version should use JSONL shards and many identical container
workers. Each worker reads a shard, writes idempotent per-company output files,
and can be retried safely. After the pilot, add a queue backend such as Redis,
SQS, or Postgres only if static shards become awkward.
