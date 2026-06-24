import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import pLimit from "p-limit";
import type { CandidateCompany, EnrichedCompany } from "../types.js";
import { appendJsonl, writeJson } from "../crawl/artifacts.js";
import { enrichCompanyWithFirecrawl } from "./firecrawl.js";

export type BatchEnrichmentOptions = {
  apiKey: string;
  input: string;
  output: string;
  summary: string;
  csvOutput?: string;
  limit?: number;
  offset: number;
  concurrency: number;
  timeoutMs: number;
  cacheDir?: string;
  forceRefresh: boolean;
  customQuestion?: string;
  fullPage?: boolean;
  includeHtml?: boolean;
  includeScreenshot?: boolean;
  website?: string[];
  resume: boolean;
  progressEvery: number;
};

export async function runBatchEnrichment(options: BatchEnrichmentOptions): Promise<unknown> {
  const completedIds = options.resume ? await readCompletedIds(options.output) : new Set<string>();
  if (!options.resume) {
    await fsp.rm(options.output, { force: true });
    await fsp.rm(options.summary, { force: true });
    if (options.csvOutput) await fsp.rm(options.csvOutput, { force: true });
  }
  await fsp.mkdir(path.dirname(options.output), { recursive: true });
  await fsp.mkdir(path.dirname(options.summary), { recursive: true });

  const candidates = await readCandidates(options.input, {
    limit: options.limit,
    offset: options.offset,
    websites: options.website,
    completedIds,
  });
  if (candidates.length === 0) {
    throw new Error(`No candidates selected from ${options.input}`);
  }

  const started = Date.now();
  const limit = pLimit(options.concurrency);
  const results: EnrichedCompany[] = [];
  let completed = 0;
  let errorCount = 0;

  await Promise.all(
    candidates.map((company) =>
      limit(async () => {
        const result = await enrichCompanyWithFirecrawl(company, {
          apiKey: options.apiKey,
          outputDir: path.dirname(options.output),
          timeoutMs: options.timeoutMs,
          cacheDir: options.cacheDir,
          forceRefresh: options.forceRefresh,
          customQuestion: options.customQuestion,
          fullPage: options.fullPage,
          includeHtml: options.includeHtml,
          includeScreenshot: options.includeScreenshot,
        });
        results.push(result);
        completed += 1;
        if (result.agent_metadata.error) errorCount += 1;
        await appendJsonl(options.output, result);
        if (options.progressEvery > 0 && (completed % options.progressEvery === 0 || completed === candidates.length)) {
          const elapsedSec = (Date.now() - started) / 1000;
          const rate = completed / Math.max(1, elapsedSec);
          const remaining = candidates.length - completed;
          const etaMin = remaining / Math.max(0.001, rate) / 60;
          console.error(
            `enriched ${completed}/${candidates.length} errors=${errorCount} rate=${rate.toFixed(
              2,
            )}/s eta=${etaMin.toFixed(1)}m`,
          );
        }
      }),
    ),
  );

  const elapsedMs = Date.now() - started;
  const summary = buildSummary(results, elapsedMs, options);
  if (options.csvOutput) {
    await writeCsv(options.csvOutput, results);
  }
  await writeJson(options.summary, summary);
  return summary;
}

async function readCandidates(
  pathname: string,
  readOptions: { limit?: number; offset: number; websites?: string[]; completedIds: Set<string> },
): Promise<CandidateCompany[]> {
  const wantedHosts = new Set((readOptions.websites ?? []).map(hostKey));
  const stream = fs.createReadStream(pathname, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: CandidateCompany[] = [];
  let seen = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const candidate = JSON.parse(line) as CandidateCompany;
    if (readOptions.completedIds.has(candidate.id)) continue;
    if (wantedHosts.size > 0 && !wantedHosts.has(hostKey(candidate.url || candidate.website))) {
      continue;
    }
    if (seen < readOptions.offset) {
      seen += 1;
      continue;
    }
    rows.push(candidate);
    if (readOptions.limit !== undefined && rows.length >= readOptions.limit) break;
  }

  return rows;
}

async function readCompletedIds(pathname: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!fs.existsSync(pathname)) return ids;
  const stream = fs.createReadStream(pathname, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as EnrichedCompany;
      if (row.source_row?.id) ids.add(row.source_row.id);
    } catch {
      // Ignore a partial trailing line from an interrupted append.
    }
  }
  return ids;
}

async function writeCsv(pathname: string, rows: EnrichedCompany[]): Promise<void> {
  await fsp.mkdir(path.dirname(pathname), { recursive: true });
  const columns = [
    "id",
    "name",
    "website",
    "country",
    "region",
    "locality",
    "industry",
    "size",
    "founded",
    "linkedin_url",
    "final_url",
    "company_summary",
    "custom_question",
    "custom_answer",
    "custom_confidence",
    "custom_reason",
    "custom_evidence",
    "supplies_datacenters_answer",
    "supplies_datacenters_confidence",
    "supplies_datacenters_reason",
    "manufacturing_or_factories_answer",
    "manufacturing_or_factories_confidence",
    "manufacturing_or_factories_reason",
    "high_volume_or_high_mix_answer",
    "high_volume_or_high_mix_confidence",
    "high_volume_or_high_mix_reason",
    "large_procurement_team_answer",
    "large_procurement_team_confidence",
    "large_procurement_team_reason",
    "turnkey_contract_manufacturer_answer",
    "turnkey_contract_manufacturer_confidence",
    "turnkey_contract_manufacturer_reason",
    "target_alignment_score",
    "target_alignment_priority",
    "target_alignment_manufacturing_fit",
    "target_alignment_procurement_fit",
    "target_alignment_category_fit",
    "target_alignment_datacenter_fit",
    "target_alignment_categories",
    "target_alignment_reason",
    "target_alignment_positive_evidence",
    "target_alignment_negative_evidence",
    "target_alignment_disqualifiers",
    "target_alignment_schema_version",
    "final_notes",
    "elapsed_ms",
    "error",
  ];
  const lines = [columns.join(",")];

  for (const row of rows) {
    const source = row.source_row;
    const enrichment = row.enrichment;
    lines.push(
      columns
        .map((column) => {
          const value = csvValue(column, source, enrichment, row);
          return escapeCsv(value);
        })
        .join(","),
    );
  }

  await fsp.writeFile(pathname, `${lines.join("\n")}\n`, "utf8");
}

