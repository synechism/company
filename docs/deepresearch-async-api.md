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

## One Request End To End

An async API is useful when a request takes too long to finish while the caller
waits. Deep research can take minutes. Instead of making `fcdx` sit on one HTTP
request until the model finishes, the API immediately gives back a `job_id`.
The agent can later ask, "is this job done yet?" and, once it is done, fetch
`report.txt`.

Think of the system as a restaurant:

- `fcdx` is the customer placing an order.
- The API server is the cashier writing the order ticket.
- Redis/BullMQ is the rail where order tickets wait.
- A worker is the cook who takes one ticket and makes the meal.
- `report.txt` is the finished meal.

Here is the full path for one request.

### 1. The Agent Calls `fcdx`

The agent can submit one prompt:

```bash
fcdx deepresearch submit \
  --prompt-file packages/deepresearch/results/water-valves/tasks/kennedy-valve-company-BFKJ7LbO.md
```

The CLI command is registered in
[`packages/fcdx/src/cli/fcdx.ts:1962`](../packages/fcdx/src/cli/fcdx.ts#L1962).
That command reads `--prompt` or `--prompt-file` with `readPromptOption` in
[`packages/fcdx/src/cli/fcdx.ts:2445`](../packages/fcdx/src/cli/fcdx.ts#L2445),
creates a deepresearch client with `createDeepResearchClient` in
[`packages/fcdx/src/cli/fcdx.ts:2431`](../packages/fcdx/src/cli/fcdx.ts#L2431),
and calls `client.submit(...)` in
[`packages/fcdx/src/cli/fcdx.ts:1998`](../packages/fcdx/src/cli/fcdx.ts#L1998).

The actual HTTP call is in
[`packages/fcdx/src/deepresearch/client.ts:36`](../packages/fcdx/src/deepresearch/client.ts#L36).
It sends a `POST /jobs` request with JSON containing the prompt, metadata, and
runner options.

The API URL comes from `--api-url`, then config env `API_URL`, then fallback
values. That lookup is in `resolveDeepResearchApiUrl` at
[`packages/fcdx/src/cli/fcdx.ts:2435`](../packages/fcdx/src/cli/fcdx.ts#L2435).

### 2. The API Receives The Job

The API route for job submission starts at
[`packages/deepresearch/src/api/server.ts:42`](../packages/deepresearch/src/api/server.ts#L42).
It does four important things:

1. Reads the request body as a `SubmitJobRequest`.
2. Resolves prompt text through `resolvePrompt` at
   [`packages/deepresearch/src/api/server.ts:125`](../packages/deepresearch/src/api/server.ts#L125).
3. Creates a UUID `jobId` if the caller did not provide one.
4. Calls `queue.add(...)` at
   [`packages/deepresearch/src/api/server.ts:59`](../packages/deepresearch/src/api/server.ts#L59).

That `queue.add(...)` line is where the job stops being "an HTTP request" and
becomes "work waiting in Redis".

The job data shape is defined in
[`packages/deepresearch/src/api/types.ts:20`](../packages/deepresearch/src/api/types.ts#L20).
The response shape, including `job_id`, `status_url`, and `report_url`, is
defined in
[`packages/deepresearch/src/api/types.ts:50`](../packages/deepresearch/src/api/types.ts#L50).

### 3. Redis Stores The Waiting Job

BullMQ needs Redis because workers may run in different processes or on
different machines from the API server. The queue connection settings are built
in
[`packages/deepresearch/src/api/queue.ts:5`](../packages/deepresearch/src/api/queue.ts#L5).
The queue itself is created in
[`packages/deepresearch/src/api/queue.ts:18`](../packages/deepresearch/src/api/queue.ts#L18).

The service configuration comes from
[`packages/deepresearch/src/api/config.ts:21`](../packages/deepresearch/src/api/config.ts#L21).
That function reads settings such as `REDIS_URL`, `DEEPRESEARCH_QUEUE`,
`DEEPRESEARCH_RESULTS_DIR`, and `DEEPRESEARCH_RUNNER`.

After the API writes the job into Redis, it returns HTTP `202 Accepted` at
[`packages/deepresearch/src/api/server.ts:66`](../packages/deepresearch/src/api/server.ts#L66).
This does not mean the research is done. It means: "the job was accepted and
queued."

### 4. A Worker Claims The Job

The worker process is separate from the API process. It starts in
[`packages/deepresearch/src/api/worker.ts:27`](../packages/deepresearch/src/api/worker.ts#L27).
That `new Worker(...)` call tells BullMQ:

- which queue to watch,
- how many jobs this process can run at once,
- and which function should run for each claimed job.

The function it calls is `runDeepResearchJob` from
[`packages/deepresearch/src/api/runner.ts:13`](../packages/deepresearch/src/api/runner.ts#L13).
Worker event logs for active, completed, and failed jobs live in
[`packages/deepresearch/src/api/worker.ts:40`](../packages/deepresearch/src/api/worker.ts#L40).

If multiple workers are running, BullMQ distributes jobs among them. The CLI
does not need to know which worker got the job.

### 5. The Runner Creates The Job Folder

`runDeepResearchJob` is where a queued job becomes files on disk. It creates one
artifact directory per job in
[`packages/deepresearch/src/api/runner.ts:18`](../packages/deepresearch/src/api/runner.ts#L18).
Then it writes:

- `prompt.md` at
  [`packages/deepresearch/src/api/runner.ts:27`](../packages/deepresearch/src/api/runner.ts#L27),
- `job.json` at
  [`packages/deepresearch/src/api/runner.ts:28`](../packages/deepresearch/src/api/runner.ts#L28).

Before running expensive research, it checks the per-company report cache at
[`packages/deepresearch/src/api/runner.ts:34`](../packages/deepresearch/src/api/runner.ts#L34).
If `report.txt` already exists and the caller did not pass `--force-refresh`,
the runner copies the cached report into this job's artifact folder, marks the
job as a cache hit, and returns immediately. The cache path is resolved by
`resolveDeepResearchCache` at
[`packages/deepresearch/src/api/runner.ts:166`](../packages/deepresearch/src/api/runner.ts#L166).

The runner then chooses one of two paths:

- `stub`, for cheap API/queue tests, at
  [`packages/deepresearch/src/api/runner.ts:66`](../packages/deepresearch/src/api/runner.ts#L66).
- `open-deep-research`, for real LangChain research, at
  [`packages/deepresearch/src/api/runner.ts:68`](../packages/deepresearch/src/api/runner.ts#L68).

The final result object returned to BullMQ includes the paths to `report.txt`,
`prompt.md`, `run.json`, the artifact directory, and cache metadata. That
return value is built in
[`packages/deepresearch/src/api/runner.ts:129`](../packages/deepresearch/src/api/runner.ts#L129).

If this was a cache miss, the completed report is copied into the per-company
cache by `persistDeepResearchCache` at
[`packages/deepresearch/src/api/runner.ts:183`](../packages/deepresearch/src/api/runner.ts#L183).

### 6. Real Research Calls The Python Bridge

For real jobs, `runOpenDeepResearch` starts at
[`packages/deepresearch/src/api/runner.ts:242`](../packages/deepresearch/src/api/runner.ts#L242).
It builds a `uv run python ...` command and passes paths for:

- `--prompt-file`,
- `--output-file`,
- `--run-json`,
- model options,
- search options,
- and iteration limits.

The child process is spawned at
[`packages/deepresearch/src/api/runner.ts:296`](../packages/deepresearch/src/api/runner.ts#L296).
Stdout and stderr are written to logs in the job artifact directory at
[`packages/deepresearch/src/api/runner.ts:294`](../packages/deepresearch/src/api/runner.ts#L294).

The Python script is
[`packages/deepresearch/scripts/run-open-deep-research.py`](../packages/deepresearch/scripts/run-open-deep-research.py).
It reads the prompt file at
[`packages/deepresearch/scripts/run-open-deep-research.py:65`](../packages/deepresearch/scripts/run-open-deep-research.py#L65),
imports the patched LangChain graph at
[`packages/deepresearch/scripts/run-open-deep-research.py:62`](../packages/deepresearch/scripts/run-open-deep-research.py#L62),
streams graph events at
[`packages/deepresearch/scripts/run-open-deep-research.py:96`](../packages/deepresearch/scripts/run-open-deep-research.py#L96),
writes `report.txt` at
[`packages/deepresearch/scripts/run-open-deep-research.py:109`](../packages/deepresearch/scripts/run-open-deep-research.py#L109),
and writes run metadata to `run.json` at
[`packages/deepresearch/scripts/run-open-deep-research.py:115`](../packages/deepresearch/scripts/run-open-deep-research.py#L115).

### 7. The Agent Checks Status

The agent can run:

```bash
fcdx deepresearch status --job-id <job_id>
```

The CLI command is registered at
[`packages/fcdx/src/cli/fcdx.ts:2088`](../packages/fcdx/src/cli/fcdx.ts#L2088).
It calls `client.status(...)`, implemented in
[`packages/fcdx/src/deepresearch/client.ts:49`](../packages/fcdx/src/deepresearch/client.ts#L49).

The API status route starts at
[`packages/deepresearch/src/api/server.ts:72`](../packages/deepresearch/src/api/server.ts#L72).
It asks BullMQ for the job, reads its state, and formats a response in
`jobStatusResponse` at
[`packages/deepresearch/src/api/server.ts:132`](../packages/deepresearch/src/api/server.ts#L132).

Common states are `waiting`, `active`, `completed`, and `failed`.

### 8. The Agent Fetches `report.txt`

Once status is `completed`, the agent can run:

```bash
fcdx deepresearch report --job-id <job_id>
```

or:

```bash
fcdx deepresearch wait --job-id <job_id> --output output/reports/company.txt
```

The `report` command is registered at
[`packages/fcdx/src/cli/fcdx.ts:2198`](../packages/fcdx/src/cli/fcdx.ts#L2198).
The `wait` command is registered at
[`packages/fcdx/src/cli/fcdx.ts:2162`](../packages/fcdx/src/cli/fcdx.ts#L2162),
and its polling loop lives in `waitForDeepResearchJob` at
[`packages/fcdx/src/cli/fcdx.ts:2538`](../packages/fcdx/src/cli/fcdx.ts#L2538).

The API route that returns the actual text file starts at
[`packages/deepresearch/src/api/server.ts:85`](../packages/deepresearch/src/api/server.ts#L85).
It only returns the file once BullMQ says the job is `completed`. Then it reads
the completed job's `report_path` and sends the file contents at
[`packages/deepresearch/src/api/server.ts:102`](../packages/deepresearch/src/api/server.ts#L102).

### 9. List-Based Runs Are Just Many Single Jobs

`fcdx deepresearch submit-list` is not a special batch format inside the API.
It is a CLI convenience that creates one normal API job per company in a DuckDB
list.

The command starts at
[`packages/fcdx/src/cli/fcdx.ts:2016`](../packages/fcdx/src/cli/fcdx.ts#L2016).
It reads the list with `showList`, loops over members at
[`packages/fcdx/src/cli/fcdx.ts:2055`](../packages/fcdx/src/cli/fcdx.ts#L2055),
and submits each company through the same `client.submit(...)` API call at
[`packages/fcdx/src/cli/fcdx.ts:2056`](../packages/fcdx/src/cli/fcdx.ts#L2056).

Before submitting, it appends company context to the prompt template. That
happens in `buildListDeepResearchPrompt` at
[`packages/fcdx/src/cli/fcdx.ts:2498`](../packages/fcdx/src/cli/fcdx.ts#L2498).
The context includes the original company row, list membership metadata, tags,
and list-local fields such as enrichment results or leads.

For list runs, pass `--output` to save the submitted job manifest:

```bash
fcdx deepresearch submit-list \
  --list water-valve-qualified \
  --prompt-file packages/deepresearch/prompts/manufacturing-outreach-research.md \
  --output output/deepresearch/jobs.json
```

Then inspect every job in the manifest with:

```bash
fcdx deepresearch status-list --jobs-file output/deepresearch/jobs.json
```

That command is registered at
[`packages/fcdx/src/cli/fcdx.ts:2109`](../packages/fcdx/src/cli/fcdx.ts#L2109).
It loops through the manifest, asks the API for each job status, and returns
aggregate counts plus one row per company.

Each list-submitted job also gets a `deepresearch_cache_dir` metadata field at
[`packages/fcdx/src/cli/fcdx.ts:2064`](../packages/fcdx/src/cli/fcdx.ts#L2064).
That path is `<cache-root>/<safe-company-id>/deepresearch`, where
`<cache-root>` defaults to the same root used by Firecrawl page cache.

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

## Report Cache

Deepresearch caches only finished research reports, not Firecrawl page payloads.
The default root is configured by `DEEPRESEARCH_COMPANY_CACHE_ROOT` in
[`packages/deepresearch/src/api/config.ts:29`](../packages/deepresearch/src/api/config.ts#L29).
For `fcdx deepresearch submit-list`, the CLI usually passes an explicit cache
directory based on the FCD-X Firecrawl cache root:

```text
<firecrawl-cache-root>/<safe-company-id>/deepresearch/
  report.txt
  run.json
  cache.json
```

This sits beside, not inside, the Firecrawl page files such as
`payload.firecrawl.json`, `page.md`, and `page.html`. Firecrawl code reads those
specific files and ignores the `deepresearch/` subfolder, so a page crawl never
returns a deepresearch report by accident.

Cache behavior:

- First run for a company: the worker runs the selected runner, writes the job
  artifact under `DEEPRESEARCH_RESULTS_DIR`, then copies `report.txt` into the
  company cache.
- Later run for the same company: the worker sees cached `report.txt`, copies it
  into the new job artifact folder, returns `cache_hit: true`, and avoids the
  model/search call.
- `--force-refresh`: bypasses the cached report and overwrites the company cache
  after the new run completes.

This intentionally ignores prompt differences for now, per the current design:
one cached deepresearch report per company. If we later need multiple report
types per company, the next extension should add a prompt/profile key under the
`deepresearch/` folder.

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
  --limit 5 \
  --output output/deepresearch/jobs.json
```

`submit-list` appends company context to the prompt template. That context is
read from `showList` and includes the company row, list membership fields,
global tags, and list-local fields.

Poll or fetch:

```bash
fcdx deepresearch status --job-id <job_id>
fcdx deepresearch status-list --jobs-file output/deepresearch/jobs.json
fcdx deepresearch wait --job-id <job_id> --output output/reports/company.txt
fcdx deepresearch report --job-id <job_id>
```

## Local Runbook

Start Redis:

```bash
docker run -d --name fcdx-redis -p 6379:6379 redis:7-alpine
```

Run the service processes together:

```bash
pnpm dev
```

For a no-model smoke-test mode:

```bash
pnpm dev:stub
```

You can still run service processes in separate terminals when debugging:

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
- `DEEPRESEARCH_COMPANY_CACHE_ROOT`: fallback per-company report cache root.
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
- Verified a same-company second submission returns `cache_hit: true`.
