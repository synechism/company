# FCD-X CLI Design Spec

## Purpose

FCD-X should become an agent-operable sales research workbench for Cronwell. The
CLI should help an agent move from a very large company universe to a defensible
account shortlist for Cronwell's procurement automation product.

Cronwell's target is not simply "companies that touch data centers." The better
target is a manufacturer, fabricator, assembler, equipment provider, industrial
contractor, or contract manufacturer with meaningful procurement complexity.
Data-center exposure and the PDF categories are useful because they identify
markets with large bills of materials, engineered components, site/project
purchasing, supplier quoting, and supply-chain coordination.

## North Star Workflow

An agent should be able to run a workflow like this:

```bash
fcdx filter --profile midmarket-us --industry construction,electrical,electronic,mechanical
fcdx list create thermal-cooling --from-filter --query "cooling OR thermal OR hvac OR chiller OR liquid"
fcdx list show thermal-cooling --stats
fcdx enrich list thermal-cooling --profile cronwell-manufacturing-procurement --concurrency 50 --resume
fcdx rank list thermal-cooling --by target_alignment.score --top 50
fcdx tag add --list thermal-cooling --tag target:thermal
fcdx export list thermal-cooling --format csv --include enrichment,linkedin,tags,notes
```

The agent should be able to inspect, explain, revise, and rerun each step without
losing state.

## Design Principles

- State should live in DuckDB, not only in loose JSONL files.
- Every long-running command should be resumable and produce a run record.
- Every command should support machine-readable output with `--json`.
- Commands should be idempotent where possible.
- Lists and tags should be first-class objects.
- Agent judgments should preserve rationale, evidence, disqualifiers, and schema version.
- Deterministic pre-ranking is allowed for triage, but final ranking should come from enriched agent judgments.
- The CLI should make uncertainty visible instead of hiding it.
- The agent should be able to ask "why is this company here?" and get an auditable answer.

## Current CLI

Current commands:

```text
fcdx db init
fcdx db migrate
fcdx config path/show/init
fcdx filterby
fcdx crawl
fcdx enrich file
fcdx list
fcdx tag
fcdx linkedin auth
fcdx linkedin list-profiles
fcdx target compare
fcdx target shortlist
fcdx target rank-enriched
```

Useful existing pieces:

- DuckDB company cache in `packages/fcdx/src/db/fcdx.ts`.
- Workspace list/tag tables and helpers in `packages/fcdx/src/db/workspace.ts`.
- Firecrawl enrichment/cache in `packages/fcdx/src/enrich/firecrawl.ts`.
- Batch file-backed enrichment in `packages/fcdx/src/enrich/batch.ts`.
- Agent prompt/schema in `packages/fcdx/src/enrich/questions.ts`.

`filterby` can now save its result set directly to a durable list:

```bash
fcdx filterby \
  --industry "construction,electrical/electronic manufacturing" \
  --headcount-min 200 \
  --headcount-max 10000 \
  --limit 10000 \
  --to-list strict-midmarket-candidates \
  --create-list
```
- Target ranking in `packages/fcdx/src/target/companies.ts`.
- Unipile LinkedIn integration in `packages/fcdx/src/unipile/client.ts`.

Main limitation:

- The repo has useful commands, but not enough durable workspace state. Lists,
  tags, notes, enrichment runs, and ranked outputs should become database-backed
  entities that an agent can compose.

## Proposed DuckDB Schema Additions

### `lists`

Named collections of companies.

```sql
CREATE TABLE lists (
  id VARCHAR PRIMARY KEY,
  name VARCHAR UNIQUE NOT NULL,
  description VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_by VARCHAR
);
```

### `list_members`

Membership with provenance.

```sql
CREATE TABLE list_members (
  list_id VARCHAR,
  company_id VARCHAR,
  source VARCHAR,
  reason VARCHAR,
  rank INTEGER,
  score DOUBLE,
  added_at TIMESTAMP,
  PRIMARY KEY (list_id, company_id)
);
```

### `tags`

Controlled tag definitions.

```sql
CREATE TABLE tags (
  tag VARCHAR PRIMARY KEY,
  description VARCHAR,
  created_at TIMESTAMP
);
```

### `company_tags`

Company-level tags.

```sql
CREATE TABLE company_tags (
  company_id VARCHAR,
  tag VARCHAR,
  value VARCHAR,
  confidence DOUBLE,
  source VARCHAR,
  reason VARCHAR,
  created_at TIMESTAMP,
  PRIMARY KEY (company_id, tag)
);
```

Examples:

- `target:thermal`
- `target:switchgear`
- `buyer:manufacturer`
- `buyer:contract_manufacturer`
- `procurement:complex`
- `exclude:residential`
- `exclude:software_only`

### `company_notes`

Human or agent notes.

```sql
CREATE TABLE company_notes (
  id VARCHAR PRIMARY KEY,
  company_id VARCHAR,
  note VARCHAR,
  source VARCHAR,
  created_at TIMESTAMP
);
```

### `enrichment_runs`

Run metadata for reproducibility.

```sql
CREATE TABLE enrichment_runs (
  id VARCHAR PRIMARY KEY,
  name VARCHAR,
  input_kind VARCHAR,
  input_ref VARCHAR,
  profile VARCHAR,
  schema_version VARCHAR,
  status VARCHAR,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  total INTEGER,
  completed INTEGER,
  errors INTEGER,
  output_jsonl VARCHAR,
  output_csv VARCHAR,
  summary_json VARCHAR
);
```

### `company_enrichments`

Latest or versioned enrichment results.