function csvValue(
  column: string,
  source: EnrichedCompany["source_row"],
  enrichment: EnrichedCompany["enrichment"],
  row: EnrichedCompany,
): unknown {
  if (column in source) return source[column as keyof typeof source];
  if (column === "final_url") return row.agent_metadata.final_url;
  if (column === "company_summary") return enrichment.company_summary;
  if (column === "custom_question") return enrichment.custom_evaluation?.question;
  if (column === "custom_answer") return enrichment.custom_evaluation?.answer;
  if (column === "custom_confidence") return enrichment.custom_evaluation?.confidence;
  if (column === "custom_reason") return enrichment.custom_evaluation?.reason;
  if (column === "custom_evidence") return enrichment.custom_evaluation?.evidence?.join("; ");
  if (column === "target_alignment_score") return enrichment.target_alignment?.score;
  if (column === "target_alignment_priority") return enrichment.target_alignment?.priority;
  if (column === "target_alignment_manufacturing_fit") return enrichment.target_alignment?.manufacturing_fit;
  if (column === "target_alignment_procurement_fit") return enrichment.target_alignment?.procurement_fit;
  if (column === "target_alignment_category_fit") return enrichment.target_alignment?.category_fit;
  if (column === "target_alignment_datacenter_fit") return enrichment.target_alignment?.datacenter_fit;
  if (column === "target_alignment_categories") return enrichment.target_alignment?.best_fit_categories?.join("; ");
  if (column === "target_alignment_reason") return enrichment.target_alignment?.reason;
  if (column === "target_alignment_positive_evidence") return enrichment.target_alignment?.positive_evidence?.join("; ");
  if (column === "target_alignment_negative_evidence") return enrichment.target_alignment?.negative_evidence?.join("; ");
  if (column === "target_alignment_disqualifiers") return enrichment.target_alignment?.disqualifiers?.join("; ");
  if (column === "target_alignment_schema_version") return enrichment.target_alignment?.schema_version;
  if (column === "final_notes") return enrichment.final_notes;
  if (column === "elapsed_ms") return row.agent_metadata.elapsed_ms;
  if (column === "error") return row.agent_metadata.error;

  for (const key of [
    "supplies_datacenters",
    "manufacturing_or_factories",
    "high_volume_or_high_mix",
    "large_procurement_team",
    "turnkey_contract_manufacturer",
  ] as const) {
    if (column === `${key}_answer`) return enrichment[key].answer;
    if (column === `${key}_confidence`) return enrichment[key].confidence;
    if (column === `${key}_reason`) return enrichment[key].reason;
  }

  return "";
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildSummary(
  results: EnrichedCompany[],
  elapsedMs: number,
  opts: { input: string; output: string; concurrency: number; timeoutMs: number; customQuestion?: string },
): unknown {
  const observedMs = results.reduce((sum, result) => sum + result.agent_metadata.elapsed_ms, 0);
  const errors = results.filter((result) => result.agent_metadata.error);
  return {
    input: opts.input,
    output: opts.output,
    customQuestion: opts.customQuestion,
    companies: results.length,
    errors: errors.length,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
    elapsedMs,
    avgMsPerCompanyWallClock: Math.round(elapsedMs / Math.max(1, results.length)),
    avgMsPerCompanyObserved: Math.round(observedMs / Math.max(1, results.length)),
    answerCounts: {
      ...(opts.customQuestion ? { custom_evaluation: countAnswers(results, "custom_evaluation") } : {}),
      supplies_datacenters: countAnswers(results, "supplies_datacenters"),
      manufacturing_or_factories: countAnswers(results, "manufacturing_or_factories"),
      high_volume_or_high_mix: countAnswers(results, "high_volume_or_high_mix"),
      large_procurement_team: countAnswers(results, "large_procurement_team"),
      turnkey_contract_manufacturer: countAnswers(results, "turnkey_contract_manufacturer"),
    },
    backOfEnvelopeFor7474: estimateRuntime(elapsedMs, results.length, 7474),
  };
}

function countAnswers(results: EnrichedCompany[], key: keyof EnrichedCompany["enrichment"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    const value = result.enrichment[key];
    if (!value || typeof value !== "object" || !("answer" in value)) continue;
    const answer = String(value.answer);
    counts[answer] = (counts[answer] ?? 0) + 1;
  }
  return counts;
}

function estimateRuntime(elapsedMs: number, sampleCount: number, targetCount: number): Record<string, number> {
  const msPerCompanyWall = elapsedMs / Math.max(1, sampleCount);
  const totalMs = msPerCompanyWall * targetCount;
  return {
    totalCompanies: targetCount,
    estimatedMs: Math.round(totalMs),
    estimatedMinutes: Number((totalMs / 60_000).toFixed(1)),
    estimatedHours: Number((totalMs / 3_600_000).toFixed(2)),
  };
}

function hostKey(urlOrHost: string): string {
  try {
    const url = new URL(urlOrHost.startsWith("http") ? urlOrHost : `https://${urlOrHost}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return urlOrHost.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  }
}
