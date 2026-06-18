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
fcdx filterby
fcdx crawl
fcdx linkedin auth
fcdx linkedin list-profiles
fcdx target compare
fcdx target shortlist
fcdx target rank-enriched
npm run enrich
```

Useful existing pieces:

- DuckDB company cache in `src/db/fcdx.ts`.
- Firecrawl enrichment/cache in `src/enrich/firecrawl.ts`.
- Agent prompt/schema in `src/enrich/questions.ts`.
- Target ranking in `src/target/companies.ts`.
- Unipile LinkedIn integration in `src/unipile/client.ts`.

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
  1. fcdx filter ...                         Find companies from the dataset.
  2. fcdx list create/add ...                Save companies into durable lists.
  3. fcdx enrich list ...                    Crawl websites and agent-enrich companies.
  4. fcdx rank list ...                      Rank companies for Cronwell fit.
  5. fcdx company explain ...                Audit why a company is a fit.
  6. fcdx linkedin find-buyers ...           Find likely buyer contacts.
  7. fcdx export list ...                    Export final account packages.

Commands:
  db                         Manage the DuckDB dataset/cache.
  filter                     Search/filter companies from the dataset.
  list                       Create and manage durable company lists.
  tag                        Add, remove, and inspect company tags.
  note                       Add and inspect company notes.
  enrich                     Crawl and agent-enrich companies.
  rank                       Rank enriched companies for Cronwell fit.
  company                    Inspect one company, its evidence, tags, lists, and cache.
  cache                      Inspect and manage Firecrawl cache artifacts.
  linkedin                   Authenticate LinkedIn and find buyer profiles.
  run                        Inspect, resume, and manage long-running jobs.
  profile                    Manage saved filter/enrichment/ranking profiles.
  export                     Export lists, enrichments, buyers, and evidence.
  target                     Compare and rank against PDF target categories.

Examples:
  fcdx db status
  fcdx filter --profile midmarket-us --industry "electrical/electronic manufacturing"
  fcdx list create thermal-cooling --description "Cooling and thermal targets"
  fcdx list add thermal-cooling --from-filter --query "cooling OR thermal OR chiller"
  fcdx enrich list thermal-cooling --profile cronwell-manufacturing-procurement --concurrency 50 --resume
  fcdx rank list thermal-cooling --min-manufacturing-fit 65 --min-procurement-fit 65 --top 50
  fcdx company explain "SMTC"
  fcdx linkedin find-buyers --company "SMTC" --roles procurement,supply-chain,operations
  fcdx export list thermal-cooling --format csv --include companies,enrichment,buyers,tags
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

Move `npm run enrich` into the main CLI eventually:

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

- Keep `npm run enrich`, but document it as batch enrichment.
- Add sub-scores to target alignment.
- Add `rank-enriched` filters for min manufacturing/procurement/category scores.
- Add `db schema` and `db status`.

### Phase 2: Lists And Tags

- Add `lists`, `list_members`, `tags`, `company_tags`, and `company_notes`.
- Implement `fcdx list`.
- Implement `fcdx tag`.
- Let `filter` read/write lists directly.

### Phase 3: Runs And Profiles

- Move batch enrichment under `fcdx enrich`.
- Add `enrichment_runs`.
- Add saved filter/enrichment profiles.
- Add run resume/cancel/log commands.

### Phase 4: Buyer Discovery

- Add LinkedIn buyer/persona enrichment.
- Store buyer contacts and account roles.
- Export account packages for sales review.

### Phase 5: Agent-Native UX

- Add universal `--json`, `--dry-run`, and `--explain`.
- Add command recipes/playbooks.
- Add validation commands that catch bad list/ranking assumptions.