```sql
CREATE TABLE company_enrichments (
  company_id VARCHAR,
  run_id VARCHAR,
  schema_version VARCHAR,
  company_summary VARCHAR,
  target_alignment_score DOUBLE,
  target_alignment_priority VARCHAR,
  manufacturing_fit DOUBLE,
  procurement_fit DOUBLE,
  category_fit DOUBLE,
  datacenter_fit DOUBLE,
  categories JSON,
  positive_evidence JSON,
  negative_evidence JSON,
  disqualifiers JSON,
  raw_json_path VARCHAR,
  created_at TIMESTAMP,
  PRIMARY KEY (company_id, run_id)
);
```

### `crawl_artifacts`

Index the filesystem cache.

```sql
CREATE TABLE crawl_artifacts (
  company_id VARCHAR,
  url VARCHAR,
  final_url VARCHAR,
  cache_dir VARCHAR,
  markdown_path VARCHAR,
  html_path VARCHAR,
  screenshot_path VARCHAR,
  raw_json_path VARCHAR,
  error VARCHAR,
  updated_at TIMESTAMP,
  PRIMARY KEY (company_id, url)
);
```

### `missions`

Mission workspaces for multi-step agent objectives.

```sql
CREATE TABLE missions (
  id VARCHAR PRIMARY KEY,
  name VARCHAR UNIQUE NOT NULL,
  goal VARCHAR,
  status VARCHAR,
  default_rubric VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  closed_at TIMESTAMP
);
```

### `mission_artifacts`

Connect missions to lists, runs, snapshots, exports, review queues, and notes.

```sql
CREATE TABLE mission_artifacts (
  mission_id VARCHAR,
  artifact_type VARCHAR,
  artifact_id VARCHAR,
  role VARCHAR,
  created_at TIMESTAMP,
  PRIMARY KEY (mission_id, artifact_type, artifact_id)
);
```

### `rubrics`

Versioned enrichment/ranking rubrics.

```sql
CREATE TABLE rubrics (
  id VARCHAR PRIMARY KEY,
  name VARCHAR,
  schema_version VARCHAR,
  prompt_path VARCHAR,
  schema_path VARCHAR,
  scoring_json JSON,
  status VARCHAR,
  created_at TIMESTAMP
);
```

### `review_queues` And `review_labels`

Human-in-the-loop feedback and rubric evaluation data.

```sql
CREATE TABLE review_queues (
  id VARCHAR PRIMARY KEY,
  name VARCHAR UNIQUE,
  source_type VARCHAR,
  source_ref VARCHAR,
  status VARCHAR,
  created_at TIMESTAMP
);

CREATE TABLE review_labels (
  queue_id VARCHAR,
  company_id VARCHAR,
  label VARCHAR,
  reason VARCHAR,
  reviewer VARCHAR,
  created_at TIMESTAMP,
  PRIMARY KEY (queue_id, company_id)
);
```

### `account_packages`

Generated sales research packages.

```sql
CREATE TABLE account_packages (
  id VARCHAR PRIMARY KEY,
  company_id VARCHAR,
  list_id VARCHAR,
  package_path VARCHAR,
  included_sections JSON,
  created_at TIMESTAMP
);
```

### `snapshots`

Frozen reproducible artifacts.

```sql
CREATE TABLE snapshots (
  id VARCHAR PRIMARY KEY,
  name VARCHAR UNIQUE,
  artifact_type VARCHAR,
  artifact_ref VARCHAR,
  manifest_json JSON,
  created_at TIMESTAMP
);
```

## Proposed Final `fcdx --help`

The main discovery surface for agents should be `fcdx --help`. The help page
should be structured, boring, and explicit. Agents should be able to infer the
workflow from the command descriptions alone.

```text
Usage: fcdx [options] [command]

Free Company Dataset exploration and account-research CLI for Cronwell.

FCD-X helps agents build, enrich, rank, inspect, and export company lists for
Cronwell's manufacturer/procurement-focused sales motion.

Global Options:
  --db <path>               DuckDB path. Defaults to FCDX_DB_PATH.
  --json                    Print machine-readable JSON.
  --quiet                   Suppress human progress output.
  --dry-run                 Show what would happen without writing changes.
  --yes                     Skip confirmation prompts.
  -h, --help                Display help for command.
  -V, --version             Output version number.

Core Workflow:
  1. fcdx mission start ...                  Define the research objective.
  2. fcdx discover ...                       Expand markets/categories into candidate pools.
  3. fcdx list create/add ...                Save companies into durable lists.
  4. fcdx enrich list ...                    Crawl websites and agent-enrich companies.
  5. fcdx segment list ...                   Cluster/organize companies by market/category.
  6. fcdx rank list ...                      Rank companies for Cronwell fit.
  7. fcdx review queue ...                   Human/agent review uncertain cases.
  8. fcdx account build ...                  Build account dossiers and buyer maps.
  9. fcdx export list ...                    Export final account packages.

Commands:
  db                         Manage the DuckDB dataset/cache.
  mission                    Manage goal-oriented agent research workspaces.
  discover                   Discover candidate pools from markets, keywords, and examples.
  filter                     Search/filter companies from the dataset.
  list                       Create and manage durable company lists.
  segment                    Cluster and split lists into useful market/account segments.
  tag                        Add, remove, and inspect company tags.
  note                       Add and inspect company notes.
  enrich                     Crawl and agent-enrich companies.
  rubric                     Manage scoring rubrics, schema versions, and eval sets.
  rank                       Rank enriched companies for Cronwell fit.
  review                     Create review queues, capture labels, and adjudicate edge cases.
  company                    Inspect one company, its evidence, tags, lists, and cache.
  evidence                   Search and quote website/enrichment evidence.
  account                    Build account dossiers, buyer maps, and pitch packages.
  cache                      Inspect and manage Firecrawl cache artifacts.
  linkedin                   Authenticate LinkedIn and find buyer profiles.
  run                        Inspect, resume, and manage long-running jobs.
  profile                    Manage saved filter/enrichment/ranking profiles.
  sql                        Run safe read-only SQL over the FCD-X DuckDB.
  snapshot                   Freeze, diff, and reproduce list/ranking states.
  integration                Import/export/sync with CSV, CRM, and external systems.
  export                     Export lists, enrichments, buyers, and evidence.
  target                     Compare and rank against PDF target categories.

Examples:
  fcdx db status
  fcdx mission start dc-procurement --goal "Find 200 manufacturer/procurement-heavy targets"
  fcdx discover category "thermal management for data centers" --seed "Vertiv" --seed "CoolIT"
  fcdx list create thermal-cooling --description "Cooling and thermal targets"
  fcdx list add thermal-cooling --from-filter --query "cooling OR thermal OR chiller"
  fcdx enrich list thermal-cooling --profile cronwell-manufacturing-procurement --concurrency 50 --resume
  fcdx segment list thermal-cooling --by category,manufacturing_fit,procurement_fit
  fcdx rank list thermal-cooling --min-manufacturing-fit 65 --min-procurement-fit 65 --top 50
  fcdx review queue thermal-cooling --where "score BETWEEN 55 AND 75"
  fcdx company explain "SMTC"
  fcdx evidence search --company "SMTC" --query "supply chain manufacturing facilities"
  fcdx linkedin find-buyers --company "SMTC" --roles procurement,supply-chain,operations
  fcdx account build --company "SMTC" --include evidence,buyers,pitch
  fcdx export list thermal-cooling --format csv --include companies,enrichment,buyers,tags,account
```

