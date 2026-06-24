# Water Valves Deep Research Run

Generated 15 deep-research task(s).

- Source CSV: `/home/abhi/dataset/output/experiments/water-valves/water-valves-shortlist-leads-summary.csv`
- Prompt template: `/home/abhi/dataset/packages/deepresearch/prompts/manufacturing-outreach-research.md`
- `tasks/`: one Markdown prompt per company
- `tasks.jsonl`: JSONL manifest with full prompt text for tool ingestion
- `batch.md`: all tasks concatenated for agents that accept a single Markdown input
- `codex-baseline-prompt.md`: first task only, intended for a quick fresh-Codex comparison

## Runner Usage

Use `batch.md` for a batch run if the configured research runner supports long-context batch tasks. For a safer smoke test, feed one file from `tasks/` into the runner first.

The intended comparison is:

1. Run one company through a research runner and save the report under a runner-specific folder.
2. Run the same task through a fresh Codex agent and save the report under `codex-baseline-reports/`.
3. Compare elapsed time, number of external searches/pages opened, and report quality for outreach usefulness.
