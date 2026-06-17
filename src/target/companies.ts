import fs from "node:fs/promises";
import path from "node:path";
import type { CandidateCompany, DatasetCompanyRow, EnrichedCompany, EnrichmentQuestionKey } from "../types.js";

export type TargetCompany = {
  name: string;
  aliases?: string[];
  category: string;
  tier: number;
};

export type TargetConfig = {
  source: string;
  targetCategories: string[];
  companies: TargetCompany[];
  alsoMentioned: string[];
};

export type TargetMatch = {
  targetName: string;
  aliasMatched: string;
  category?: string;
  tier?: number;
  candidate?: CandidateCompany;
  matchType: "exact_name" | "contains_name" | "website_or_linkedin" | "none";
};

export type ShortlistRow = {
  candidate: CandidateCompany;
  score: number;
  categories: string[];
  signals: string[];
  enrichedYesCount?: number;
};

export type AgentShortlistRow = {
  source_row: DatasetCompanyRow;
  score: number;
  priority: string;
  categories: string[];
  company_summary: string;
  target_reason: string;
  positive_evidence: string[];
  negative_evidence: string[];
  yesCount: number;
  enrichment: EnrichedCompany["enrichment"];
  agent_metadata: EnrichedCompany["agent_metadata"];
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  switchgear_transformers_busway: [
    "switchgear",
    "transformer",
    "substation",
    "busway",
    "power equipment",
    "power systems",
    "voltage",
    "breaker",
    "panelboard",
    "pdu",
    "ups",
  ],
  electrical_mechanical_contractors: [
    "electric",
    "electrical",
    "mechanical",
    "mep",
    "automation",
    "contractor",
    "industrial",
    "controls",
    "power",
    "hvac",
  ],
  structural_steel_precast_sitework: [
    "steel",
    "precast",
    "concrete",
    "tilt",
    "wall",
    "site",
    "earthwork",
    "infrastructure",
    "fabrication",
    "erection",
  ],
  generators_backup_power_bess_fuel_cells_microgrids: [
    "generator",
    "backup",
    "battery",
    "bess",
    "energy storage",
    "fuel cell",
    "microgrid",
    "powersecure",
    "energy",
  ],
  cooling_thermal_management: [
    "cooling",
    "thermal",
    "hvac",
    "chiller",
    "crac",
    "crah",
    "heat exchanger",
    "liquid",
    "immersion",
    "air technology",
  ],
  modular_construction_gc_mep_commissioning: [
    "modular",
    "prefab",
    "construction",
    "contracting",
    "builders",
    "commissioning",
    "integration",
    "facilities",
    "mep",
    "engineering",
  ],
  cabling_connectivity: ["cable", "cabling", "fiber", "fibre", "connectivity", "network", "wire", "telecom"],
  racks_enclosures_containment: [
    "rack",
    "cabinet",
    "enclosure",
    "containment",
    "sheet metal",
    "metal",
    "fabrication",
  ],
  building_management_dcim: ["building management", "bms", "dcim", "controls", "automation", "bacnet"],
  fire_suppression: ["fire", "suppression", "alarm", "protection", "safety"],
  physical_security: ["security", "surveillance", "camera", "access control", "vision", "video"],
};

const QUESTION_KEYS: EnrichmentQuestionKey[] = [
  "supplies_datacenters",
  "manufacturing_or_factories",
  "high_volume_or_high_mix",
  "large_procurement_team",
  "turnkey_contract_manufacturer",
];

export async function readTargetConfig(pathname: string): Promise<TargetConfig> {
  return JSON.parse(await fs.readFile(pathname, "utf8")) as TargetConfig;
}

export async function readCandidateJsonl(pathname: string): Promise<CandidateCompany[]> {
  const raw = await fs.readFile(pathname, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CandidateCompany);
}

