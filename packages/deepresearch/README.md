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

## DeerFlow Plan

DeerFlow should live outside the committed package checkout, for example:

```bash
git clone --depth 1 https://github.com/bytedance/deer-flow.git packages/deepresearch/external/deer-flow
cd packages/deepresearch/external/deer-flow
make setup
```

Do not commit the external checkout or DeerFlow secrets. Once DeerFlow is configured, feed one generated task file into it first, then expand to the full `batch.md` if the run looks sane.

## Comparison Plan

For a fair first comparison:

- Same company prompt.
- Same source CSV context.
- Capture wall-clock runtime.
- Capture any model/search/tool costs exposed by the runner.
- Score the final report on: source freshness, M&A/growth triggers found, procurement relevance, contact recommendation, and usefulness of the outreach angle.
