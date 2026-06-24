# Kennedy Valve DeerFlow Cost Analysis

## Run Identified

The useful Kennedy Valve artifact was written at:

- `packages/deepresearch/external/deer-flow/backend/.deer-flow/users/default/threads/fcdx-kennedy-valve-firecrawl-smoke-english-json/user-data/outputs/kennedy-valve-company-research-report.md`

The corresponding Firecrawl activity window was approximately:

- Start: `2026-06-23T19:26:32Z`
- End: `2026-06-23T19:29:45Z`

## Firecrawl Usage

Firecrawl activity endpoint returned:

- `46` search calls
- `24` scrape calls
- `70` total Firecrawl activities

If each activity is billed at one credit, this run used about `70` credits. If every scrape had used enhanced proxy billing, the upper bound from visible activity would be `46 + (24 * 5) = 166` credits.

The account had:

- `100000` plan credits for the billing period
- `57722` remaining credits when checked on `2026-06-24`

Using a simple proportional cost against a 100k-credit plan:

- `70 / 100000 * plan_price`
- At an $83 / 100k-credit plan, that is about `$0.058`
- Enhanced-scrape upper bound at `166` credits would be about `$0.138`

## Claude / LLM Usage

Exact Claude token usage for this completed run was not recoverable from the saved DeerFlow artifacts.

Reason:

- The run used `DeerFlowClient.chat()`, which consumed the stream internally.
- The script saved elapsed time and final response text, but did not persist the final `end` event usage payload.
- DeerFlow did not write token usage to `.deer-flow` thread artifacts or logs for this embedded run.

The configured model was:

- `claude-sonnet-4.6`
- Provider: `deerflow.models.claude_provider:ClaudeChatModel`
- Auth: Claude Code OAuth via `ANTHROPIC_AUTH_TOKEN`

For future runs, use `client.stream()` instead of `client.chat()` and persist the final `event.type == "end"` usage payload.
