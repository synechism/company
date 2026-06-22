export type UnipileClientOptions = {
  baseUrl: string;
  accessToken: string;
};

export type HostedAuthLinkOptions = {
  type?: "create" | "reconnect";
  providers?: string[] | "*";
  expiresOn?: string;
  name?: string;
  notifyUrl?: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  reconnectAccount?: string;
};

export type UnipileAccount = {
  id: string;
  name?: string;
  type?: string;
  connection_params?: {
    im?: {
      username?: string;
      publicIdentifier?: string;
      premiumFeatures?: string[];
    };
  };
  sources?: Array<{ id?: string; status?: string }>;
};

export type LinkedinSearchProfile = {
  id?: string;
  type?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  location?: string;
  public_identifier?: string;
  public_profile_url?: string;
  profile_url?: string;
  current_positions?: unknown[];
  current_company?: unknown;
  [key: string]: unknown;
};

export type LinkedinSearchResponse = {
  object?: string;
  items?: LinkedinSearchProfile[];
  cursor?: string;
  paging?: {
    start?: number;
    page_count?: number;
    total_count?: number;
  };
  [key: string]: unknown;
};

export type LinkedinSearchParameter = {
  object?: string;
  title?: string;
  id?: string;
  [key: string]: unknown;
};

export class UnipileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "UnipileApiError";
  }
}

export class UnipileClient {
  readonly baseUrl: string;

  constructor(private readonly options: UnipileClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
  }

  async createHostedAuthLink(options: HostedAuthLinkOptions = {}): Promise<string> {
    const expiresOn = options.expiresOn ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const body: Record<string, unknown> = {
      type: options.type ?? "create",
      providers: options.providers ?? ["LINKEDIN"],
      api_url: this.baseUrl,
      expiresOn,
    };

    if (options.name) body.name = options.name;
    if (options.notifyUrl) body.notify_url = options.notifyUrl;
    if (options.successRedirectUrl) body.success_redirect_url = options.successRedirectUrl;
    if (options.failureRedirectUrl) body.failure_redirect_url = options.failureRedirectUrl;
    if (options.reconnectAccount) body.reconnect_account = options.reconnectAccount;

    const response = await this.request<{ url?: string }>("/api/v1/hosted/accounts/link", {
      method: "POST",
      body,
    });
    if (!response.url) throw new Error("Unipile did not return a hosted auth URL");
    return response.url;
  }

  async listAccounts(): Promise<UnipileAccount[]> {
    const response = await this.request<{ items?: UnipileAccount[] }>("/api/v1/accounts", {
      query: { limit: 250 },
    });
    return response.items ?? [];
  }

  async resolveLinkedinAccountId(accountId?: string): Promise<string> {
    if (accountId) return accountId;

    const accounts = await this.listAccounts();
    const linkedinAccounts = accounts.filter((account) => account.type === "LINKEDIN");
    if (linkedinAccounts.length === 1) return linkedinAccounts[0].id;
    if (linkedinAccounts.length === 0) {
      throw new Error("No LinkedIn account is connected. Run `fcdx linkedin auth` first.");
    }

    throw new Error(
      "Multiple LinkedIn accounts are connected. Run `fcdx linkedin accounts` to inspect profiles, then `fcdx linkedin use-account --handle <handle>` to set the default for this local profile.",
    );
  }

  async searchLinkedinProfiles(options: {
    accountId: string;
    company: string;
    n: number;
    personTitle?: string;
    api?: "classic" | "sales_navigator" | "recruiter";
    companyIds?: string[];
  }): Promise<LinkedinSearchResponse> {
    const api = options.api ?? "classic";
    const body = buildLinkedinPeopleSearchBody(api, options.company, options.personTitle, options.companyIds);
    return this.request<LinkedinSearchResponse>("/api/v1/linkedin/search", {
      method: "POST",
      query: {
        account_id: options.accountId,
        limit: Math.min(options.n, api === "classic" ? 50 : 100),
      },
      body,
    });
  }

  async searchCompanyParameters(options: {
    accountId: string;
    keywords: string;
    service?: "CLASSIC" | "SALES_NAVIGATOR" | "RECRUITER";
    limit?: number;
  }): Promise<LinkedinSearchParameter[]> {
    const response = await this.request<{ items?: LinkedinSearchParameter[] }>("/api/v1/linkedin/search/parameters", {
      query: {
        account_id: options.accountId,
        type: "COMPANY",
        keywords: options.keywords,
        service: options.service ?? "CLASSIC",
        limit: options.limit ?? 10,
      },
    });
    return response.items ?? [];
  }

  private async request<T>(
    pathname: string,
    options: { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "X-API-KEY": this.options.accessToken,
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const raw = await response.text();
    const parsed = parseJson(raw);
    if (!response.ok) {
      throw new UnipileApiError(formatUnipileError(response.status, parsed), response.status, parsed);
    }

    return parsed as T;
  }
}

export function normalizeLinkedinProfileUrl(profile: LinkedinSearchProfile): string | undefined {
  if (profile.public_profile_url) return profile.public_profile_url;
  if (profile.public_identifier) return `https://www.linkedin.com/in/${profile.public_identifier}`;
  if (profile.profile_url?.includes("linkedin.com/in/")) return profile.profile_url;
  return profile.profile_url;
}

function buildLinkedinPeopleSearchBody(
  api: "classic" | "sales_navigator" | "recruiter",
  company: string,
  personTitle?: string,
  companyIds: string[] = [],
): Record<string, unknown> {
  if (api === "sales_navigator") {
    return {
      api,
      category: "people",
      keywords: personTitle ?? company,
      company: { include: companyIds.length > 0 ? companyIds : [company] },
      ...(personTitle ? { role: { include: [personTitle] } } : {}),
    };
  }

  if (api === "recruiter") {
    return {
      api,
      category: "people",
      keywords: personTitle ?? company,
      company: { include: companyIds.length > 0 ? companyIds : [company] },
      ...(personTitle ? { role: [{ keywords: personTitle, priority: "MUST_HAVE", scope: "CURRENT_OR_PAST" }] } : {}),
    };
  }

  const body: Record<string, unknown> = {
    api,
    category: "people",
    ...(personTitle ? { keywords: personTitle, advanced_keywords: { title: personTitle } } : {}),
  };
  if (companyIds.length > 0) body.company = companyIds;
  else body.advanced_keywords = { ...(body.advanced_keywords as object | undefined), company };
  return body;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function parseJson(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatUnipileError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : undefined;
    const title = typeof record.title === "string" ? record.title : undefined;
    return `Unipile HTTP ${status}${type ? ` ${type}` : ""}${title ? `: ${title}` : ""}`;
  }
  return `Unipile HTTP ${status}`;
}
