# Deep Research Runner Comparison Notes

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

## Retired Runner

A previous runner was tested and then removed from the repo as the active spike.

It was fast and found useful signals, but it repeatedly failed the core requirement for this workflow: reliable adherence to the requested output shape. In particular, the tracked Kennedy Valve run ignored the JSON-only schema and omitted the requested org chart despite explicit instructions.

The local checkout and generated report artifacts were removed. Future comparisons should use runner-specific folders such as `open-deep-research-reports/`.

## Current Takeaway

For this specific use case, both approaches can find useful off-website sales triggers.

Fresh Codex baseline:

- Took about 15 minutes for Kennedy Valve.
- Returned closer to the requested JSON shape.
- Found very actionable triggers, especially price-increase and material-planner signals.

Next runner to test:

- LangChain Open Deep Research.
- Primary scoring criterion: instruction following and structured artifact reliability, not just report richness.
- Required output: valid JSON with the requested fields, including `org_chart`.

## LangChain Open Deep Research Result

The Kennedy Valve smoke test completed successfully after local runner adjustments:

- Added Firecrawl as a search backend.
- Patched final-report instructions to obey the research brief's requested format instead of always forcing Markdown.
- Patched structured-output calls to use function-calling mode.
- Used DeepSeek through the OpenAI-compatible endpoint as `openai:deepseek-chat`.

Saved files:

- `open-deep-research-reports/kennedy-valve-output.txt`
- `open-deep-research-reports/kennedy-valve-run.json`

Result:

- Runtime: about 213 seconds.
- Output: valid JSON.
- Included requested top-level keys, including `org_chart`.
- `org_chart` contained 14 entries.
- `sources` contained 20 entries.

This is materially better than the previous runner for the core requirement: structured output adherence.
