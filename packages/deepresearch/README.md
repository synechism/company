# FCD-X Deep Research Experiments

This package holds local experiments for turning an FCD-X shortlist CSV into deep-research tasks.

The first target is the water-valve shortlist:

```bash
pnpm --filter @fcdx/deepresearch prepare:input
```

For a cheap smoke test:

```bash
pnpm --filter @fcdx/deepresearch prepare:input -- --limit 1
```

Generated files land in `packages/deepresearch/results/water-valves/`:

- `tasks/`: one prompt per company.
- `tasks.jsonl`: JSONL task manifest, including the full prompt text.
- `batch.md`: all company tasks in one Markdown file.
- `codex-baseline-prompt.md`: the first company prompt for a quick Codex comparison.

## LangChain Open Deep Research Plan

The next runner to test is LangChain Open Deep Research. Keep the external checkout outside committed package code:

```bash
git clone --depth 1 https://github.com/langchain-ai/open_deep_research.git packages/deepresearch/external/open_deep_research
cd packages/deepresearch/external/open_deep_research
/home/abhi/.local/bin/uv sync
/home/abhi/.local/bin/uv add firecrawl-py
git apply ../../patches/open_deep_research-firecrawl-deepseek.patch
/home/abhi/.local/bin/uv pip install -e .
```

Do not commit the external checkout or secrets. Feed one generated task file into the runner first, then expand to the full `batch.md` if the run follows the requested schema.

Local test settings that worked:

- Search backend: `firecrawl`
- Model provider path: DeepSeek through the OpenAI-compatible endpoint
- Model name: `openai:deepseek-chat`
- Required environment:
  - `FIRECRAWL_API_KEY`
  - `OPENAI_API_KEY=$ANTHROPIC_AUTH_TOKEN`
  - `OPENAI_BASE_URL=https://api.deepseek.com`

The Anthropic-compatible DeepSeek path failed on structured-output/tool-choice calls. The OpenAI-compatible `deepseek-chat` path completed the Kennedy Valve test and returned valid JSON with `org_chart`.

## Async API and Worker

The package now exposes a small asynchronous API around the runner. The API
accepts jobs, BullMQ stores them in Redis, and workers claim jobs and write a
per-job artifact folder containing `prompt.md`, `report.txt`, `run.json`, and
`job.json`.

Start Redis first. Then run the API and at least one worker:

```bash
pnpm deepresearch:api
pnpm deepresearch:worker
```

Important environment variables:

- `REDIS_URL`: Redis connection URL. Defaults to `redis://127.0.0.1:6379`.
- `DEEPRESEARCH_API_HOST`: API host. Defaults to `127.0.0.1`.
- `DEEPRESEARCH_API_PORT`: API port. Defaults to `8787`.
- `DEEPRESEARCH_QUEUE`: BullMQ queue name. Defaults to `fcdx-deepresearch`.
- `DEEPRESEARCH_RESULTS_DIR`: Job artifact root. Defaults to `packages/deepresearch/results/jobs`.
- `DEEPRESEARCH_RUNNER`: `open-deep-research` or `stub`.
- `OPEN_DEEP_RESEARCH_DIR`: External checkout path.

Submit a cheap smoke-test job:

```bash
curl -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Smoke test","options":{"runner":"stub"}}'
```

Fetch status and the final report:

```bash
curl http://127.0.0.1:8787/jobs/<job_id>
curl http://127.0.0.1:8787/jobs/<job_id>/report.txt
```

The FCD-X CLI wraps those endpoints:

```bash
fcdx config env set API_URL http://127.0.0.1:8787
fcdx deepresearch submit --prompt-file packages/deepresearch/results/water-valves/tasks/kennedy-valve-company-BFKJ7LbO.md
fcdx deepresearch wait --job-id <job_id> --output output/reports/kennedy-valve.txt
```

## Comparison Plan

For a fair first comparison:

- Same company prompt.
- Same source CSV context.
- Capture wall-clock runtime.
- Capture any model/search/tool costs exposed by the runner.
- Score the final report on: source freshness, M&A/growth triggers found, procurement relevance, contact recommendation, and usefulness of the outreach angle.
