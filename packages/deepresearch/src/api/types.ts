export type DeepResearchRunner = "open-deep-research" | "stub";

export type DeepResearchJobOptions = {
  runner?: DeepResearchRunner;
  searchApi?: string;
  model?: string;
  summarizationModel?: string;
  compressionModel?: string;
  finalReportModel?: string;
  maxConcurrentResearchUnits?: number;
  maxResearcherIterations?: number;
  maxReactToolCalls?: number;
  researchModelMaxTokens?: number;
  summarizationModelMaxTokens?: number;
  compressionModelMaxTokens?: number;
  finalReportModelMaxTokens?: number;
};

export type DeepResearchJobData = {
  prompt: string;
  metadata?: Record<string, unknown>;
  options?: DeepResearchJobOptions;
};

export type DeepResearchJobResult = {
  job_id: string;
  runner: DeepResearchRunner;
  status: "completed";
  report_path: string;
  prompt_path: string;
  run_json_path?: string;
  artifact_dir: string;
  elapsed_ms: number;
  started_at: string;
  completed_at: string;
};

export type SubmitJobRequest = {
  job_id?: string;
  prompt?: string;
  prompt_file?: string;
  metadata?: Record<string, unknown>;
  options?: DeepResearchJobOptions;
};

export type SubmitJobResponse = {
  job_id: string;
  status_url: string;
  report_url: string;
};