export async function readEnrichedYesCounts(pathname: string | undefined): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!pathname) return counts;
  try {
    const raw = await fs.readFile(pathname, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as EnrichedCompany;
      const yesCount = QUESTION_KEYS.reduce(
        (sum, key) => sum + (row.enrichment?.[key]?.answer === "yes" ? 1 : 0),
        0,
      );
      counts.set(row.source_row.id, yesCount);
    }
  } catch {
    return counts;
  }
  return counts;
}

export async function readEnrichedJsonl(pathname: string): Promise<EnrichedCompany[]> {
  const raw = await fs.readFile(pathname, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EnrichedCompany);
}

export function compareTargetCompanies(config: TargetConfig, candidates: CandidateCompany[]): TargetMatch[] {
  return config.companies.map((target) => {
    const aliases = [target.name, ...(target.aliases ?? [])];
    const match = findBestCandidateMatch(aliases, candidates);
    return {
      targetName: target.name,
      aliasMatched: match.alias,
      category: target.category,
      tier: target.tier,
      candidate: match.candidate,
      matchType: match.matchType,
    };
  });
}

export function compareAlsoMentioned(config: TargetConfig, candidates: CandidateCompany[]): TargetMatch[] {
  return config.alsoMentioned.map((name) => {
    const match = findBestCandidateMatch([name], candidates);
    return {
      targetName: name,
      aliasMatched: match.alias,
      candidate: match.candidate,
      matchType: match.matchType,
    };
  });
}

export function buildTargetShortlist(
  config: TargetConfig,
  candidates: CandidateCompany[],
  options: { limit: number; enrichedYesCounts?: Map<string, number> },
): ShortlistRow[] {
  const excluded = excludedTargetKeys(config);
  const rows = candidates
    .filter((candidate) => !candidateMatchesExcluded(candidate, excluded))
    .map((candidate) => scoreCandidate(candidate, options.enrichedYesCounts?.get(candidate.id)))
    .filter((row) => row.score >= 8 && (row.categories.length > 0 || (row.enrichedYesCount ?? 0) >= 3))
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));

  return rows.slice(0, options.limit);
}

export function buildAgentJudgedShortlist(
  config: TargetConfig,
  rows: EnrichedCompany[],
  options: { limit: number },
): AgentShortlistRow[] {
  const excluded = excludedTargetKeys(config);
  return rows
    .filter((row) => !rowMatchesExcluded(row.source_row, excluded))
    .map((row) => {
      const target = row.enrichment.target_alignment;
      return {
        source_row: row.source_row,
        score: target?.score ?? 0,
        priority: target?.priority ?? "not_relevant",
        categories: target?.best_fit_categories ?? [],
        company_summary: row.enrichment.company_summary,
        target_reason: target?.reason ?? "",
        positive_evidence: target?.positive_evidence ?? [],
        negative_evidence: target?.negative_evidence ?? [],
        yesCount: countYesAnswers(row),
        enrichment: row.enrichment,
        agent_metadata: row.agent_metadata,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        priorityRank(b.priority) - priorityRank(a.priority) ||
        b.yesCount - a.yesCount ||
        a.source_row.name.localeCompare(b.source_row.name),
    )
    .slice(0, options.limit);
}

export async function writeShortlistCsv(pathname: string, rows: ShortlistRow[]): Promise<void> {
  const columns = [
    "score",
    "name",
    "website",
    "industry",
    "size",
    "region",
    "locality",
    "categories",
    "signals",
    "enriched_yes_count",
    "linkedin_url",
    "id",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((column) => {
          const value = shortlistCsvValue(column, row);
          return escapeCsv(value);
        })
        .join(","),
    );
  }
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${lines.join("\n")}\n`, "utf8");
}

export async function writeCoverageCsv(pathname: string, rows: TargetMatch[]): Promise<void> {
  const columns = [
    "target_name",
    "alias_matched",
    "category",
    "tier",
    "match_type",
    "candidate_name",
    "candidate_website",
    "candidate_industry",
    "candidate_size",
    "candidate_id",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((column) => escapeCsv(coverageCsvValue(column, row)))
        .join(","),
    );
  }
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${lines.join("\n")}\n`, "utf8");
}

