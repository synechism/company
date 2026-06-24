export type HunterClientOptions = {
  apiKey: string;
  baseUrl?: string;
};

export type HunterSource = {
  domain?: string;
  uri?: string;
  extracted_on?: string;
  last_seen_on?: string;
  still_on_page?: boolean;
};

export type HunterEmailFinderData = {
  first_name?: string;
  last_name?: string;
  email?: string;
  score?: number;
  domain?: string;
  accept_all?: boolean;
  position?: string;
  twitter?: string | null;
  linkedin_url?: string | null;
  phone_number?: string | null;
  company?: string;
  source_type?: string;
  sources?: HunterSource[];
  verification?: {
    date?: string;
    status?: "valid" | "accept_all" | "unknown" | string;
  };
};

export type HunterEmailFinderResponse = {
  data?: HunterEmailFinderData;
  meta?: unknown;
};

export type HunterDomainSearchEmail = {
  value?: string;
  type?: string;
  confidence?: number;
  sources?: HunterSource[];
  first_name?: string;
  last_name?: string;
  position?: string | null;
  seniority?: string | null;
  department?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  phone_number?: string | null;
  verification?: {
    date?: string;
    status?: "valid" | "accept_all" | "unknown" | string;
  };
};

export type HunterDomainSearchData = {
  domain?: string;
  organization?: string;
  accept_all?: boolean;
  pattern?: string | null;
  emails?: HunterDomainSearchEmail[];
};

export type HunterDomainSearchResponse = {
  data?: HunterDomainSearchData;
  meta?: unknown;
};

export type HunterEmailVerifierData = {
  status?: "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown" | string;
  result?: "deliverable" | "undeliverable" | "risky" | string;
  score?: number;
  email?: string;
  regexp?: boolean;
  gibberish?: boolean;
  disposable?: boolean;
  webmail?: boolean;
  mx_records?: boolean;
  smtp_server?: boolean;
  smtp_check?: boolean;
  accept_all?: boolean;
  block?: boolean;
  sources?: HunterSource[];
};

export type HunterEmailVerifierResponse = {
  data?: HunterEmailVerifierData;
  meta?: unknown;
};

export class HunterApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "HunterApiError";
  }
}

export class HunterClient {
  private readonly baseUrl: string;

  constructor(private readonly options: HunterClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.hunter.io/v2").replace(/\/+$/, "");
  }

  async findEmail(options: {
    domain?: string;
    company?: string;
    linkedinHandle?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    maxDuration?: number;
  }): Promise<HunterEmailFinderResponse> {
    return this.request<HunterEmailFinderResponse>("/email-finder", {
      domain: options.domain,
      company: options.company,
      linkedin_handle: options.linkedinHandle,
      first_name: options.firstName,
      last_name: options.lastName,
      full_name: options.fullName,
      max_duration: options.maxDuration,
    });
  }

  async domainSearch(options: {
    domain?: string;
    company?: string;
    limit?: number;
    offset?: number;
    type?: "personal" | "generic";
    seniority?: string;
    department?: string;
  }): Promise<HunterDomainSearchResponse> {
    return this.request<HunterDomainSearchResponse>("/domain-search", {
      domain: options.domain,
      company: options.company,
      limit: options.limit,
      offset: options.offset,
      type: options.type,
      seniority: options.seniority,
      department: options.department,
    });
  }

  async verifyEmail(email: string, options: { maxPolls?: number; pollDelayMs?: number } = {}): Promise<HunterEmailVerifierResponse> {
    const maxPolls = options.maxPolls ?? 3;
    const pollDelayMs = options.pollDelayMs ?? 3000;
    for (let attempt = 0; attempt <= maxPolls; attempt += 1) {
      const response = await this.request<HunterEmailVerifierResponse>("/email-verifier", { email }, { allow202: true });
      if ((response as { __httpStatus?: number }).__httpStatus !== 202) return response;
      if (attempt < maxPolls) await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
    return this.request<HunterEmailVerifierResponse>("/email-verifier", { email }, { allow202: true });
  }

  private async request<T>(
    pathname: string,
    query: Record<string, string | number | undefined>,
    options: { allow202?: boolean } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    url.searchParams.set("api_key", this.options.apiKey);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    const raw = await response.text();
    const parsed = parseJson(raw);
    if (!response.ok && !(options.allow202 && response.status === 202)) {
      throw new HunterApiError(formatHunterError(response.status, parsed), response.status, parsed);
    }
    if (options.allow202 && response.status === 202 && parsed && typeof parsed === "object") {
      return { ...(parsed as object), __httpStatus: 202 } as T;
    }
    return parsed as T;
  }
}

export function linkedinHandleFromUrl(linkedinUrl?: string): string | undefined {
  if (!linkedinUrl) return undefined;
  try {
    const url = new URL(linkedinUrl.startsWith("http") ? linkedinUrl : `https://${linkedinUrl}`);
    const match = url.pathname.match(/\/in\/([^/?#]+)/i);
    return match?.[1];
  } catch {
    const match = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
    return match?.[1];
  }
}

function parseJson(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatHunterError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const errors = record.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as Record<string, unknown>;
      const code = typeof first.code === "string" ? first.code : undefined;
      const details = typeof first.details === "string" ? first.details : undefined;
      return `Hunter HTTP ${status}${code ? ` ${code}` : ""}${details ? `: ${details}` : ""}`;
    }
  }
  return `Hunter HTTP ${status}`;
}