### `fcdx db --help`

```text
Usage: fcdx db [options] [command]

Manage the local DuckDB cache for the Free Company Dataset and FCD-X state.

Commands:
  init                       Import the PDL CSV into DuckDB.
  status                     Show DB path, table counts, cache counts, and latest runs.
  schema                     Print tables, columns, indexes, and row counts.
  vacuum                     Compact/optimize the DuckDB database.
  migrate                    Apply FCD-X schema migrations for lists/tags/runs.

Examples:
  fcdx db init --input /home/abhi/data/free_company_dataset.csv --replace
  fcdx db status --json
  fcdx db schema
```

### `fcdx filter --help`

```text
Usage: fcdx filter [options]

Search/filter companies from DuckDB. Can print rows, write JSONL, or save
results directly into a list.

Options:
  --profile <name>           Saved filter profile, e.g. midmarket-us.
  --industry <value...>      Industry filters; repeat or comma-separate.
  --country <country>        Headquarters country. Defaults to united states.
  --headcount-min <n>        Minimum employee count.
  --headcount-max <n>        Maximum employee count.
  --company <text>           Company name, website, or LinkedIn substring.
  --query <expr>             Keyword query over name, website, tags, summaries.
  --tag <tag...>             Require tags.
  --exclude-tag <tag...>     Exclude tags.
  --has-enrichment           Only include companies with enrichment.
  --missing-enrichment       Only include companies without enrichment.
  --limit <n>                Maximum rows.
  --output <path>            Write JSONL output.
  --to-list <name>           Save results into a durable list.
  --explain                  Include match/provenance reasons.

Examples:
  fcdx filter --profile midmarket-us --industry construction --limit 100
  fcdx filter --query "cooling OR thermal OR chiller" --to-list thermal-cooling
  fcdx filter --tag buyer:manufacturer --tag procurement:complex --json
```

### `fcdx mission --help`

```text
Usage: fcdx mission [options] [command]

Create and manage goal-oriented research workspaces. A mission ties together
lists, runs, rubrics, review queues, snapshots, and exports for one business
objective.

Commands:
  start <name>               Start a mission with a concrete goal.
  status <name>              Show mission progress, artifacts, blockers, next actions.
  plan <name>                Generate or update a step-by-step research plan.
  artifacts <name>           List lists, runs, rankings, exports, and notes for a mission.
  next <name>                Suggest the next useful CLI action.
  close <name>               Mark a mission complete and freeze final artifacts.

Examples:
  fcdx mission start dc-procurement --goal "Find 200 manufacturer/procurement-heavy targets"
  fcdx mission plan dc-procurement --json
  fcdx mission next dc-procurement
  fcdx mission status dc-procurement
```

### `fcdx discover --help`

```text
Usage: fcdx discover [options] [command]

Discover candidate pools from a market/category description, seed companies,
keywords, enriched summaries, tags, and cached website evidence.

Commands:
  category <text>            Expand a category into search terms and candidate companies.
  similar                    Find companies similar to seed companies.
  keywords                   Generate and test keyword queries.
  from-doc                   Turn an uploaded/doc config into target categories and seed lists.
  gaps                       Find under-covered categories or segments in a mission/list.

Options:
  --seed <company...>        Seed companies to imitate.
  --avoid <company...>       Negative examples.
  --to-list <name>           Save discovered candidates into a list.
  --limit <n>                Number of candidates.
  --explain                  Include why each company was discovered.

Examples:
  fcdx discover category "data center liquid cooling manufacturers" --seed "CoolIT" --to-list liquid-cooling
  fcdx discover similar --seed "SMTC" --seed "Jabil" --to-list electronics-contract-manufacturers
  fcdx discover gaps --mission dc-procurement
```

### `fcdx list --help`

```text
Usage: fcdx list [options] [command]

Create and manage durable company lists. Lists are the primary workspace object
for agent workflows.

Commands:
  create <name>              Create a new list.
  add <name>                 Add companies to a list.
  remove <name>              Remove companies from a list.
  show <name>                Show companies in a list.
  stats <name>               Summarize list by industry, size, tags, enrichment.
  dedupe <name>              Remove duplicate/alias companies.
  diff <a> <b>               Compare two lists.
  union <a> <b>              Create a union list.
  intersect <a> <b>          Create an intersection list.
  export <name>              Export a list.
  delete <name>              Delete a list.

Examples:
  fcdx list create thermal-cooling --description "Cooling and thermal targets"
  fcdx list add thermal-cooling --company "SMTC"
  fcdx list add thermal-cooling --from-filter --query "cooling OR thermal"
  fcdx list stats thermal-cooling
  fcdx list show thermal-cooling --include tags,enrichment --limit 25
```

