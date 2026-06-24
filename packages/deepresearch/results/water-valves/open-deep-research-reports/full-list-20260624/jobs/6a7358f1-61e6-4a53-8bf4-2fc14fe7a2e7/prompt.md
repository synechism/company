# Manufacturing Outreach Deep Research Prompt

You are researching a manufacturing company so Cronwell can decide whether and how to reach out.

Cronwell helps manufacturers automate procurement workflows with agents. The best prospects are companies with real manufacturing operations, complex supplier bases, many SKUs or engineered parts, recent growth or operational change, and enough procurement complexity that automation could matter.

Research the company using recent public web sources, not only its website. Prioritize company pages, press releases, SEC filings if applicable, parent company pages, acquisition announcements, facility-expansion news, distributor/product catalogues, LinkedIn/company pages, trade publications, local business journals, and credible industry sources.

Answer these questions:

1. What does the company manufacture or sell? Include notable product lines, catalog breadth, and whether it appears to make valves, waterworks, flow-control, plumbing, or related industrial products.
2. What evidence exists that it owns or operates manufacturing facilities, assembly operations, engineering, or high-mix production?
3. What recent trigger events matter for outreach? Look for acquisitions, ownership changes, M&A activity, plant expansions, new facilities, hiring, new product lines, supply-chain pressure, certifications, or major customer/market moves.
4. Who is the best likely buyer or influencer for a procurement-automation pitch? Use the provided lead if present, but override it if public evidence suggests a better executive or role.
5. What personalized outreach angle should Cronwell use? Make it specific to the company’s current situation, not a generic procurement pitch.
6. What is the company's likely org chart around manufacturing, procurement, supply chain, operations, engineering, finance, and executive leadership? Reconstruct this as best as possible from public sources. Include parent-company reporting lines where relevant, mark inferred relationships clearly, and include confidence for each person or role.

Return only one concise report in English. The report must be valid JSON and must use this shape. Do not use Markdown, tables, emoji, Chinese text, or any prose outside the JSON object:

```json
{
  "company": "Company name",
  "fit_score": 1,
  "fit_reason": "Why this looks strong/weak for Cronwell",
  "manufacturing_profile": "Products, facilities, production complexity",
  "recent_triggers": [
    {
      "trigger": "Specific event or signal",
      "date": "YYYY-MM or unknown",
      "why_it_matters": "Procurement relevance",
      "source_url": "https://..."
    }
  ],
  "recommended_contact": {
    "name": "Best person if known",
    "title": "Role",
    "email": "Email if already provided or publicly available",
    "linkedin_url": "URL if known",
    "why_this_person": "Reason"
  },
  "org_chart": [
    {
      "name": "Person name or unknown",
      "title": "Title or inferred role",
      "function": "executive | procurement | supply_chain | operations | manufacturing | engineering | finance | parent_company | other",
      "reports_to": "Person/title if known or inferred",
      "relationship_basis": "Directly sourced, inferred from title, parent-company structure, job posting, etc.",
      "source_url": "https://...",
      "confidence": "high | medium | low"
    }
  ],
  "outreach_angle": "One short paragraph Cronwell could personalize from",
  "open_questions": ["Unknowns to verify"],
  "sources": [
    {
      "title": "Source title",
      "url": "https://...",
      "date": "YYYY-MM-DD or unknown"
    }
  ]
}
```

Use `fit_score` from 1 to 5:

- 5: clearly a strong manufacturing/procurement prospect with relevant recent trigger.
- 4: strong manufacturing fit, trigger or buyer likely but not fully confirmed.
- 3: plausible manufacturer, but procurement complexity or timing is uncertain.
- 2: weak fit or mainly distributor/service business.
- 1: not a relevant manufacturer or insufficient evidence.

## Company Input

