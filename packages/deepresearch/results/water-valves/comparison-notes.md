# DeerFlow vs Fresh Codex Baseline

## Input

- Source CSV: `output/experiments/water-valves/water-valves-shortlist-leads-summary.csv`
- Prompt: `packages/deepresearch/prompts/manufacturing-outreach-research.md`
- Generated task batch: `packages/deepresearch/results/water-valves/batch.md`
- First baseline company tested: Kennedy Valve Company

## Codex Baseline Result

A fresh Codex agent produced a useful Kennedy Valve report in about 15 minutes. The strongest findings were:

- Kennedy Valve appears to be a strong manufacturing/procurement fit.
- It found a 2026 supplier-cost price increase notice.
- It found a Value Stream Material & Production Planner hiring signal tied to MPS/MRP, material availability, shortage recovery, and schedule adherence.
- It used the existing lead, Chris McCutcheon, as the recommended buyer because his Supply Chain Director role matches the identified triggers.

Saved report:

- `codex-baseline-reports/kennedy-valve.json`

## DeerFlow Result

DeerFlow is now installed and produced a Kennedy Valve report.

- Source checkout: `packages/deepresearch/external/deer-flow`
- `make check`: passed
- `make install`: passed
- `make doctor`: passed
- Model: Claude Code OAuth provider via `ANTHROPIC_AUTH_TOKEN`
- Search/fetch: Firecrawl
- Embedded-client final response: `deerflow-reports/kennedy-valve.md`
- Full generated artifact: `deerflow-reports/kennedy-valve-full.md`

The first Jina-backed run failed because Jina returned 401. After switching DeerFlow's active search/fetch tools to Firecrawl, the run completed.

The first Claude-backed run also exposed a DeerFlow/Anthropic compatibility issue: the dynamic-context middleware inserted non-consecutive `SystemMessage`s. For this local smoke test, the checkout was patched to emit that hidden context as a `HumanMessage`.

## Current Takeaway

For this specific use case, both approaches can find useful off-website sales triggers.

Fresh Codex baseline:

- Took about 15 minutes for Kennedy Valve.
- Returned closer to the requested JSON shape.
- Found very actionable triggers, especially price-increase and material-planner signals.

DeerFlow:

- Took about 95 seconds for the first successful summary run and about 134 seconds for the stricter run.
- Produced a richer full Markdown artifact, including company history, product families, supply-chain categories, McWane ecosystem context, and outreach angle.
- Did not reliably obey the requested JSON-only final response shape; the full artifact is better than the final chat response.
- Required more setup and one local compatibility patch.

Current read: DeerFlow looks promising as a fast local deep-research harness once configured, especially if we consume its generated artifacts rather than the final chat response. Codex was slower but more directly compliant with the requested output schema.