### `fcdx segment --help`

```text
Usage: fcdx segment [options] [command]

Split a list into useful sublists or clusters for review, enrichment, ranking,
or sales execution.

Commands:
  list <name>                Segment a list by categories, tags, scores, geography, size, or embeddings.
  cluster <name>             Cluster companies by enriched summaries/evidence.
  balance <name>             Build a category-balanced sample or shortlist.
  outliers <name>            Find suspicious or inconsistent rows.
  create-lists <name>        Materialize segments as named lists.

Examples:
  fcdx segment list all-candidates --by target_category --create-lists
  fcdx segment cluster thermal-cooling --k 8 --explain
  fcdx segment balance all-candidates --per-category 50 --output balanced-250
  fcdx segment outliers agent-shortlist-200 --where "datacenter_fit > 80 AND manufacturing_fit < 40"
```

### `fcdx tag --help`

```text
Usage: fcdx tag [options] [command]

Manage company tags. Tags allow agents to improve the dataset beyond canonical
PDL industry labels.

Commands:
  add                        Add a tag to one company or a list.
  remove                     Remove a tag.
  list                       Show tags on a company or all known tags.
  stats                      Show tag counts.
  suggest                    Suggest tags from enrichment evidence.

Examples:
  fcdx tag add --company "SMTC" --tag buyer:contract_manufacturer --confidence 0.9
  fcdx tag add --list thermal-cooling --tag target:thermal
  fcdx tag stats
  fcdx filter --tag buyer:manufacturer --tag procurement:complex
```

### `fcdx note --help`

```text
Usage: fcdx note [options] [command]

Attach human or agent notes to companies.

Commands:
  add                        Add a note to a company.
  list                       List notes for a company.
  delete                     Delete a note.

Examples:
  fcdx note add --company "SMTC" --note "Strong EMS procurement target; weak PDF category fit."
  fcdx note list --company "SMTC"
```

### `fcdx enrich --help`

```text
Usage: fcdx enrich [options] [command]

Crawl company websites and produce structured agent enrichment.

Commands:
  company                    Enrich one company.
  list                       Enrich all companies in a list.
  filter                     Enrich companies matching a filter.
  missing                    Enrich companies in a list that do not have current enrichment.
  retry-errors               Retry failed companies from a run.

Options:
  --profile <name>           Enrichment profile. Defaults to cronwell-manufacturing-procurement.
  --schema-version <version> Require a specific enrichment schema version.
  --concurrency <n>          Parallel Firecrawl requests.
  --cache-dir <path>         Firecrawl cache root.
  --force-refresh            Ignore cache and fetch fresh results.
  --resume                   Skip companies already in output.
  --tmux                     Launch as durable tmux job.

Examples:
  fcdx enrich company --company "SMTC"
  fcdx enrich list thermal-cooling --concurrency 50 --resume --tmux
  fcdx enrich missing --list thermal-cooling --profile cronwell-manufacturing-procurement
  fcdx enrich retry-errors --run target-agent-2026-06-17
```

### `fcdx rubric --help`

```text
Usage: fcdx rubric [options] [command]

Manage enrichment/ranking rubrics and evaluate whether agent scoring matches
Cronwell's target buyer profile.

Commands:
  list                       List available rubrics/schema versions.
  show <name>                Show a rubric prompt, schema, scoring weights, and caps.
  create <name>              Create a new rubric.
  test <name>                Run a rubric on known example companies.
  eval <name>                Evaluate a rubric against labeled examples.
  compare <a> <b>            Compare two rubric versions on the same sample.
  promote <name>             Mark a rubric as the default.

Examples:
  fcdx rubric show cronwell-manufacturing-procurement
  fcdx rubric test procurement_manufacturing_v2 --company "SMTC" --company "Vertiv"
  fcdx rubric eval procurement_manufacturing_v2 --label-set cto-feedback-2026-06-18
  fcdx rubric compare procurement_manufacturing_v1 procurement_manufacturing_v2 --sample 100
```

### `fcdx rank --help`

```text
Usage: fcdx rank [options] [command]

Rank enriched companies for Cronwell fit. Ranking is procurement/manufacturing
first; data-center relevance alone should not dominate.

Commands:
  list <name>                Rank companies in a list.
  run <run-id>               Rank companies from an enrichment run.
  enriched                   Rank an enriched JSONL file.
  explain                    Explain one company's rank and evidence.
  export                     Export ranked results.

Options:
  --strategy <name>          agent-score, procurement-first, category-balanced, new-only.
  --top <n>                  Number of rows to return.
  --min-score <n>            Minimum final target-alignment score.
  --min-manufacturing-fit <n> Minimum manufacturing/fabrication/assembly sub-score.
  --min-procurement-fit <n>  Minimum procurement-complexity sub-score.
  --min-category-fit <n>     Minimum PDF category sub-score.
  --min-datacenter-fit <n>   Minimum data-center/critical-infrastructure sub-score.
  --exclude-reviewed         Exclude companies already reviewed.
  --exclude-tag <tag...>     Exclude companies with tags.
  --category <category...>   Restrict to target categories.

Examples:
  fcdx rank list all-candidates --strategy procurement-first --top 200
  fcdx rank list thermal-cooling --min-manufacturing-fit 65 --min-procurement-fit 65 --top 50
  fcdx rank explain --company "SMTC"
  fcdx rank enriched --input output/enriched/target-agent-enriched.jsonl --top 200
```

### `fcdx review --help`

