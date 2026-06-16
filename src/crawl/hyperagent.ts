import { Hyperbrowser } from "@hyperbrowser/sdk";
import type { HyperAgentLlm } from "@hyperbrowser/sdk/types";
import type { CandidateCompany } from "../types.js";

export type HyperAgentCompanyVerdict = {
  company: CandidateCompany;
  status: string;
  liveUrl: string | null;
  elapsedMs: number;
  steps?: number | null;
  finalResult: string | null;
  parsed?: unknown;
  error?: string | null;
};

export type HyperAgentOptions = {
  apiKey: string;
  llm: HyperAgentLlm;
  maxSteps: number;
  maxWaitForSlotMs: number;
  slotPollMs: number;
};

export async function runHyperAgentVerdict(
  company: CandidateCompany,
  options: HyperAgentOptions,
): Promise<HyperAgentCompanyVerdict> {
  const client = new Hyperbrowser({ apiKey: options.apiKey });
  const started = Date.now();

  try {
    await waitForActiveSessionSlot(client, options.maxWaitForSlotMs, options.slotPollMs);
    const result = await client.agents.hyperAgent.startAndWait({
      version: "1.1.0",
      llm: options.llm,
      maxSteps: options.maxSteps,
      enableVisualMode: true,
      sessionOptions: {
        acceptCookies: true,
        timeoutMinutes: 3,
      },
      task: buildTask(company),
    });

    const finalResult = result.data?.finalResult ?? null;
    return {
      company,
      status: result.status,
      liveUrl: result.liveUrl,
      elapsedMs: Date.now() - started,
      steps: result.metadata?.numTaskStepsCompleted ?? result.data?.steps?.length ?? null,
      finalResult,
      parsed: parseJsonFromText(finalResult),
      error: result.error ?? null,
    };
  } catch (error) {
    return {
      company,
      status: "failed",
      liveUrl: null,
      elapsedMs: Date.now() - started,
      finalResult: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForActiveSessionSlot(
  client: Hyperbrowser,
  maxWaitMs: number,
  pollMs: number,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;

  while (true) {
    const active = await client.sessions
      .getActiveSessionsCount()
      .then((response) => response.activeSessionsCount)
      .catch(() => 0);
    if (active === 0) return;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function buildTask(company: CandidateCompany): string {
  return `
Visit ${company.url} for company "${company.name}".

Goal: determine whether this company manufactures physical equipment, components,
systems, or engineered products that serve the data center sector.

Use the website itself. Check the homepage and, when available, pages such as
Products, Solutions, Industries, Markets, About, Data Center, Critical Power,
Cooling, Thermal Management, Switchgear, UPS, PDU, Busway, Enclosures, or
Manufacturing. Do not infer fit from LinkedIn industry alone.

Return only compact JSON with this schema:
{
  "verdict": "fit" | "possible_fit" | "not_fit",
  "confidence": 0.0,
  "is_manufacturer": true,
  "serves_data_centers": true,
  "equipment_categories": ["short category"],
  "evidence": ["short website evidence"],
  "pages_checked": ["url"],
  "reasoning": "one concise sentence"
}
`.trim();
}

function parseJsonFromText(text: string | null): unknown {
  if (!text) return undefined;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}
