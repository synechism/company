import type { CandidateCompany, DatasetCompanyRow } from "../types.js";

export function candidateToDatasetRow(company: CandidateCompany): DatasetCompanyRow {
  return {
    country: company.country,
    founded: company.founded ?? null,
    id: company.id,
    industry: company.industry,
    linkedin_url: company.linkedinUrl ?? null,
    locality: company.locality ?? null,
    name: company.name,
    region: company.region ?? null,
    size: company.size,
    website: company.website,
  };
}
