import type { CompanyEnrichment, EnrichmentAnswer, EnrichmentQuestionKey, TargetAlignment } from "../types.js";

export const ENRICHMENT_QUESTIONS: Record<EnrichmentQuestionKey, string> = {
  supplies_datacenters:
    "Does this company supply data centers or participate in data center buildout?",
  manufacturing_or_factories:
    "Does this company do manufacturing or own/operate factories?",
  high_volume_or_high_mix:
    "Does this company do high-volume manufacturing or high-mix manufacturing involving many parts/SKUs/configurations?",
  large_procurement_team:
    "Does this company appear likely to have a large procurement or sourcing team?",
  turnkey_contract_manufacturer:
    "Is this company a turnkey end-to-end contract manufacturer?",
};

const answerSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes only when supported by page evidence. Use no when contradicted or clearly not applicable. Use unknown when the page does not provide enough evidence.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence in the answer from 0 to 1.",
    },
    reason: {
      type: "string",
      description: "One concise explanation grounded in website evidence.",
    },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "Short evidence snippets or page claims used for the answer.",
    },
  },
  required: ["answer", "confidence", "reason", "evidence"],
  additionalProperties: false,
} as const;

const targetAlignmentSchema = {
  type: "object",
  properties: {
    score: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description:
        "Overall fit score from 0 to 100 for the target profile. 90+ is an obvious fit, 70-89 is strong, 50-69 is possible, below 50 is weak.",
    },
    priority: {
      type: "string",
      enum: ["high", "medium", "low", "not_relevant"],
      description: "Recommended research/sales priority based on the target profile.",
    },
    best_fit_categories: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "switchgear_transformers_busway",
          "electrical_mechanical_contractors",
          "structural_steel_precast_sitework",
          "generators_backup_power_bess_fuel_cells_microgrids",
          "cooling_thermal_management",
          "modular_construction_gc_mep_commissioning",
          "cabling_connectivity",
          "racks_enclosures_containment",
          "building_management_dcim",
          "fire_suppression",
          "physical_security",
          "none",
        ],
      },
      description: "One or more PDF target categories that best match the company, or none.",
    },
    reason: {
      type: "string",
      description:
        "A concise explanation of why the company is or is not aligned with the PDF target profile, grounded in website evidence.",
    },
    positive_evidence: {
      type: "array",
      items: { type: "string" },
      description: "Short evidence snippets supporting target fit.",
    },
    negative_evidence: {
      type: "array",
      items: { type: "string" },
      description: "Short evidence snippets or caveats weakening target fit.",
    },
  },
  required: [
    "score",
    "priority",
    "best_fit_categories",
    "reason",
    "positive_evidence",
    "negative_evidence",
  ],
  additionalProperties: false,
} as const;

export const enrichmentSchema = {
  type: "object",
  properties: {
    company_summary: {
      type: "string",
      description: "A concise factual summary of what the company does based on the website.",
    },
    supplies_datacenters: answerSchema,
    manufacturing_or_factories: answerSchema,
    high_volume_or_high_mix: answerSchema,
    large_procurement_team: answerSchema,
    turnkey_contract_manufacturer: answerSchema,
    target_alignment: targetAlignmentSchema,
    final_notes: {
      type: "string",
      description: "Any caveats, missing evidence, or notes about pages that should be checked manually.",
    },
  },
  required: [
    "company_summary",
    "supplies_datacenters",
    "manufacturing_or_factories",
    "high_volume_or_high_mix",
    "large_procurement_team",
    "turnkey_contract_manufacturer",
    "target_alignment",
    "final_notes",
  ],
  additionalProperties: false,
};

export function buildEnrichmentPrompt(companyName: string): string {
  return `
You are enriching a company dataset for procurement/business-development research.
Use only evidence available on the company website page being scraped.

Company: ${companyName}

Answer these five questions independently:
1. ${ENRICHMENT_QUESTIONS.supplies_datacenters}
2. ${ENRICHMENT_QUESTIONS.manufacturing_or_factories}
3. ${ENRICHMENT_QUESTIONS.high_volume_or_high_mix}
4. ${ENRICHMENT_QUESTIONS.large_procurement_team}
5. ${ENRICHMENT_QUESTIONS.turnkey_contract_manufacturer}

Then score target_alignment for this specific target profile:
- We are looking for US mid-market companies that are meaningfully involved in data center buildout or the supply chain for data center equipment/infrastructure.
- Highest priority categories: switchgear, transformers, busway, electrical contractors, mechanical contractors, structural steel, precast concrete, and site development.
- Strong additional categories: generators, backup power, battery energy storage, fuel cells, microgrids, cooling, thermal management, modular data center construction, general contractors, MEP engineering, and commissioning.
- Useful lower-priority categories: cabling/connectivity, racks/enclosures/containment, building management/DCIM, fire suppression, and physical security.
- Prefer companies that manufacture equipment, own factories, do high-volume/high-mix production, manage complex procurement/sourcing, or provide turnkey contract manufacturing.
- Penalize generic consultants, purely residential/local contractors, distributors/resellers with no manufacturing or buildout role, unrelated electronics/software firms, and companies with no evidence of data center or critical infrastructure relevance.

Important rules:
- This is enrichment, not filtering. Do not reject or rank the company.
- For each question return answer yes/no/unknown, confidence, reason, and evidence.
- For target_alignment, do rank the company against the target profile on a 0-100 scale.
- Use "unknown" when the website page does not explicitly provide enough evidence.
- Large procurement team is usually inferential; use yes only when there are strong signals like many facilities, large-scale operations, global sourcing, supplier portals, procurement careers, extensive manufacturing footprint, or explicit procurement/supply-chain language.
- Turnkey contract manufacturer means end-to-end outsourced manufacturing for customers, not just construction, consulting, distribution, installation, or selling own products.
- Keep evidence snippets short and factual.
`.trim();
}

export function emptyEnrichment(error: string): CompanyEnrichment {
  const answer: EnrichmentAnswer = {
    answer: "unknown",
    confidence: 0,
    reason: error,
    evidence: [],
  };
  const targetAlignment: TargetAlignment = {
    score: 0,
    priority: "not_relevant",
    best_fit_categories: ["none"],
    reason: error,
    positive_evidence: [],
    negative_evidence: [],
  };
  return {
    company_summary: "",
    supplies_datacenters: answer,
    manufacturing_or_factories: answer,
    high_volume_or_high_mix: answer,
    large_procurement_team: answer,
    turnkey_contract_manufacturer: answer,
    target_alignment: targetAlignment,
    final_notes: error,
  };
}
