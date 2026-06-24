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
  "id": "eA75EawePzbDZHrzJOzmDgXyBpR8",
  "name": "cla-val",
  "website": "cla-val.com",
  "url": "https://cla-val.com",
  "industry": "mechanical or industrial engineering",
  "size": "201-500",
  "country": "united states",
  "region": "california",
  "locality": "costa mesa",
  "linkedin_url": "linkedin.com/company/cla-val",
  "founded": 1936,
  "list_membership": {
    "source": "water-valves-shortlist",
    "reason": "From output/experiments/water-valves/shortlist.csv"
  },
  "tags": [],
  "list_fields": {
    "lead_candidate": {
      "name": "Victor Tran",
      "role": "Purchasing Coordinator at Cla-Val | Supply Chain Management Graduate",
      "linkedin_url": "https://www.linkedin.com/in/victor-tran-607668299?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAEgtt2cB77swMiyudARHO8VvqDgA0JGJFJQ",
      "location": "Newport Beach, CA",
      "selected_role_query": "purchasing",
      "selection_score": 1300,
      "reason": "Procurement or supply-chain title.",
      "alternatives": [
        {
          "name": "Beverly Nong",
          "role": "Purchasing Coordinator at Cla-Val | CA Realtor",
          "linkedin_url": "https://www.linkedin.com/in/beverlynong?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAC054aIBLQO2AHCYarZGjcSn5Tmmm27-8Mo",
          "score": 1300
        },
        {
          "name": "LinkedIn Member",
          "role": "Purchasing Manager at Cla-Val",
          "linkedin_url": null,
          "score": 1200
        },
        {
          "name": "LinkedIn Member",
          "role": "Purchasing Manager",
          "linkedin_url": null,
          "score": 1200
        }
      ]
    },
    "lead_email_status": {
      "selected_name": "Beverly Nong",
      "selected_role": "Purchasing Coordinator at Cla-Val | CA Realtor",
      "linkedin_url": "https://www.linkedin.com/in/beverlynong?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAC054aIBLQO2AHCYarZGjcSn5Tmmm27-8Mo",
      "written": false,
      "reason": "Hunter email was not verified enough to store",
      "finder_status": "accept_all",
      "verifier_status": "accept_all",
      "verifier_result": "risky",
      "confidence": 0.7
    },
    "leads": [
      {
        "first_name": "Victor",
        "last_name": "Tran",
        "full_name": "Victor Tran",
        "email": "vtran@cla-val.com",
        "role": "Purchasing Coordinator at Cla-Val | Supply Chain Management Graduate",
        "company_id": "eA75EawePzbDZHrzJOzmDgXyBpR8",
        "company_name": "cla-val",
        "domain": "cla-val.com",
        "linkedin_url": "https://www.linkedin.com/in/victor-tran-607668299?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAEgtt2cB77swMiyudARHO8VvqDgA0JGJFJQ",
        "source": "hunter:email-finder",
        "verification_status": "accept_all",
        "verifier_status": "accept_all",
        "verifier_result": "risky",
        "confidence": 0.7,
        "hunter": {
          "email_finder": {
            "score": 81,
            "domain": "cla-val.com",
            "company": "Cla-Val",
            "position": null,
            "source_type": "generated",
            "verification": {
              "date": "2026-06-23",
              "status": "accept_all"
            },
            "sources": []
          },
          "verifier": {
            "status": "accept_all",
            "score": 70,
            "email": "vtran@cla-val.com",
            "regexp": true,
            "gibberish": false,
            "disposable": false,
            "webmail": false,
            "mx_records": true,
            "smtp_server": true,
            "smtp_check": true,
            "accept_all": true,
            "block": false,
            "sources": [],
            "result": "risky",
            "_deprecation_notice": "Using result is deprecated, use status instead"
          }
        },
        "added_at": "2026-06-23T18:28:17.343Z"
      }
    ],
    "product_catalog_enrichment": {
      "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
      "custom_evaluation": {
        "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
        "answer": "yes",
        "confidence": 0.9,
        "reason": "The website provides a clear list of various product families including valves and control systems.",
        "evidence": [
          "Cla-Val manufactures a variety of valves including pressure control valves, flow control valves, and various other specialized valves for different applications."
        ]
      },
      "company_summary": "Cla-Val is a designer and manufacturer of automatic control valves, providing solutions across various industries such as waterworks, fire protection, marine, fueling, and industrial applications.",
      "target_alignment": {
        "schema_version": "procurement_manufacturing_v2",
        "score": 65,
        "priority": "medium",
        "manufacturing_fit": 80,
        "procurement_fit": 50,
        "category_fit": 40,
        "datacenter_fit": 30,
        "best_fit_categories": [
          "none"
        ],
        "reason": "Cla-Val has a clear manufacturing operation but lacks depth in procurement complexity and does not fit a priority PDF category.",
        "positive_evidence": [
          "Cla-Val is a manufacturer of automatic control valves."
        ],
        "negative_evidence": [
          "No evidence of complexity in procurement processes."
        ],
        "disqualifiers": [
          "Limited mention of service offerings relevant to high-volume or high-mix manufacturing."
        ]
      },
      "standard_questions": {
        "supplies_datacenters": {
          "answer": "unknown",
          "confidence": 0.5,
          "reason": "The website does not explicitly mention data centers among the markets served.",
          "evidence": []
        },
        "manufacturing_or_factories": {
          "answer": "yes",
          "confidence": 0.9,
          "reason": "Cla-Val states it is a manufacturer with a global headquarters and factory located in Costa Mesa, CA.",
          "evidence": [
            "Cla-Val Company Global Headquarters and Factory located at 1701 Placentia Avenue, Costa Mesa, CA."
          ]
        },
        "high_volume_or_high_mix": {
          "answer": "unknown",
          "confidence": 0.4,
          "reason": "There is no detailed evidence about the volume or mix of manufactured products.",
          "evidence": []
        },
        "large_procurement_team": {
          "answer": "unknown",
          "confidence": 0.5,
          "reason": "The website does not provide specifics regarding the size of the procurement or sourcing team.",
          "evidence": []
        },
        "turnkey_contract_manufacturer": {
          "answer": "no",
          "confidence": 0.8,
          "reason": "Cla-Val does not appear to offer end-to-end manufacturing services as a contract manufacturer.",
          "evidence": [
            "Cla-Val focuses on manufacturing products rather than providing turnkey services."
          ]
        }
      },
      "final_notes": "While Cla-Val is a manufacturer, details regarding procurement complexity and specific data center services are unclear.",
      "agent_metadata": {
        "backend": "firecrawl_scrape_json",
        "url": "https://cla-val.com",
        "final_url": "https://cla-val.com",
        "title": "Home - Cla-Val",
        "elapsed_ms": 17035,
        "raw_output_path": "output/experiments/water-valves/raw/ea75eawepzbdzhrzjozmdgxybpr8.enrichment.json",
        "cache_dir": "output/cache/firecrawl/ea75eawepzbdzhrzjozmdgxybpr8",
        "crawl_cache_hit": false
      }
    }
  }
}
```
