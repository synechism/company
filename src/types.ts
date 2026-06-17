export type CompanyRecord = {
  country?: string;
  founded?: string;
  id?: string;
  industry?: string;
  linkedin_url?: string;
  locality?: string;
  name?: string;
  region?: string;
  size?: string;
  website?: string;
};

export type CandidateCompany = {
  id: string;
  name: string;
  website: string;
  url: string;
  industry: string;
  size: string;
  country: string;
  region?: string;
  locality?: string;
  linkedinUrl?: string;
  founded?: number;
};

export type DatasetCompanyRow = {
  country: string;
  founded: number | null;
  id: string;
  industry: string;
  linkedin_url: string | null;
  locality: string | null;
  name: string;
  region: string | null;
  size: string;
  website: string;
};

export type CrawlBackend = "local" | "hyperbrowser" | "firecrawl";

export type PageArtifact = {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  htmlPath?: string;
  screenshotPath?: string;
  elapsedMs: number;
  error?: string;
};

export type FitVerdict = "fit" | "possible_fit" | "not_fit";

export type FitAssessment = {
  verdict: FitVerdict;
  score: number;
  reasons: string[];
  matchedSignals: string[];
  snippets: string[];
};

export type CrawlResult = {
  company: CandidateCompany;
  backend: CrawlBackend;
  startedAt: string;
  elapsedMs: number;
  pages: PageArtifact[];
  assessment: FitAssessment;
  error?: string;
};

export type YesNoUnknown = "yes" | "no" | "unknown";

export type EnrichmentQuestionKey =
  | "supplies_datacenters"
  | "manufacturing_or_factories"
  | "high_volume_or_high_mix"
  | "large_procurement_team"
  | "turnkey_contract_manufacturer";

export type EnrichmentAnswer = {
  answer: YesNoUnknown;
  confidence: number;
  reason: string;
  evidence: string[];
};

export type TargetAlignment = {
  score: number;
  priority: "high" | "medium" | "low" | "not_relevant";
  best_fit_categories: string[];
  reason: string;
  positive_evidence: string[];
  negative_evidence: string[];
};

export type CompanyEnrichment = Record<EnrichmentQuestionKey, EnrichmentAnswer> & {
  company_summary: string;
  target_alignment: TargetAlignment;
  final_notes: string;
};

export type EnrichedCompany = {
  source_row: DatasetCompanyRow;
  enrichment: CompanyEnrichment;
  agent_metadata: {
    backend: "firecrawl_scrape_json";
    url: string;
    final_url?: string;
    title?: string;
    elapsed_ms: number;
    raw_output_path?: string;
    error?: string;
  };
};