```text
Usage: fcdx review [options] [command]

Create human/agent review queues, capture labels, and turn feedback into tags,
rubric evals, and cleaner rankings.

Commands:
  queue <name>               Create a review queue from a list/filter/ranking.
  next <queue>               Show the next company needing review.
  label <queue>              Label one company as fit/possible/not-fit with reasons.
  bulk-label <queue>         Apply a label/tag to rows matching a condition.
  stats <queue>              Show review progress and label distribution.
  export-labels <queue>      Export labels for rubric evaluation.

Examples:
  fcdx review queue shortlist-audit --from-list agent-shortlist-200 --sample 50
  fcdx review next shortlist-audit
  fcdx review label shortlist-audit --company "SMTC" --label possible-fit --reason "Good EMS target; weaker PDF category."
  fcdx review bulk-label shortlist-audit --where "manufacturing_fit < 40" --label not-fit
```

### `fcdx company --help`

```text
Usage: fcdx company [options] [command]

Inspect one company and all FCD-X state attached to it.

Commands:
  show                       Show dataset row, tags, lists, enrichment, cache, buyers.
  explain                    Explain why a company is or is not a Cronwell target.
  open-cache                 Print local cache artifact paths.
  mark-reviewed              Mark review status.
  history                    Show enrichment/tag/list history for the company.

Examples:
  fcdx company show "SMTC" --include enrichment,tags,lists,linkedin,cache
  fcdx company explain "SMTC"
  fcdx company open-cache "SMTC"
  fcdx company mark-reviewed "SMTC" --status good-fit
```

### `fcdx evidence --help`

```text
Usage: fcdx evidence [options] [command]

Search, inspect, and quote evidence from cached website markdown/HTML,
screenshots, and enrichment rationale.

Commands:
  search                     Search evidence across companies, lists, or runs.
  show                       Show evidence snippets for one company.
  quote                      Print short source snippets for a claim.
  missing                    Find companies with weak/missing evidence for a field.
  contradictions             Find rows where evidence conflicts with the agent score.

Examples:
  fcdx evidence search --list thermal-cooling --query "manufacturing facilities"
  fcdx evidence show --company "SMTC" --fields manufacturing_fit,procurement_fit
  fcdx evidence missing --list agent-shortlist-200 --field procurement_fit
  fcdx evidence contradictions --where "score > 80 AND manufacturing_fit < 50"
```

### `fcdx account --help`

```text
Usage: fcdx account [options] [command]

Build account-level sales research packages for Cronwell.

Commands:
  build                      Build one account dossier.
  batch                      Build dossiers for a list.
  brief                      Produce a short account brief.
  pitch                      Draft pitch angles based on evidence and buyer roles.
  buyers                     Show known/suggested buyer personas for an account.
  gaps                       Show missing account data before outreach.

Examples:
  fcdx account build --company "SMTC" --include evidence,buyers,pitch --output output/accounts/smtc.md
  fcdx account batch --list agent-shortlist-200 --top 25 --include evidence,buyers,pitch
  fcdx account gaps --company "SMTC"
```

### `fcdx cache --help`

```text
Usage: fcdx cache [options] [command]

Inspect and manage Firecrawl cache artifacts.

Commands:
  stats                      Show cache counts, size, stale schema counts.
  show                       Show cache paths for one company.
  validate                   Validate cache artifacts for a list.
  stale                      List cache entries stale for current schema.
  clear                      Clear cache for a company, list, or run.

Examples:
  fcdx cache stats
  fcdx cache show --company "SMTC"
  fcdx cache stale --schema-version procurement_manufacturing_v2
```

### `fcdx linkedin --help`

```text
Usage: fcdx linkedin [options] [command]

Authenticate LinkedIn through Unipile and find likely buyer profiles.

Commands:
  auth                       Create a hosted Unipile LinkedIn auth URL.
  accounts                   List connected LinkedIn accounts.
  list-profiles              Search LinkedIn profiles at a company.
  find-buyers                Find likely procurement/supply-chain/operations buyers.
  enrich-list                Find buyers for every company in a list.
  export-buyers              Export buyer contacts for a list.

Examples:
  fcdx linkedin auth
  fcdx linkedin list-profiles --company "SMTC" --p "CEO"
  fcdx linkedin find-buyers --company "SMTC" --roles procurement,supply-chain,operations
  fcdx linkedin enrich-list thermal-cooling --roles procurement,sourcing,supply-chain
```

### `fcdx run --help`

```text
Usage: fcdx run [options] [command]

Inspect and manage long-running jobs.

Commands:
  list                       List enrichment/crawl/ranking runs.
  show <run-id>              Show run status and outputs.
  logs <run-id>              Tail run logs.
  resume <run-id>            Resume an interrupted run.
  cancel <run-id>            Cancel a running job.
  attach <run-id>            Attach to the tmux session for a run.

Examples:
  fcdx run list
  fcdx run show target-agent-2026-06-17
  fcdx run logs target-agent-2026-06-17 --tail 100
  fcdx run attach target-agent-2026-06-17
```

### `fcdx profile --help`

```text
Usage: fcdx profile [options] [command]

Manage saved filter, enrichment, and ranking profiles.

Commands:
  list                       List saved profiles.
  show <name>                Show profile config.
  create <name>              Create a new profile.
  update <name>              Update a profile.
  delete <name>              Delete a profile.

Examples:
  fcdx profile list
  fcdx profile show cronwell-manufacturing-procurement
  fcdx filter --profile midmarket-us
  fcdx enrich list thermal-cooling --profile cronwell-manufacturing-procurement
```

### `fcdx sql --help`

