import type { CompanyEnrichment, EnrichmentAnswer, EnrichmentQuestionKey, TargetAlignment } from "../types.js";

export const TARGET_ALIGNMENT_SCHEMA_VERSION = "procurement_manufacturing_v2";

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

const customEvaluationSchema = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "The custom experiment question that was answered.",
    },
    ...answerSchema.properties,
  },
  required: ["question", "answer", "confidence", "reason", "evidence"],
  additionalProperties: false,
} as const;

const targetAlignmentSchema = {
  type: "object",
  properties: {
    schema_version: {
      type: "string",
      enum: [TARGET_ALIGNMENT_SCHEMA_VERSION],
      description: "Target-alignment rubric version used for this judgment.",
    },
    score: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description:
        "Final weighted fit score from 0 to 100, after applying the rubric and caps. It should be close to the weighted average of the independent sub-scores.",
    },
    priority: {
      type: "string",
      enum: ["high", "medium", "low", "not_relevant"],
      description: "Recommended research/sales priority based on the target profile.",
    },
    manufacturing_fit: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description:
        "Independent 0-100 rating, not weighted points. Measures how strongly the company appears to manufacture, fabricate, assemble, integrate, or operate production/factory/shop-floor workflows.",
    },
    procurement_fit: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description:
        "Independent 0-100 rating, not weighted points. Measures likely procurement complexity: purchased parts/materials, supplier base, sourcing, quoting, production purchasing, ERP/MRP, multi-site operations, or supply-chain teams.",
    },
    category_fit: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "Independent 0-100 rating, not weighted points. Measures how well the company fits one or more PDF target categories.",
    },
    datacenter_fit: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description:
        "Independent 0-100 rating, not weighted points. Measures how clearly the company serves data centers, critical infrastructure, or adjacent mission-critical/industrial markets. This is a secondary signal.",
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
      description:
        "One or more PDF target categories that best match the company. Use none only when no category fits; never combine none with real categories.",
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
    disqualifiers: {
      type: "array",
      items: { type: "string" },
      description:
        "Reasons to de-prioritize, especially no manufacturing/fabrication/assembly evidence, no procurement complexity, purely services/consulting/residential, or only data-center exposure with no manufacturer buyer profile.",
    },
  },
  required: [
    "schema_version",
    "score",
    "priority",
    "manufacturing_fit",
    "procurement_fit",
    "category_fit",
    "datacenter_fit",
    "best_fit_categories",
    "reason",
    "positive_evidence",
    "negative_evidence",
    "disqualifiers",
  ],
  additionalProperties: false,
} as const;

export const enrichmentSchema = buildEnrichmentSchema();

