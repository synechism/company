# Deepresearch Async API

This document describes the FCD-X deepresearch service added to the monorepo.
The goal is to let an agent piloting `fcdx` submit longer research jobs, keep
working while they run, and fetch `report.txt` later by `job_id`.

## Architecture

The system has three layers:

- `fcdx` CLI client: `packages/fcdx/src/cli/fcdx.ts` adds the
  `fcdx deepresearch ...` command group. It resolves `API_URL` from the portable
  FCD-X config env store and calls the API through
  `packages/fcdx/src/deepresearch/client.ts`.
- Deepresearch API: `packages/deepresearch/src/api/server.ts` exposes
  `POST /jobs`, `GET /jobs/:jobId`, `GET /jobs/:jobId/report.txt`, and
  `GET /health`.
- Deepresearch worker: `packages/deepresearch/src/api/worker.ts` claims jobs
  from Redis/BullMQ and calls `packages/deepresearch/src/api/runner.ts`.

Shared API types live in `packages/deepresearch/src/api/types.ts`.
Service defaults live in `packages/deepresearch/src/api/config.ts`.
BullMQ queue construction lives in `packages/deepresearch/src/api/queue.ts`.

## Queue Model

`POST /jobs` accepts either:

```json
{
  "prompt": "Research this company...",
  "metadata": { "company_id": "..." },
  "options": { "runner": "open-deep-research" }
}
```

or:

```json
{
  "prompt_file": "/absolute/or/local/path/to/task.md",
  "metadata": { "company_id": "..." }
}
```

The server resolves `prompt_file` to prompt text, assigns a UUID unless
`job_id` was supplied, and enqueues the job in BullMQ. It returns:

```json
{
  "job_id": "...",
  "status_url": "http://127.0.0.1:8787/jobs/...",
  "report_url": "http://127.0.0.1:8787/jobs/.../report.txt"
}
```

Workers are independent processes. Start more workers, or increase
`DEEPRESEARCH_WORKER_CONCURRENCY`, to increase throughput.

## Runner Model

`packages/deepresearch/src/api/runner.ts` creates one artifact directory per
job under `DEEPRESEARCH_RESULTS_DIR`:

- `prompt.md`: exact prompt given to the runner.
- `job.json`: submitted job data and metadata.
- `report.txt`: final report returned to the CLI/API caller.
- `run.json`: timing, runner options, event counts, and output metadata.
- `runner.stdout.log` / `runner.stderr.log`: present for real runner jobs.

There are two runners:

- `stub`: writes a cheap deterministic report. This is for queue/API testing.
- `open-deep-research`: invokes
  `packages/deepresearch/scripts/run-open-deep-research.py` with `uv run python`
  inside `OPEN_DEEP_RESEARCH_DIR`.

The Python bridge imports the patched LangChain Open Deep Research graph from
the ignored external checkout, passes the configured prompt/model/search
options, streams graph events, and writes the final report to `report.txt`.

## CLI Commands

Set the API URL once:

```bash
fcdx config env set API_URL http://127.0.0.1:8787
```

Submit one prompt:

```bash
fcdx deepresearch submit \
  --prompt-file packages/deepresearch/results/water-valves/tasks/kennedy-valve-company-BFKJ7LbO.md
```

Submit one job per company in a DuckDB list:

```bash
fcdx deepresearch submit-list \
  --list water-valve-qualified \
  --prompt-file packages/deepresearch/prompts/manufacturing-outreach-research.md \
  --limit 5
```

`submit-list` appends company context to the prompt template. That context is
read from `showList` and includes the company row, list membership fields,
global tags, and list-local fields.

Poll or fetch:

```bash
fcdx deepresearch status --job-id <job_id>
fcdx deepresearch wait --job-id <job_id> --output output/reports/company.txt
fcdx deepresearch report --job-id <job_id>
```

## Local Runbook

Start Redis:

```bash
docker run -d --name fcdx-redis -p 6379:6379 redis:7-alpine
```

Run service processes in separate terminals:

```bash
pnpm deepresearch:api
pnpm deepresearch:worker
```

Smoke-test without model/search cost:

```bash
fcdx deepresearch submit \
  --api-url http://127.0.0.1:8787 \
  --prompt "Smoke test deepresearch queue" \
  --runner stub
```

Then:

```bash
fcdx deepresearch wait --api-url http://127.0.0.1:8787 --job-id <job_id>
```

## Configuration

Deepresearch service env:

- `REDIS_URL`: Redis connection URL.
- `DEEPRESEARCH_API_HOST`: API bind host.
- `DEEPRESEARCH_API_PORT`: API bind port.
- `DEEPRESEARCH_PUBLIC_URL`: optional URL used in returned links.
- `DEEPRESEARCH_QUEUE`: BullMQ queue name.
- `DEEPRESEARCH_WORKER_CONCURRENCY`: jobs claimed per worker process.
- `DEEPRESEARCH_RESULTS_DIR`: job artifact root.
- `DEEPRESEARCH_RUNNER`: default `open-deep-research` or `stub`.
- `OPEN_DEEP_RESEARCH_DIR`: external LangChain checkout path.
- `DEEPRESEARCH_MODEL`: default model for all Open Deep Research steps.
- `DEEPRESEARCH_SEARCH_API`: default search backend, normally `firecrawl`.

CLI config env:

- `API_URL`: base URL used by `fcdx deepresearch`.

Runner credentials:

- `FIRECRAWL_API_KEY`: required for Firecrawl-backed research.
- `OPENAI_API_KEY` and `OPENAI_BASE_URL`: OpenAI-compatible model endpoint.
- If `OPENAI_API_KEY` is not set and `ANTHROPIC_AUTH_TOKEN` is present, the
  runner bridge maps `ANTHROPIC_AUTH_TOKEN` to `OPENAI_API_KEY` and defaults
  `OPENAI_BASE_URL` to `https://api.deepseek.com`.

## Verification Performed

- `pnpm check`
- `pnpm build`
- Started the API at `http://127.0.0.1:8787`.
- Started a worker with `DEEPRESEARCH_RUNNER=stub`.
- Submitted a single stub job through `fcdx deepresearch submit`.
- Confirmed `fcdx deepresearch status` returned `state: completed`.
- Confirmed both `fcdx deepresearch report` and
  `GET /jobs/:jobId/report.txt` returned `report.txt`.
- Created a temporary list, ran `fcdx deepresearch submit-list --runner stub`,
  fetched the report with `fcdx deepresearch wait`, and deleted the list.
