import type { CandidateCompany, CompanyRecord } from "../types.js";
import { TARGET_INDUSTRIES, selectedSizeBuckets } from "../config.js";
import { clean, cleanLower, normalizeWebsite } from "./csv.js";

export type CandidateOptions = {
  include51200: boolean;
  requireWebsite: boolean;
};

export function isTargetCandidate(
  record: CompanyRecord,
  options: CandidateOptions,
): boolean {
  const country = cleanLower(record.country);
  const industry = cleanLower(record.industry);
  const size = clean(record.size);
  const website = clean(record.website);
  const sizeBuckets = selectedSizeBuckets(options.include51200);

  return (
    country === "united states" &&
    TARGET_INDUSTRIES.has(industry) &&
    sizeBuckets.has(size) &&
    (!options.requireWebsite || website.length > 0)
  );
}

export function toCandidate(record: CompanyRecord): CandidateCompany | null {
  const id = clean(record.id);
  const name = clean(record.name);
  const website = clean(record.website);
  const url = normalizeWebsite(website);

  if (!id || !name || !website || !url) return null;

  const foundedRaw = Number.parseInt(clean(record.founded), 10);

  return {
    id,
    name,
    website,
    url,
    industry: cleanLower(record.industry),
    size: clean(record.size),
    country: cleanLower(record.country),
    region: cleanLower(record.region) || undefined,
    locality: cleanLower(record.locality) || undefined,
    linkedinUrl: clean(record.linkedin_url) || undefined,
    founded: Number.isFinite(foundedRaw) ? foundedRaw : undefined,
  };
}