```text
Usage: fcdx sql [options]

Run safe read-only SQL against the FCD-X DuckDB. Intended for agent diagnostics,
ad hoc counts, and deeper analysis that is awkward as a first-class command.

Options:
  --query <sql>              SQL query to run.
  --file <path>              SQL file to run.
  --format <format>          table, json, csv.
  --limit <n>                Max rows unless query has an explicit limit.
  --readonly                 Enforced; mutating SQL is rejected.

Examples:
  fcdx sql --query "select industry, count(*) from companies group by 1 order by 2 desc limit 20"
  fcdx sql --file analysis/category_coverage.sql --format csv
```

### `fcdx snapshot --help`

```text
Usage: fcdx snapshot [options] [command]

Freeze and compare lists/rankings/runs so a result can be reproduced later.

Commands:
  create <name>              Snapshot a list, run, ranking, or mission.
  show <name>                Show snapshot metadata and artifacts.
  diff <a> <b>               Compare two snapshots.
  restore <name>             Recreate a list from a snapshot.

Examples:
  fcdx snapshot create cto-shortlist-v1 --list agent-shortlist-200
  fcdx snapshot diff cto-shortlist-v1 cto-shortlist-v2 --explain
  fcdx snapshot restore cto-shortlist-v1 --to-list restored-shortlist
```

### `fcdx integration --help`

```text
Usage: fcdx integration [options] [command]

Import/export/sync data with external systems.

Commands:
  import-csv                 Import companies, labels, tags, or buyer contacts from CSV.
  export-crm                 Export account packages for CRM upload.
  sync-hubspot               Sync selected companies to HubSpot.
  sync-salesforce            Sync selected companies to Salesforce.
  webhooks                   Manage webhook endpoints for long-running jobs.

Examples:
  fcdx integration import-csv --type labels --input cto-reviewed.csv
  fcdx integration export-crm --list agent-shortlist-200 --format hubspot-csv
  fcdx integration sync-hubspot --list ready-for-outreach --dry-run
```

### `fcdx export --help`

```text
Usage: fcdx export [options] [command]

Export company lists, ranked results, enrichment evidence, and buyer contacts.

Commands:
  list <name>                Export a company list.
  run <run-id>               Export run outputs.
  buyers <list>              Export buyer/person records.

Options:
  --format <format>          csv, jsonl, json.
  --include <parts>          companies,enrichment,evidence,tags,notes,buyers,cache.
  --output <path>            Output path.

Examples:
  fcdx export list thermal-cooling --format csv --include companies,enrichment,buyers,tags
  fcdx export run target-agent-2026-06-17 --format jsonl
```

### `fcdx target --help`

```text
Usage: fcdx target [options] [command]

Compare and rank against the PDF target-company/category document. This command
group remains useful for the current project, but most future workflows should
use list/enrich/rank.

Commands:
  compare                    Compare PDF companies against the candidate pool.
  shortlist                  Create deterministic pre-rank for enrichment triage.
  rank-enriched              Rank enriched JSONL using target_alignment fields.

Examples:
  fcdx target compare --candidates output/candidates/db-strict.jsonl
  fcdx target shortlist --candidates output/candidates/db-strict.jsonl --limit 500
  fcdx target rank-enriched --enriched output/enriched/target-agent-enriched.jsonl \
    --min-score 70 --min-manufacturing-fit 65 --min-procurement-fit 65 --limit 200
```

## Command Families

### Database

```bash
fcdx db init
fcdx db status
fcdx db schema
fcdx db vacuum
```

`db status` should show table counts, DB path, candidate counts by industry/size,
cache counts, and latest enrichment run.

### Search And Filter

Rename or alias `filterby` to `filter`.

```bash
fcdx filter --industry construction --headcount-min 200 --headcount-max 10000
fcdx filter --tag target:thermal --tag procurement:complex
fcdx filter --query "cooling OR thermal OR chiller"
fcdx filter --profile midmarket-us --output list:thermal-cooling
```

Important flags:

- `--profile <name>`: saved filter profile.
- `--query <expr>`: keyword query over name, website, tags, summaries, categories.
- `--tag <tag>`: require one or more tags.
- `--exclude-tag <tag>`: exclude known bad groups.
- `--has-enrichment`: only companies with enrichment.
- `--json`: machine-readable output.
- `--explain`: show why each row matched.

### Missions

Missions are the larger abstraction above lists and runs. They let an agent keep
a whole research objective coherent across many steps.

```bash
fcdx mission start dc-procurement --goal "Find 200 manufacturer/procurement-heavy data center infrastructure targets"
fcdx mission plan dc-procurement
fcdx mission next dc-procurement
fcdx mission status dc-procurement
fcdx mission close dc-procurement
```

A mission should track:

- goal and success criteria
- active lists
- enrichment/ranking runs
- selected rubric
- review queues
- final exports
- unresolved blockers

### Discovery

Discovery should help an agent move from a vague market to candidate pools.

```bash
fcdx discover category "data center switchgear manufacturers" --to-list switchgear-discovery
fcdx discover similar --seed "SMTC" --seed "Mack Technologies" --to-list ems-similar
fcdx discover gaps --mission dc-procurement
```

Discovery can combine:

- keyword expansion
- seed-company similarity
- enriched summary search
- tag/category search
- PDF/company-doc extraction
- negative examples

### Segmentation

Segmentation organizes a large list into smaller work queues.

```bash
fcdx segment cluster all-candidates --k 12 --create-lists
fcdx segment list agent-shortlist-200 --by category,manufacturing_fit,procurement_fit
fcdx segment outliers agent-shortlist-200 --where "score > 80 AND manufacturing_fit < 50"
```

Useful segment dimensions:

- target category
- manufacturing/procurement score bands
- geography
- headcount bucket
- enriched buyer type
- confidence/evidence quality
- review status

### Lists

Lists are the most important missing abstraction.