export async function writeAgentShortlistCsv(pathname: string, rows: AgentShortlistRow[]): Promise<void> {
  const columns = [
    "target_alignment_score",
    "target_alignment_priority",
    "target_alignment_categories",
    "yes_count",
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
    "target_alignment_reason",
    "target_alignment_positive_evidence",
    "target_alignment_negative_evidence",
    "supplies_datacenters_answer",
    "manufacturing_or_factories_answer",
    "high_volume_or_high_mix_answer",
    "large_procurement_team_answer",
    "turnkey_contract_manufacturer_answer",
    "final_notes",
    "elapsed_ms",
    "error",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsv(agentShortlistCsvValue(column, row))).join(","));
  }
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${lines.join("\n")}\n`, "utf8");
}

function findBestCandidateMatch(
  aliases: string[],
  candidates: CandidateCompany[],
): { alias: string; candidate?: CandidateCompany; matchType: TargetMatch["matchType"] } {
  const normalizedAliases = aliases
    .map((alias) => ({ original: alias, normalized: normalizeName(alias) }))
    .filter((alias) => alias.normalized.length >= 3);

  for (const alias of normalizedAliases) {
    const exact = candidates.find((candidate) => normalizeName(candidate.name) === alias.normalized);
    if (exact) return { alias: alias.original, candidate: exact, matchType: "exact_name" };
  }

  for (const alias of normalizedAliases) {
    if (isUnsafeShortAlias(alias.normalized)) continue;
    const contains = candidates.find((candidate) => {
      const candidateName = normalizeName(candidate.name);
      if (candidateName.length < 3) return false;
      return candidateName.includes(alias.normalized);
    });
    if (contains) return { alias: alias.original, candidate: contains, matchType: "contains_name" };
  }

  for (const alias of normalizedAliases) {
    if (isUnsafeShortAlias(alias.normalized)) continue;
    const compactAlias = compact(alias.normalized);
    const website = candidates.find((candidate) => {
      const haystack = `${candidate.website} ${candidate.linkedinUrl ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return haystack.includes(compactAlias);
    });
    if (website) return { alias: alias.original, candidate: website, matchType: "website_or_linkedin" };
  }

  return { alias: aliases[0], matchType: "none" };
}

function scoreCandidate(candidate: CandidateCompany, enrichedYesCount: number | undefined): ShortlistRow {
  const haystack = normalizeHaystack(candidate);
  const categories: string[] = [];
  const signals: string[] = [];
  let score = 0;

  if (candidate.industry === "electrical/electronic manufacturing") {
    score += 6;
    signals.push("industry: electrical/electronic manufacturing");
  } else if (candidate.industry === "mechanical or industrial engineering") {
    score += 5;
    signals.push("industry: mechanical or industrial engineering");
  } else if (candidate.industry === "construction") {
    score += 3;
    signals.push("industry: construction");
  }

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = keywords.filter((keyword) => haystack.includes(keyword));
    if (hits.length === 0) continue;
    categories.push(category);
    const categoryScore = Math.min(10, hits.length * 3);
    score += categoryScore;
    signals.push(`${category}: ${hits.slice(0, 4).join(", ")}`);
  }

  const name = normalizeName(candidate.name);
  if (/\b(data|mission critical|critical|power|electric|mechanical|steel|concrete|cooling|security)\b/.test(name)) {
    score += 3;
    signals.push("name contains high-intent infrastructure term");
  }

  if (candidate.size === "501-1000" || candidate.size === "1001-5000") {
    score += 2;
    signals.push(`mid-market size bucket: ${candidate.size}`);
  } else if (candidate.size === "5001-10000") {
    score += 1;
    signals.push(`upper target size bucket: ${candidate.size}`);
  }

  if (enrichedYesCount !== undefined) {
    score += enrichedYesCount * 3;
    signals.push(`existing enrichment yes count: ${enrichedYesCount}/5`);
  }

  return {
    candidate,
    score,
    categories: [...new Set(categories)],
    signals,
    enrichedYesCount,
  };
}

