import type { FitAssessment, PageArtifact } from "./types.js";

const DATA_CENTER_SIGNALS = [
  "data center",
  "datacenter",
  "hyperscale",
  "colocation",
  "server room",
  "critical power",
  "power distribution unit",
  "pdu",
  "ups",
  "uninterruptible power",
  "switchgear",
  "busway",
  "busduct",
  "transformer",
  "generator",
  "battery backup",
  "thermal management",
  "liquid cooling",
  "crac",
  "crah",
  "chiller",
  "rack enclosure",
  "modular data center",
];

const CONTEXTUAL_DATA_CENTER_SIGNALS = [
  "mission critical",
  "critical facility",
  "critical facilities",
  "critical infrastructure",
];

const MANUFACTURING_SIGNALS = [
  "manufactur",
  "fabricat",
  "factory",
  "oem",
  "engineered products",
  "design and build",
  "custom equipment",
  "assembly",
  "production",
  "made in",
  "product line",
];

const WEAK_NEGATIVE_SIGNALS = [
  "consulting services",
  "staffing",
  "recruiting",
  "software platform",
  "marketing agency",
  "reseller",
  "distributor",
];

export function assessFit(pages: PageArtifact[]): FitAssessment {
  const combinedText = pages.map((page) => page.text).join("\n").toLowerCase();
  const dataCenterMatches = DATA_CENTER_SIGNALS.filter((signal) =>
    combinedText.includes(signal),
  );
  const contextualMatches = CONTEXTUAL_DATA_CENTER_SIGNALS.filter((signal) =>
    hasNearbyContext(combinedText, signal, ["data center", "datacenter", "power", "cooling", "electrical"], 180),
  );
  const manufacturingMatches = MANUFACTURING_SIGNALS.filter((signal) =>
    combinedText.includes(signal),
  );
  const negativeMatches = WEAK_NEGATIVE_SIGNALS.filter((signal) =>
    combinedText.includes(signal),
  );

  const score =
    (dataCenterMatches.length + contextualMatches.length) * 3 +
    manufacturingMatches.length * 2 -
    negativeMatches.length;

  const verdict =
    dataCenterMatches.length + contextualMatches.length > 0 && manufacturingMatches.length > 0
      ? "fit"
      : score >= 4
        ? "possible_fit"
        : "not_fit";

  const reasons = [
    `${dataCenterMatches.length + contextualMatches.length} data-center signal(s)`,
    `${manufacturingMatches.length} manufacturing signal(s)`,
  ];
  if (negativeMatches.length > 0) {
    reasons.push(`${negativeMatches.length} weak negative signal(s)`);
  }

  const matchedSignals = [
    ...dataCenterMatches.map((signal) => `dc:${signal}`),
    ...contextualMatches.map((signal) => `dc:${signal}`),
    ...manufacturingMatches.map((signal) => `mfg:${signal}`),
    ...negativeMatches.map((signal) => `neg:${signal}`),
  ];

  return {
    verdict,
    score,
    reasons,
    matchedSignals,
    snippets: buildSnippets(pages, [...dataCenterMatches, ...contextualMatches, ...manufacturingMatches]),
  };
}

function hasNearbyContext(
  text: string,
  signal: string,
  contextTerms: string[],
  radius: number,
): boolean {
  let index = text.indexOf(signal);
  while (index !== -1) {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + signal.length + radius);
    const window = text.slice(start, end);
    if (contextTerms.some((term) => window.includes(term))) return true;
    index = text.indexOf(signal, index + signal.length);
  }
  return false;
}

function buildSnippets(pages: PageArtifact[], signals: string[]): string[] {
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    for (const page of pages) {
      const lower = page.text.toLowerCase();
      const index = lower.indexOf(signal);
      if (index === -1) continue;

      const start = Math.max(0, index - 120);
      const end = Math.min(page.text.length, index + signal.length + 160);
      const snippet = page.text.slice(start, end).replace(/\s+/g, " ").trim();
      const key = snippet.toLowerCase();
      if (!seen.has(key)) {
        snippets.push(snippet);
        seen.add(key);
      }
      break;
    }

    if (snippets.length >= 5) break;
  }

  return snippets;
}
