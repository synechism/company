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
  "id": "ERQnyRuUG54mlpD7iqxxkQbi8XuT",
  "name": "dezurik",
  "website": "dezurik.com",
  "url": "https://dezurik.com",
  "industry": "mechanical or industrial engineering",
  "size": "501-1000",
  "country": "united states",
  "region": "minnesota",
  "locality": "sartell",
  "linkedin_url": "linkedin.com/company/dezurik",
  "founded": 1928,
  "list_membership": {
    "source": "water-valves-shortlist",
    "reason": "From output/experiments/water-valves/shortlist.csv"
  },
  "tags": [],
  "list_fields": {
    "lead_candidate": {
      "name": "Sean Smith, MBA, CSCP, CLTD",
      "role": "Vice President - Supply Chain at DeZURIK",
      "linkedin_url": "https://www.linkedin.com/in/seandavidsmith?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAAIx0_gBAufe_KVK-dQ_JZhCBwW1jhJD81g",
      "location": "Greater Madison Area",
      "selected_role_query": "supply chain",
      "selection_score": 1600,
      "reason": "Senior procurement/supply-chain title; likely close to purchasing decisions.",
      "alternatives": [
        {
          "name": "Vedh Nair",
          "role": "Strategic Sourcing Category Manager",
          "linkedin_url": "https://www.linkedin.com/in/vedh-nair-a3a950196?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAC4O5s4BY2HdyTDBG_Zgo1GmV5TqzqlZGgY",
          "score": 1350
        },
        {
          "name": "Michelle Lewis, MBA",
          "role": "Strategic Sourcing Manager | MBA in Supply Chain Management",
          "linkedin_url": "https://www.linkedin.com/in/lewis-michelle?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAACmmYuIBza8bXLprF7M81g4XzWE5eJoMNOI",
          "score": 1350
        },
        {
          "name": "Gabriel Souza",
          "role": "Strategic Sourcing & Supply Chain Manager | IATF 16949 Lead Auditor | Global Procurement – Americas, Europe & Asia | Cost Reduction & Supplier Development | Large-Scale CAPEX Investments Planning & Execution",
          "linkedin_url": "https://www.linkedin.com/in/gabriel-souza-a9b262b0?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAABeH0ZcBq8P52X2KQiVLVSP9wi7Gsv0NHCA",
          "score": 1350
        }
      ]
    },
    "lead_email_status": {
      "selected_name": "Gabriel Souza",
      "selected_role": "Strategic Sourcing & Supply Chain Manager | IATF 16949 Lead Auditor | Global Procurement – Americas, Europe & Asia | Cost Reduction & Supplier Development | Large-Scale CAPEX Investments Planning & Execution",
      "linkedin_url": "https://www.linkedin.com/in/gabriel-souza-a9b262b0?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAABeH0ZcBq8P52X2KQiVLVSP9wi7Gsv0NHCA",
      "written": false,
      "reason": "Hunter email was not verified enough to store",
      "finder_status": "accept_all",
      "verifier_status": "accept_all",
      "verifier_result": "risky",
      "confidence": 0.73
    },
    "leads": [
      {
        "first_name": "Sean",
        "last_name": "Smith",
        "full_name": "Sean Smith",
        "email": "sean.smith@dezurik.com",
        "role": "Vice President - Supply Chain at DeZURIK",
        "company_id": "ERQnyRuUG54mlpD7iqxxkQbi8XuT",
        "company_name": "dezurik",
        "domain": "dezurik.com",
        "linkedin_url": "https://www.linkedin.com/in/seandavidsmith?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AACoAAAIx0_gBAufe_KVK-dQ_JZhCBwW1jhJD81g",
        "source": "hunter:email-finder",
        "verification_status": "accept_all",
        "verifier_status": "accept_all",
        "verifier_result": "risky",
        "confidence": 0.7,
        "hunter": {
          "email_finder": {
            "score": 83,
            "domain": "dezurik.com",
            "company": "DeZURIK",
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
            "email": "sean.smith@dezurik.com",
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
        "added_at": "2026-06-23T18:28:19.277Z"
      }
    ],
    "product_catalog_enrichment": {
      "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
      "custom_evaluation": {
        "question": "What are the products and product catalogue this company offers or produces? Summarize the main product families, especially valves, hydrants, fittings, waterworks, flow-control, piping, actuation, and related manufactured products.",
        "answer": "yes",
        "confidence": 0.9,
        "reason": "The website lists a wide variety of valve products including plug valves, butterfly valves, and knife gate valves.",
        "evidence": [
          "DeZURIK designs and manufactures more than 60 innovative valve styles.",
          "Offers products like Plug Valves, Butterfly Valves, Control Valves, Knife Gate Valves, and Check Valves."
        ]
      },
      "company_summary": "DeZURIK is a global manufacturer of valves and valve accessories for various industrial applications, specializing in water treatment, sewage treatment, and other process industries.",
      "target_alignment": {
        "schema_version": "procurement_manufacturing_v2",
        "score": 71,
        "priority": "medium",
        "manufacturing_fit": 80,
        "procurement_fit": 60,
        "category_fit": 50,
        "datacenter_fit": 40,
        "best_fit_categories": [
          "none"
        ],
        "reason": "DeZURIK demonstrates a solid manufacturing footprint in valve production but lacks evidence for complex procurement and specific category alignment with the PDF target profile.",
        "positive_evidence": [
          "Manufactures a variety of valves for sewage treatment, water treatment, and more.",
          "Known for reliability and service in valve manufacturing."
        ],
        "negative_evidence": [
          "Lacks strong signals of procurement complexity or direct involvement in data center buildouts."
        ],
        "disqualifiers": [
          "No evidence of serving data centers directly.",
          "Not a turnkey manufacturer."
        ]
      },
      "standard_questions": {
        "supplies_datacenters": {
          "answer": "unknown",
          "confidence": 0.4,
          "reason": "The website does not specifically mention data center involvement or supply.",
          "evidence": [
            "Focus on valve manufacturing for sewage treatment, water treatment, and industrial processes."
          ]
        },
        "manufacturing_or_factories": {
          "answer": "yes",
          "confidence": 0.9,
          "reason": "DeZURIK is identified as a manufacturer with extensive facilities for producing a wide range of valves.",
          "evidence": [
            "DeZURIK has become an innovative global leader as a valve manufacturer."
          ]
        },
        "high_volume_or_high_mix": {
          "answer": "no",
          "confidence": 0.7,
          "reason": "While the company manufactures various types of valves, it does not indicate high-volume production or a high mix of SKUs specific to its offerings.",
          "evidence": [
            "DeZURIK designs and manufactures more than 60 innovative valve styles."
          ]
        },
        "large_procurement_team": {
          "answer": "unknown",
          "confidence": 0.5,
          "reason": "The page does not provide explicit evidence regarding the size or structure of the procurement team.",
          "evidence": [
            "Website does not detail procurement complexity or team size."
          ]
        },
        "turnkey_contract_manufacturer": {
          "answer": "no",
          "confidence": 0.8,
          "reason": "DeZURIK primarily manufactures valves rather than providing end-to-end contract manufacturing services.",
          "evidence": [
            "DeZURIK focuses on valve manufacturing, not turnkey solutions."
          ]
        }
      },
      "final_notes": "The focus on valve manufacturing indicates strong manufacturing capabilities but lacks evidence of a complex procurement operation or clear alignment with the targeted PDF categories.",
      "agent_metadata": {
        "backend": "firecrawl_scrape_json",
        "url": "https://dezurik.com",
        "final_url": "https://dezurik.com",
        "title": "Home - DeZURIK",
        "elapsed_ms": 35442,
        "raw_output_path": "output/experiments/water-valves/raw/erqnyruug54mlpd7iqxxkqbi8xut.enrichment.json",
        "cache_dir": "output/cache/firecrawl/erqnyruug54mlpd7iqxxkqbi8xut",
        "crawl_cache_hit": false
      }
    }
  }
}
```