export function buildEnrichmentSchema(options: { customQuestion?: string } = {}): Record<string, unknown> {
  const properties: Record<string, unknown> = {
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
  };
  const required = [
    "company_summary",
    "supplies_datacenters",
    "manufacturing_or_factories",
    "high_volume_or_high_mix",
    "large_procurement_team",
    "turnkey_contract_manufacturer",
    "target_alignment",
    "final_notes",
  ];
  if (options.customQuestion) {
    properties.custom_evaluation = customEvaluationSchema;
    required.splice(1, 0, "custom_evaluation");
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function buildEnrichmentPrompt(companyName: string, customQuestion?: string): string {
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
${customQuestion ? `\nAlso answer custom_evaluation for this experiment-specific question:\n${customQuestion}\n\nFor custom_evaluation, use yes only when the website evidence supports the answer; use no when the website contradicts or clearly does not fit; use unknown when the page does not provide enough evidence. Set custom_evaluation.question exactly to the experiment-specific question above.` : ""}

Then score target_alignment for this specific target profile.

Cronwell context:
- Cronwell sells AI procurement automation to mid-market manufacturers.
- The ideal buyer is a manufacturer, fabricator, assembler, industrial contractor with significant material purchasing, or contract manufacturer with complex purchased parts/materials and supplier workflows.
- Data-center exposure is useful only because the PDF categories identify markets with heavy manufacturing/procurement needs. Do not over-rank a company merely because it serves data centers.

Primary target profile:
- The company should have manufacturing, fabrication, assembly, integration, production, factory, shop-floor, field-installation-with-materials, or complex industrial operations.
- The company should plausibly have meaningful procurement complexity: many purchased parts/SKUs, raw materials, electrical/mechanical components, supplier quoting, sourcing, supply-chain teams, project purchasing, ERP/MRP, or multi-site operations.
- The company should fit one or more PDF categories.

PDF target categories:
- Highest priority categories: switchgear, transformers, busway, electrical contractors, mechanical contractors, structural steel, precast concrete, site development, and other equipment-heavy infrastructure providers.
- Strong additional categories: generators, backup power, battery energy storage, fuel cells, microgrids, cooling, thermal management, modular construction, MEP engineering, commissioning, and industrialized construction.
- Useful lower-priority categories: cabling/connectivity, racks/enclosures/containment, building management/DCIM, fire suppression, and physical security, but only when they look like manufacturers/integrators with procurement complexity.
- Do not infer a PDF category from the broad PDL industry name alone. For example, electronics manufacturing or PCB assembly is not automatically an electrical contractor, MEP firm, switchgear company, or modular construction company.
- If the company is a strong manufacturer/procurement fit but does not clearly match a PDF category, use best_fit_categories ["none"] and give category_fit below 40.

Sub-score rubric:
- Each fit sub-score is an independent 0-100 rating, not weighted points. Do not make the four sub-scores add up to 100.
- manufacturing_fit: 90-100 means clear factory/manufacturing/contract-manufacturing footprint; 70-89 means strong fabrication/assembly/integration/industrial operations; 40-69 means possible but indirect; below 40 means little evidence.
- procurement_fit: 90-100 means obvious complex purchasing/supply-chain operations; 70-89 means strong inferred material/supplier complexity; 40-69 means possible; below 40 means weak evidence.
- category_fit: 90-100 means direct fit to a highest-priority PDF category; 70-89 strong fit; 40-69 adjacent or lower-priority category; below 40 weak/no category fit.
- datacenter_fit: 90-100 means explicit data-center focus; 70-89 strong critical-infrastructure/mission-critical fit; 40-69 adjacent industrial/cloud/advanced-computing fit; below 40 weak/no evidence.

Final scoring rubric:
- Compute final score approximately as: 35% manufacturing_fit + 35% procurement_fit + 20% category_fit + 10% datacenter_fit, then apply the caps and guardrails below.
- Do not let data-center relevance overpower weak manufacturing or procurement evidence.
- 85-100: clear manufacturer/fabricator/assembler/industrial contractor, strong procurement complexity, and strong PDF category fit.
- 70-84: likely manufacturer/procurement-heavy company with good category fit, but one signal is weaker or inferential.
- 50-69: possible fit; some manufacturing/procurement/category evidence but incomplete or indirect.
- 20-49: weak fit; mostly service, distributor, residential/local contractor, software/consulting, or weak procurement complexity.
- 0-19: not relevant.

Score caps and guardrails:
- If manufacturing_or_factories is "no" and there is no fabrication/assembly/integration/industrial project purchasing evidence, cap final score at 45.
- If manufacturing_or_factories is "unknown", cap final score at 65 unless there is strong evidence of industrial contracting with substantial material procurement.
- If large_procurement_team is "no" or procurement complexity is weak, cap final score at 70.
- If the company only has data-center exposure but no manufacturing/procurement buyer profile, cap final score at 55.
- Generic consultants, software-only firms, staffing firms, real estate firms, purely residential/local contractors, and simple distributors/resellers should usually be low or not_relevant.

Important rules:
- This is enrichment, not filtering. Do not reject or rank the company.
- For each question return answer yes/no/unknown, confidence, reason, and evidence.
- For target_alignment, do rank the company against the target profile on a 0-100 scale.
- target_alignment.schema_version must be "${TARGET_ALIGNMENT_SCHEMA_VERSION}".
- In target_alignment.best_fit_categories, use "none" only by itself. Do not include "none" alongside real categories.
- Use "unknown" when the website page does not explicitly provide enough evidence.
- Large procurement team is usually inferential; use yes only when there are strong signals like many facilities, large-scale operations, global sourcing, supplier portals, procurement careers, extensive manufacturing footprint, or explicit procurement/supply-chain language.
- Turnkey contract manufacturer means end-to-end outsourced manufacturing for customers, not just construction, consulting, distribution, installation, or selling own products.
- Keep evidence snippets short and factual.
`.trim();
}

export function emptyEnrichment(error: string, customQuestion?: string): CompanyEnrichment {
  const answer: EnrichmentAnswer = {
    answer: "unknown",
    confidence: 0,
    reason: error,
    evidence: [],
  };
  const targetAlignment: TargetAlignment = {
    schema_version: TARGET_ALIGNMENT_SCHEMA_VERSION,
    score: 0,
    priority: "not_relevant",
    manufacturing_fit: 0,
    procurement_fit: 0,
    category_fit: 0,
    datacenter_fit: 0,
    best_fit_categories: ["none"],
    reason: error,
    positive_evidence: [],
    negative_evidence: [],
    disqualifiers: [error],
  };
  const enrichment: CompanyEnrichment = {
    company_summary: "",
    supplies_datacenters: answer,
    manufacturing_or_factories: answer,
    high_volume_or_high_mix: answer,
    large_procurement_team: answer,
    turnkey_contract_manufacturer: answer,
    target_alignment: targetAlignment,
    final_notes: error,
  };
  if (customQuestion) {
    enrichment.custom_evaluation = {
      question: customQuestion,
      ...answer,
    };
  }
  return enrichment;
}
