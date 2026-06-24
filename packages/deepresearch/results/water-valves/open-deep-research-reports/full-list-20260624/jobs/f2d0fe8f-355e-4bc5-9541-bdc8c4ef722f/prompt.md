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
  "id": "WtNHh7O2sKZ0aqvet9yonQJmyJol",
  "name": "\\\"apollo\\\" flow controls, manufactured by conbraco industries",
  "website": "apollovalves.com",
  "url": "https://apollovalves.com",
  "industry": "mechanical or industrial engineering",
  "size": "1001-5000",
  "country": "united states",
  "region": "north carolina",
  "locality": "matthews",
  "linkedin_url": "linkedin.com/company/conbraco-industries",
  "founded": 1928,
  "list_membership": {
    "source": "water-valves-shortlist",
    "reason": "From output/experiments/water-valves/shortlist.csv"
  },
  "tags": [],
  "list_fields": {
    "lead_candidate": {
      "name": "LinkedIn Member",
      "role": "Operations Supervisor at Conbraco Industries Consumer Products Warehouse",
      "linkedin_url": null,
      "location": "Marshville, NC",
      "selected_role_query": "operations",
      "selection_score": 850,
      "reason": "Operations/manufacturing leadership title; may influence procurement.",
      "alternatives": [
        {
          "name": "LinkedIn Member",
          "role": "Manufacturing Engineer at \"Apollo\"​ Flow Controls, Manufactured by Conbraco Industries",
          "linkedin_url": null,
          "score": 800
        },
        {
          "name": "LinkedIn Member",
          "role": "Manufacturing Assembler at \"Apollo\"​ Flow Controls, Manufactured by Conbraco Industries",
          "linkedin_url": null,
          "score": 800
        },
        {
          "name": "LinkedIn Member",
          "role": "Manufacturing Associate at \"Apollo\"​ Flow Controls, Manufactured by Conbraco Industries",
          "linkedin_url": null,
          "score": 800
        }
      ]
    },
    "lead_email_status": {
      "selected_name": "LinkedIn Member",
      "selected_role": "Operations Supervisor at Conbraco Industries Consumer Products Warehouse",
      "linkedin_url": null,
      "written": false,
      "reason": "Hunter did not return an email"
    },
    "product_catalog_enrichment": {
      "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
      "custom_evaluation": {
        "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
        "answer": "yes",
        "confidence": 0.9,
        "reason": "The website details various product lines including Apollo Valves, Press, and PowerPress, indicating a clear product catalogue.",
        "evidence": [
          "Apollo Valves, Apollo Press, Apollo PowerPress, Apollo SmartPress"
        ]
      },
      "company_summary": "Apollo Flow Controls, manufactured by Conbraco Industries, specializes in integrated piping systems and a variety of flow-control products such as valves, fittings, hydrants, and other related components for various applications, including industrial and commercial markets.",
      "target_alignment": {
        "schema_version": "procurement_manufacturing_v2",
        "score": 78,
        "priority": "medium",
        "manufacturing_fit": 85,
        "procurement_fit": 70,
        "category_fit": 60,
        "datacenter_fit": 80,
        "best_fit_categories": [
          "none"
        ],
        "reason": "Apollo clearly engages in manufacturing and has a focus on integrated products for various sectors, including data centers, although there are no strong indications of complex procurement operations.",
        "positive_evidence": [
          "Apollo Valves and other products indicate clear manufacturing presence",
          "Data center solutions noted"
        ],
        "negative_evidence": [
          "no clear evidence of a large procurement team"
        ],
        "disqualifiers": []
      },
      "standard_questions": {
        "supplies_datacenters": {
          "answer": "yes",
          "confidence": 0.8,
          "reason": "The company offers solutions tailored for data centers, indicating their participation in related buildouts.",
          "evidence": [
            "learn more about the diverse solutions we offer within data centers"
          ]
        },
        "manufacturing_or_factories": {
          "answer": "yes",
          "confidence": 0.9,
          "reason": "Apollo is involved in the production of valves and other flow-control products, suggesting they operate manufacturing capabilities.",
          "evidence": [
            "discover our product lines",
            "Apollo PowerPress, Apollo Valves, and other related products"
          ]
        },
        "high_volume_or_high_mix": {
          "answer": "no",
          "confidence": 0.6,
          "reason": "There is no clear indication that they handle large quantities of various SKUs or complex configurations based on website evidence.",
          "evidence": [
            "Product focus around specific types of valves and systems"
          ]
        },
        "large_procurement_team": {
          "answer": "unknown",
          "confidence": 0.5,
          "reason": "The website does not provide sufficient information about the size or complexity of the procurement team.",
          "evidence": []
        },
        "turnkey_contract_manufacturer": {
          "answer": "yes",
          "confidence": 0.7,
          "reason": "They provide integrated piping systems, which suggests they might offer end-to-end contract manufacturing services.",
          "evidence": [
            "with our integrated piping systems, supported by our unique Aalberts IPS design service"
          ]
        }
      },
      "final_notes": "The evidence suggests a strong manufacturing profile, but further exploration into procurement complexity and specific team size would provide a clearer picture.",
      "agent_metadata": {
        "backend": "firecrawl_scrape_json",
        "url": "https://apollovalves.com",
        "final_url": "https://apollovalves.com",
        "title": "Aalberts integrated piping systems",
        "elapsed_ms": 14129,
        "raw_output_path": "output/experiments/water-valves/raw/wtnhh7o2skz0aqvet9yonqjmyjol.enrichment.json",
        "cache_dir": "output/cache/firecrawl/wtnhh7o2skz0aqvet9yonqjmyjol",
        "crawl_cache_hit": false
      }
    }
  }
}
```
