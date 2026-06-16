const RELEVANT_PATH_PARTS = [
  "about",
  "company",
  "product",
  "products",
  "solution",
  "solutions",
  "industries",
  "industry",
  "markets",
  "market",
  "data-center",
  "datacenter",
  "critical",
  "power",
  "cooling",
  "thermal",
  "manufacturing",
  "equipment",
  "electrical",
  "mechanical",
];

export function chooseRelevantLinks(
  rootUrl: string,
  hrefs: string[],
  limit: number,
): string[] {
  const root = new URL(rootUrl);
  const chosen: string[] = [];
  const seen = new Set<string>([normalizeUrl(rootUrl)]);

  for (const href of hrefs) {
    let parsed: URL;
    try {
      parsed = new URL(href, rootUrl);
    } catch {
      continue;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) continue;
    if (!sameRegistrableHost(root.hostname, parsed.hostname)) continue;

    parsed.hash = "";
    const normalized = normalizeUrl(parsed.toString());
    if (seen.has(normalized)) continue;

    const haystack = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    if (!RELEVANT_PATH_PARTS.some((part) => haystack.includes(part))) continue;

    seen.add(normalized);
    chosen.push(normalized);
    if (chosen.length >= limit) break;
  }

  return chosen;
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function sameRegistrableHost(a: string, b: string): boolean {
  if (a === b) return true;
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}