function excludedTargetKeys(config: TargetConfig): Set<string> {
  const keys = new Set<string>();
  for (const company of config.companies) {
    for (const alias of [company.name, ...(company.aliases ?? [])]) keys.add(normalizeName(alias));
  }
  for (const name of config.alsoMentioned) keys.add(normalizeName(name));
  return keys;
}

function candidateMatchesExcluded(candidate: CandidateCompany, excluded: Set<string>): boolean {
  return normalizedNameMatchesExcluded(normalizeName(candidate.name), excluded);
}

function rowMatchesExcluded(row: DatasetCompanyRow, excluded: Set<string>): boolean {
  return normalizedNameMatchesExcluded(normalizeName(row.name), excluded);
}

function normalizedNameMatchesExcluded(candidateName: string, excluded: Set<string>): boolean {
  for (const key of excluded) {
    if (!key) continue;
    if (candidateName === key) return true;
    if (key.length >= 5 && candidateName.split(" ").includes(key)) return true;
    if (isUnsafeShortAlias(key)) continue;
    if (candidateName.includes(key)) return true;
  }
  return false;
}

function normalizeHaystack(candidate: CandidateCompany): string {
  return [
    candidate.name,
    candidate.website,
    candidate.linkedinUrl,
    candidate.region,
    candidate.locality,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9+./& -]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeName(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|inc|incorporated|llc|ltd|limited|corp|corporation|company|co|group|holdings|global|intl|international|usa|us)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "");
}

function isUnsafeShortAlias(value: string): boolean {
  return value.length < 5 || value.split(" ").length < 2 && value.length < 8;
}

function shortlistCsvValue(column: string, row: ShortlistRow): unknown {
  if (column === "score") return row.score;
  if (column === "categories") return row.categories.join("; ");
  if (column === "signals") return row.signals.join("; ");
  if (column === "enriched_yes_count") return row.enrichedYesCount;
  if (column === "linkedin_url") return row.candidate.linkedinUrl;
  return row.candidate[column as keyof CandidateCompany];
}

function coverageCsvValue(column: string, row: TargetMatch): unknown {
  if (column === "target_name") return row.targetName;
  if (column === "alias_matched") return row.aliasMatched;
  if (column === "category") return row.category;
  if (column === "tier") return row.tier;
  if (column === "match_type") return row.matchType;
  if (column === "candidate_name") return row.candidate?.name;
  if (column === "candidate_website") return row.candidate?.website;
  if (column === "candidate_industry") return row.candidate?.industry;
  if (column === "candidate_size") return row.candidate?.size;
  if (column === "candidate_id") return row.candidate?.id;
  return "";
}

function agentShortlistCsvValue(column: string, row: AgentShortlistRow): unknown {
  if (column === "target_alignment_score") return row.score;
  if (column === "target_alignment_priority") return row.priority;
  if (column === "target_alignment_categories") return row.categories.join("; ");
  if (column === "yes_count") return row.yesCount;
  if (column === "final_url") return row.agent_metadata.final_url;
  if (column === "company_summary") return row.company_summary;
  if (column === "target_alignment_reason") return row.target_reason;
  if (column === "target_alignment_positive_evidence") return row.positive_evidence.join("; ");
  if (column === "target_alignment_negative_evidence") return row.negative_evidence.join("; ");
  if (column === "final_notes") return row.enrichment.final_notes;
  if (column === "elapsed_ms") return row.agent_metadata.elapsed_ms;
  if (column === "error") return row.agent_metadata.error;
  for (const key of QUESTION_KEYS) {
    if (column === `${key}_answer`) return row.enrichment[key]?.answer;
  }
  return row.source_row[column as keyof DatasetCompanyRow];
}

function countYesAnswers(row: EnrichedCompany): number {
  return QUESTION_KEYS.reduce((sum, key) => sum + (row.enrichment[key]?.answer === "yes" ? 1 : 0), 0);
}

function priorityRank(priority: string): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