```bash
fcdx list create thermal-cooling --description "Cooling and thermal infrastructure targets"
fcdx list add thermal-cooling --company "cooling source"
fcdx list add thermal-cooling --from-filter --query "cooling OR thermal OR hvac OR chiller"
fcdx list remove thermal-cooling --company-id abc123
fcdx list show thermal-cooling --limit 50
fcdx list stats thermal-cooling
fcdx list dedupe thermal-cooling
fcdx list export thermal-cooling --format csv
fcdx list diff thermal-cooling old-thermal-list
fcdx list union thermal-cooling switchgear --output infra-manufacturers
fcdx list intersect thermal-cooling procurement-complex --output thermal-procurement-fit
```

List rows should preserve source and reason:

- filter expression
- agent recommendation
- manual add
- imported CSV
- prior shortlist

### Tags

Tags let agents iteratively improve the dataset.

```bash
fcdx tag add --company "SMTC" --tag buyer:contract_manufacturer --reason "EMS with end-to-end manufacturing"
fcdx tag add --list thermal-cooling --tag target:thermal
fcdx tag remove --company-id abc123 --tag target:thermal
fcdx tag list --company "SMTC"
fcdx tag stats
fcdx tag suggest --list thermal-cooling
```

Tags should support confidence and source:

```bash
fcdx tag add --company "SMTC" \
  --tag buyer:contract_manufacturer \
  --confidence 0.9 \
  --source agent \
  --reason "Website describes end-to-end electronics manufacturing services"
```

### Enrichment

Batch enrichment is now under the main CLI as `fcdx enrich file`. Future
commands can add DB-backed run tracking and list-native enrichment:

```bash
fcdx enrich company --company "SMTC"
fcdx enrich list thermal-cooling --concurrency 50 --resume
fcdx enrich filter --profile midmarket-us --limit 500
fcdx enrich missing --list thermal-cooling
fcdx enrich retry-errors --run target-agent-2026-06-17
```

Important flags:

- `--profile cronwell-manufacturing-procurement`
- `--schema-version procurement_manufacturing_v2`
- `--cache-dir output/cache/firecrawl`
- `--force-refresh`
- `--resume`
- `--concurrency`
- `--tmux`
- `--dry-run`

The enrichment profile should be explicit. The current profile should be named
something like `cronwell-manufacturing-procurement`.

### Rubrics And Evals

Rubrics should be first-class because CTO feedback will keep changing the target
definition.

```bash
fcdx rubric show cronwell-manufacturing-procurement
fcdx rubric test procurement_manufacturing_v2 --company "SMTC"
fcdx rubric eval procurement_manufacturing_v2 --label-set cto-reviewed
fcdx rubric compare procurement_manufacturing_v1 procurement_manufacturing_v2 --sample 100
```

Rubric evals should report:

- false positives
- false negatives
- score calibration
- examples where data-center fit overpowered manufacturing/procurement fit
- examples where category fit was inferred too broadly

### Ranking

```bash
fcdx rank list thermal-cooling --by target_alignment.score --top 200
fcdx rank run target-agent-2026-06-17 --top 200
fcdx rank explain --company "SMTC"
fcdx rank export --list thermal-cooling --top 50 --format csv
```

Ranking should support multiple strategies:

- `agent-score`: sort by final target alignment.
- `procurement-first`: require minimum manufacturing/procurement sub-scores.
- `category-balanced`: ensure representation across categories.
- `new-only`: exclude companies already reviewed or pitched.

Example:

```bash
fcdx rank list all-candidates \
  --min-manufacturing-fit 70 \
  --min-procurement-fit 70 \
  --min-category-fit 50 \
  --top 200
```

### Company Inspection

```bash
fcdx company show "SMTC"
fcdx company show --id LRPUwUvAnzRFQdzNTTZylwgaxB99 --include enrichment,tags,lists,linkedin,cache
fcdx company explain "SMTC"
fcdx company open-cache "SMTC"
fcdx company mark-reviewed "SMTC" --status good-fit
```

`company explain` should answer:

- Why is this company in a list?
- What evidence supports target fit?
- What evidence weakens fit?
- Which tags/lists/runs include it?
- What should be checked manually?

### Evidence Search

Evidence search makes the agent auditable. It should search cached markdown,
HTML-derived text, screenshots when available, and agent evidence fields.

```bash
fcdx evidence search --list agent-shortlist-200 --query "manufacturing facilities"
fcdx evidence show --company "SMTC" --fields manufacturing_fit,procurement_fit
fcdx evidence contradictions --where "score > 80 AND manufacturing_fit < 50"
```

This is how agents should debug bad rankings without reopening every website.

### Account Packages

Account packages turn research into sales-ready artifacts.

```bash
fcdx account build --company "SMTC" --include evidence,buyers,pitch
fcdx account batch --list agent-shortlist-200 --top 25
```

An account package should include:

- company snapshot
- why Cronwell should care
- manufacturing/procurement evidence
- target category
- disqualifiers/caveats
- likely buyer personas
- LinkedIn contacts
- pitch angle
- source links/cache paths

### Cache

```bash
fcdx cache stats
fcdx cache show --company "SMTC"
fcdx cache validate --list thermal-cooling
fcdx cache clear --company "SMTC"
fcdx cache stale --schema-version procurement_manufacturing_v2
```

### LinkedIn

Existing commands:

```bash
fcdx linkedin auth
fcdx linkedin list-profiles --company "SMTC" --p "procurement"
```

Future commands:

```bash
fcdx linkedin find-buyers --company "SMTC" --roles procurement,supply-chain,operations
fcdx linkedin enrich-list thermal-cooling --roles procurement,supply-chain
fcdx linkedin export-buyers --list thermal-cooling
```

Buyer/persona search should prioritize:

- procurement
- sourcing
- supply chain
- operations
- manufacturing
- plant management
- finance/operations leadership for smaller companies

### Runs

Agents need run observability.