```json
{
  "id": "egjXuCNqo8tWeqbj2l17mAPvKCIF",
  "name": "aquestia usa",
  "website": "controlvalves.com",
  "url": "https://controlvalves.com",
  "industry": "industrial automation",
  "size": "201-500",
  "country": "united states",
  "region": "oklahoma",
  "locality": "tulsa",
  "linkedin_url": "linkedin.com/company/aquestia-usa",
  "founded": 1942,
  "list_membership": {
    "source": "water-valves-shortlist",
    "reason": "From output/experiments/water-valves/shortlist.csv"
  },
  "tags": [],
  "list_fields": {
    "lead_candidate": {
      "name": "Mike Harker",
      "role": "Sr. Vice President of Quality Assurance & Manufacturing Engineering at OCV Control Valves",
      "linkedin_url": "https://www.linkedin.com/in/mike-harker-4a8b943b?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAAiKKsABQyiUe9Ol10xX-8OuHjpDUCkkCqA",
      "location": "Tulsa, OK",
      "selected_role_query": "manufacturing",
      "selection_score": 1100,
      "reason": "Operations/manufacturing leadership title; may influence procurement.",
      "selected_after_alternate_verified_email": true
    },
    "lead_email_status": {
      "selected_name": "Joshua Burton",
      "selected_role": "Procurement Management, with a Tech Cert. in Avionics, and a Bachelors in Business Administration.",
      "linkedin_url": "https://www.linkedin.com/in/joshua-burton-185a5a138?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAACGdkXUB1n7CGLCAr_1NaXUPVzgjI4ODGdw",
      "written": false,
      "reason": "Hunter HTTP 404: The profile associated with the provided LinkedIn handle does not exist in our database.\n{\n  \"errors\": [\n    {"
    },
    "leads": [
      {
        "first_name": "Mike",
        "last_name": "Harker",
        "full_name": "Mike Harker",
        "email": "mharker@controlvalves.com",
        "role": "Sr. Vice President of Quality Assurance & Manufacturing Engineering at OCV Control Valves",
        "company_id": "egjXuCNqo8tWeqbj2l17mAPvKCIF",
        "company_name": "aquestia usa",
        "domain": "controlvalves.com",
        "linkedin_url": "https://www.linkedin.com/in/mike-harker-4a8b943b?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAAiKKsABQyiUe9Ol10xX-8OuHjpDUCkkCqA",
        "source": "hunter:email-finder",
        "verification_status": "valid",
        "verifier_status": "valid",
        "verifier_result": "deliverable",
        "confidence": 1,
        "hunter": {
          "email_finder": {
            "score": 99,
            "domain": "controlvalves.com",
            "company": "OCV",
            "position": "Senior Vice President of Quality Assurance",
            "source_type": "found",
            "verification": {
              "date": "2026-05-26",
              "status": "valid"
            },
            "sources": [
              {
                "domain": "linkedin.com",
                "uri": "https://www.google.com/search?q=site:linkedin.com%20mike%20harker%20controlvalves",
                "extracted_on": "2025-01-09",
                "last_seen_on": "2026-06-11",
                "still_on_page": true
              }
            ]
          },
          "verifier": {
            "status": "valid",
            "score": 100,
            "email": "mharker@controlvalves.com",
            "regexp": true,
            "gibberish": false,
            "disposable": false,
            "webmail": false,
            "mx_records": true,
            "smtp_server": true,
            "smtp_check": true,
            "accept_all": false,
            "block": false,
            "sources": [
              {
                "domain": "linkedin.com",
                "uri": "https://www.google.com/search?q=site:linkedin.com%20mike%20harker%20controlvalves",
                "extracted_on": "2025-01-09",
                "last_seen_on": "2026-06-11",
                "still_on_page": true
              }
            ],
            "result": "deliverable",
            "_deprecation_notice": "Using result is deprecated, use status instead"
          }
        },
        "added_at": "2026-06-23T18:28:14.499Z"
      }
    ],
    "product_catalog_enrichment": {
      "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
      "custom_evaluation": {
        "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
        "answer": "yes",
        "confidence": 0.95,
        "reason": "The website clearly lists multiple product categories indicating a comprehensive product catalogue.",
        "evidence": [
          "Product categories include Air Valves, Hydraulic Control Valves, Back-flushing Valves, and more."
        ]
      },
      "company_summary": "Aquestia specializes in supplying hydraulic solutions, including a variety of valves, for sectors like waterworks, irrigation, fire protection, wastewater, mining, and buildings.",
      "target_alignment": {
        "schema_version": "procurement_manufacturing_v2",
        "score": 70,
        "priority": "medium",
        "manufacturing_fit": 80,
        "procurement_fit": 65,
        "category_fit": 40,
        "datacenter_fit": 30,
        "best_fit_categories": [
          "none"
        ],
        "reason": "The company has a strong manufacturing footprint and product diversity but lacks clear procurement complexity or a direct fit in high-priority PDF categories.",
        "positive_evidence": [
          "Established manufacturing facility in India.",
          "Diverse product offerings including valves and hydraulic controls."
        ],
        "negative_evidence": [
          "No evidence of substantial procurement complexity or specific PDF category alignment."
        ],
        "disqualifiers": [
          "No evidence of significant data center involvement."
        ]
      },
      "standard_questions": {
        "supplies_datacenters": {
          "answer": "no",
          "confidence": 0.8,
          "reason": "There is no indication that Aquestia specifically targets or supplies products for data centers.",
          "evidence": [
            "No mention of data center services or products on the website."
          ]
        },
        "manufacturing_or_factories": {
          "answer": "yes",
          "confidence": 0.9,
          "reason": "The website indicates that Aquestia has manufacturing facilities and offers a range of hydraulic products.",
          "evidence": [
            "Indicated expansion of a manufacturing facility in India."
          ]
        },
        "high_volume_or_high_mix": {
          "answer": "yes",
          "confidence": 0.85,
          "reason": "The product offerings include various types of valves and hydraulic components, indicating a high mix of manufactured items.",
          "evidence": [
            "Product categories include hydraulic control valves, air valves, and back-flushing valves."
          ]
        },
        "large_procurement_team": {
          "answer": "unknown",
          "confidence": 0.5,
          "reason": "While the company likely engages in procurement, specific evidence of a procurement team is not provided on the website.",
          "evidence": [
            "No explicit mention of procurement team or complexity in purchasing."
          ]
        },
        "turnkey_contract_manufacturer": {
          "answer": "no",
          "confidence": 0.7,
          "reason": "The company appears to manufacture products but does not provide end-to-end turnkey manufacturing services for clients.",
          "evidence": [
            "Focus on selling hydraulic solutions rather than being a full-service manufacturer."
          ]
        }
      },
      "final_notes": "Further details on the procurement and complexity of supply chain operations could not be verified from the provided page, potentially limiting overall assessment.",
      "agent_metadata": {
        "backend": "firecrawl_scrape_json",
        "url": "https://controlvalves.com",
        "final_url": "https://controlvalves.com",
        "title": "Aquestia | Optimize Your Hydraulic System",
        "elapsed_ms": 27036,
        "raw_output_path": "output/experiments/water-valves/raw/egjxucnqo8tweqbj2l17mapvkcif.enrichment.json",
        "cache_dir": "output/cache/firecrawl/egjxucnqo8tweqbj2l17mapvkcif",
        "crawl_cache_hit": false
      }
    }
  }
}
```
