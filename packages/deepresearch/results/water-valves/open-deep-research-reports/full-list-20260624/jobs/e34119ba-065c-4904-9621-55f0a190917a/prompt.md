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
  "id": "mQjRE7j2TC5bW90Jwiy08wckzZAG",
  "name": "a.y. mcdonald mfg. co.",
  "website": "aymcdonald.com",
  "url": "https://aymcdonald.com",
  "industry": "utilities",
  "size": "501-1000",
  "country": "united states",
  "region": "iowa",
  "locality": "dubuque",
  "linkedin_url": "linkedin.com/company/a-y-mcdonald-mfg-co-",
  "founded": 1856,
  "list_membership": {
    "source": "water-valves-shortlist",
    "reason": "From output/experiments/water-valves/shortlist.csv"
  },
  "tags": [],
  "list_fields": {
    "lead_candidate": {
      "name": "Leanne Teasdale",
      "role": "Procurement Specialist at A.Y. McDonald Mfg. Co.",
      "linkedin_url": "https://www.linkedin.com/in/leanne-teasdale-40014112?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAAKC-QABbBsRO9492E8xlnHr1cqBJn-kjyI",
      "location": "Dubuque, IA",
      "selected_role_query": "procurement",
      "selection_score": 1450,
      "reason": "Procurement or supply-chain title.",
      "alternatives": [
        {
          "name": "LinkedIn Member",
          "role": "Director of Strategic Sourcing - AY McDonald Industries",
          "linkedin_url": null,
          "score": 1450
        },
        {
          "name": "LinkedIn Member",
          "role": "Procurement Specialist at A.Y. McDonald Mfg. Co.",
          "linkedin_url": null,
          "score": 1350
        },
        {
          "name": "LinkedIn Member",
          "role": "Purchasing Manager at A.Y. McDonald Mfg. Co.",
          "linkedin_url": null,
          "score": 1250
        }
      ]
    },
    "leads": [
      {
        "first_name": "Leanne",
        "last_name": "Teasdale",
        "full_name": "Leanne Teasdale",
        "email": "lteasdale@aymcdonald.com",
        "role": "Procurement Specialist at A.Y. McDonald Mfg. Co.",
        "company_id": "mQjRE7j2TC5bW90Jwiy08wckzZAG",
        "company_name": "a.y. mcdonald mfg. co.",
        "domain": "aymcdonald.com",
        "linkedin_url": "https://www.linkedin.com/in/leanne-teasdale-40014112?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAAKC-QABbBsRO9492E8xlnHr1cqBJn-kjyI",
        "source": "hunter:email-finder",
        "verification_status": "valid",
        "verifier_status": "valid",
        "verifier_result": "deliverable",
        "confidence": 1,
        "hunter": {
          "email_finder": {
            "score": 97,
            "domain": "aymcdonald.com",
            "company": "A.Y. McDonald",
            "position": "Procurement Specialist",
            "source_type": "found",
            "verification": {
              "date": "2026-06-23",
              "status": "valid"
            },
            "sources": [
              {
                "domain": "linkedin.com",
                "uri": "https://www.google.com/search?q=site:linkedin.com%20leanne%20teasdale%20aymcdonald",
                "extracted_on": "2026-01-26",
                "last_seen_on": "2026-06-07",
                "still_on_page": true
              }
            ]
          },
          "verifier": {
            "status": "valid",
            "score": 100,
            "email": "lteasdale@aymcdonald.com",
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
                "uri": "https://www.google.com/search?q=site:linkedin.com%20leanne%20teasdale%20aymcdonald",
                "extracted_on": "2026-01-26",
                "last_seen_on": "2026-06-07",
                "still_on_page": true
              }
            ],
            "result": "deliverable",
            "_deprecation_notice": "Using result is deprecated, use status instead"
          }
        },
        "added_at": "2026-06-23T18:28:12.358Z"
      }
    ],
    "product_catalog_enrichment": {
      "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
      "custom_evaluation": {
        "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
        "answer": "yes",
        "confidence": 1,
        "reason": "The website clearly details various product families including valves, fittings, waterworks, and plumbing products.",
        "evidence": [
          "Extensive catalog available on various product types",
          "Specific categories listed for waterworks, plumbing, and natural gas."
        ]
      },
      "company_summary": "A.Y. McDonald Manufacturing Company specializes in providing a variety of quality products for waterworks, plumbing, and natural gas industries, including valves, hydrants, fittings, and accessories.",
      "target_alignment": {
        "schema_version": "procurement_manufacturing_v2",
        "score": 70,
        "priority": "medium",
        "manufacturing_fit": 85,
        "procurement_fit": 60,
        "category_fit": 40,
        "datacenter_fit": 30,
        "best_fit_categories": [
          "none"
        ],
        "reason": "Company has a solid manufacturing capability and experience in waterworks and plumbing, but lacks explicit alignment with targeted PDF categories related to complex manufacturing or procurement needs.",
        "positive_evidence": [
          "Diverse and extensive product catalog for plumbing and waterworks",
          "Defined manufacturing and production presence"
        ],
        "negative_evidence": [
          "No clear procurement processes or information regarding team complexity",
          "Limited presence in critical infrastructure or data center category"
        ],
        "disqualifiers": []
      },
      "standard_questions": {
        "supplies_datacenters": {
          "answer": "no",
          "confidence": 0.9,
          "reason": "The company focuses on waterworks and plumbing products, showing no evidence of supplying or participating in data center buildout.",
          "evidence": [
            "No mention of data centers in product categories",
            "Focus on plumbing, natural gas, and waterworks products"
          ]
        },
        "manufacturing_or_factories": {
          "answer": "yes",
          "confidence": 1,
          "reason": "The company operates in manufacturing products for plumbing and waterworks, indicating a manufacturing presence.",
          "evidence": [
            "Production of valves, fittings, and waterworks products",
            "Defined manufacturing activities on the website"
          ]
        },
        "high_volume_or_high_mix": {
          "answer": "yes",
          "confidence": 0.8,
          "reason": "The company produces a wide range of products suggesting a high-mix manufacturing model involving various types of fittings, valves, and hydrants.",
          "evidence": [
            "Large catalog of varied plumbing and waterworks products",
            "Diverse SKUs in the product offering"
          ]
        },
        "large_procurement_team": {
          "answer": "unknown",
          "confidence": 0.5,
          "reason": "There are no explicit indicators on the website regarding the size or complexity of their procurement team.",
          "evidence": [
            "Lack of detailed information on procurement or sourcing teams",
            "No references to global sourcing or extensive supply-chain operations"
          ]
        },
        "turnkey_contract_manufacturer": {
          "answer": "no",
          "confidence": 0.9,
          "reason": "The company provides products but does not appear to offer end-to-end manufacturing solutions as a turnkey contractor.",
          "evidence": [
            "Focuses on manufacturing and selling products, not full manufacturing services"
          ]
        }
      },
      "final_notes": "The company’s presence in manufacturing is evident through a broad product range, but lacking data center service alignment reduces its relevance in that space.",
      "agent_metadata": {
        "backend": "firecrawl_scrape_json",
        "url": "https://aymcdonald.com",
        "final_url": "https://aymcdonald.com",
        "title": "A.Y. McDonald",
        "elapsed_ms": 31323,
        "raw_output_path": "output/experiments/water-valves/raw/mqjre7j2tc5bw90jwiy08wckzzag.enrichment.json",
        "cache_dir": "output/cache/firecrawl/mqjre7j2tc5bw90jwiy08wckzzag",
        "crawl_cache_hit": false
      }
    }
  }
}
```