```bash
fcdx run list
fcdx run show target-agent-2026-06-17
fcdx run logs target-agent-2026-06-17
fcdx run resume target-agent-2026-06-17
fcdx run cancel target-agent-2026-06-17
```

`run show` should report:

- status
- input list/filter
- profile/schema version
- completed/total
- errors
- average latency
- estimated remaining time
- output files

### SQL

Even with rich commands, agents will need ad hoc analysis.

```bash
fcdx sql --query "select industry, count(*) from companies group by 1 order by 2 desc limit 20"
```

Guardrails:

- read-only by default
- reject mutation statements unless explicitly enabled for migrations
- auto-limit output unless `--no-limit`
- always support `--json`

### Snapshots

Snapshots make rankings reproducible.

```bash
fcdx snapshot create cto-shortlist-v1 --list agent-shortlist-200
fcdx snapshot diff cto-shortlist-v1 cto-shortlist-v2
```

Snapshots should store:

- source list/run IDs
- rubric/schema versions
- filter/ranking thresholds
- row IDs and ranks
- output file paths

### Integrations

The CLI should eventually connect research to CRM/sales workflows.

```bash
fcdx integration export-crm --list ready-for-outreach --format hubspot-csv
fcdx integration import-csv --type labels --input cto-reviewed.csv
```

Early version can be CSV-only. Later versions can sync HubSpot/Salesforce.

## Agent Ergonomics

For an AI agent to pilot this CLI well, every command should have:

- `--json` for structured output.
- `--dry-run` for planning.
- `--explain` for provenance.
- `--limit` for bounded sampling.
- `--resume` for long-running jobs.
- stable IDs for lists, runs, tags, and companies.
- deterministic default output paths.
- concise stderr progress and machine-readable stdout.

Agents should not need to parse decorative tables. Human-friendly tables are
fine, but JSON should always be available.

## Example Agent Playbooks

### Build A Thermal/Cooling Target List

```bash
fcdx list create thermal-cooling
fcdx list add thermal-cooling --from-filter \
  --query "cooling OR thermal OR hvac OR chiller OR liquid cooling OR immersion"
fcdx enrich list thermal-cooling --profile cronwell-manufacturing-procurement --concurrency 50 --resume
fcdx rank list thermal-cooling \
  --min-manufacturing-fit 70 \
  --min-procurement-fit 70 \
  --top 50
fcdx linkedin enrich-list thermal-cooling --roles procurement,supply-chain,operations
fcdx export list thermal-cooling --format csv --include companies,enrichment,tags,buyers
```

### Repair A Bad Shortlist

```bash
fcdx rank explain --list agent-shortlist-200 --top 20
fcdx tag add --list agent-shortlist-200 --where "manufacturing_fit < 50" --tag exclude:no_manufacturing
fcdx rank list all-candidates --exclude-tag exclude:no_manufacturing --top 200
```

### Create A Category-Balanced Shortlist

```bash
fcdx rank list all-candidates \
  --strategy category-balanced \
  --categories switchgear_transformers_busway,cooling_thermal_management,cabling_connectivity \
  --per-category 50
```

## Ranking Rubric Update

The current enrichment rubric should be procurement-first:

- Manufacturing/procurement fit is primary.
- PDF category fit is secondary but important.
- Data-center relevance is useful, but cannot compensate for lack of manufacturer/procurement buyer profile.
- Final outputs should expose sub-scores so humans and agents can audit bad rankings.

Recommended minimums for final target shortlist:

```text
manufacturing_fit >= 65
procurement_fit >= 65
category_fit >= 40
target_alignment_score >= 70
```

Exceptions can be allowed for industrial contractors with major material/project
purchasing even if they do not own factories.

The ranker should also apply deterministic caps:

- No clear PDF category fit should cap ranking score below direct category fits.
- Weak manufacturing fit should cap ranking score even when data-center fit is high.
- Weak procurement fit should cap ranking score even when the company is operationally relevant.
- `best_fit_categories = ["none"]` should be preserved as a useful signal, but such
  companies should not dominate category-specific shortlists.

## Roadmap

### Phase 1: Clean Up The Current Workflow

- Keep `fcdx enrich file` as the file-backed batch enrichment path.
- Add sub-scores to target alignment.
- Add `rank-enriched` filters for min manufacturing/procurement/category scores.
- Add `db schema` and `db status`.

### Phase 2: Lists And Tags

- Add `lists`, `list_members`, `tags`, `company_tags`, and `company_notes`.
- Implement `fcdx list`.
- Implement `fcdx tag`.
- Let `filter` read/write lists directly.

### Phase 3: Missions, Runs, And Profiles

- Add `missions` and `mission_artifacts`.
- Move batch enrichment under `fcdx enrich`.
- Add `enrichment_runs`.
- Add saved filter/enrichment profiles.
- Add run resume/cancel/log commands.

### Phase 4: Discovery, Segmentation, Rubrics

- Add `fcdx discover` for seed/category expansion.
- Add `fcdx segment` for category/score/geography clustering.
- Add `rubrics`, `review_queues`, and `review_labels`.
- Add `fcdx rubric` and `fcdx review`.
- Add eval workflow for CTO feedback and false-positive repair.

### Phase 5: Evidence And Account Packages

- Add `fcdx evidence`.
- Add `account_packages`.
- Add `fcdx account`.
- Add `fcdx snapshot` for reproducibility.

### Phase 6: Buyer Discovery And Integrations

- Add LinkedIn buyer/persona enrichment.
- Store buyer contacts and account roles.
- Export account packages for sales review.
- Add CSV CRM export first.
- Add HubSpot/Salesforce sync later.

### Phase 7: Agent-Native UX

- Add universal `--json`, `--dry-run`, and `--explain`.
- Add command recipes/playbooks.
- Add validation commands that catch bad list/ranking assumptions.
- Add `fcdx mission next` so an agent can ask the CLI what to do next.
