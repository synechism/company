export type DeepResearchSubmitOptions = {
  runner?: "open-deep-research" | "stub";
  searchApi?: string;
  model?: string;
  maxConcurrentResearchUnits?: number;
  maxResearcherIterations?: number;
  maxReactToolCalls?: number;
  forceRefresh?: boolean;
};

export type DeepResearchSubmitInput = {
  jobId?: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  options?: DeepResearchSubmitOptions;
};

export type DeepResearchSubmitResponse = {
  job_id: string;
  status_url: string;
  report_url: string;
};

export class DeepResearchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export class DeepResearchClient {
  constructor(readonly baseUrl: string) {}

  async submit(input: DeepResearchSubmitInput): Promise<DeepResearchSubmitResponse> {
    return this.request<DeepResearchSubmitResponse>("/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        job_id: input.jobId,
        prompt: input.prompt,
        metadata: input.metadata,
        options: input.options,
      }),
    });
  }

  async status(jobId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/jobs/${encodeURIComponent(jobId)}`);
  }

  async report(jobId: string): Promise<string> {
    const response = await fetch(this.url(`/jobs/${encodeURIComponent(jobId)}/report.txt`));
    if (!response.ok) {
      const body = await response.text();
      throw new DeepResearchApiError(`Deepresearch report request failed (${response.status})`, response.status, body);
    }
    return response.text();
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.url(pathname), init);
    const text = await response.text();
    const body = text ? parseResponseJson(text) : undefined;
    if (!response.ok) {
      throw new DeepResearchApiError(`Deepresearch API request failed (${response.status})`, response.status, body);
    }
    return body as T;
  }

  private url(pathname: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${pathname}`;
  }
}

function parseResponseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
