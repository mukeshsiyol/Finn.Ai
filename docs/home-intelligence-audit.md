# FINN Home Intelligence: implementation audit

Audit date: 15 November 2026

## Existing Home workflow and backend trace

| Home feature | Frontend entry | API and backend path | Actual capability and limitation | Audit status |
|---|---|---|---|---|
| Portfolio/market data | `loadPortfolio` and Home market status | `GET /api/portfolio` → `_portfolio_snapshot` → `_market_snapshot` → yfinance; 5-minute in-memory cache | End-of-day close, previous close, volume, 20-session average, configured trigger values, session date and source are returned per tracked issuer. Missing data is represented as unavailable. On 15 Nov 2026 the live API returned 20/20 quotes, latest session 13 Nov, and 9 market alert rows (8 visible in the alert list because alert records combine/dedupe signals). Data is provider-delayed/best-effort, not exchange-direct. | Backend works; Home does not currently organize these as a complete briefing. |
| Market alerts | Home's `homePriorityAlerts`; Alerts page | `_market_snapshot` → `_market_alert_events` → `_upsert_alert_history`; `GET /api/alerts/history` and `POST /api/market/explain` | Deterministic price and 20-session volume triggers use `data/alert_settings.json`. Alert history is persisted in `data/alert_history.json`; repeated signal IDs are idempotently updated. Explanations cite the market-data provider and state that a signal does not establish cause. | Backend works; Home only shows 3 ranked history rows and lacks a compact complete active-alert summary. |
| NSE filings | Home's `announcements` state and `homeAnnouncement` | `GET /api/announcements` → `fetch_portfolio_announcements` → `classify_announcement` → alert-history persistence | The NSE client queries real portfolio symbols, filters by filing time, and retains sequence/date/attachment or official listing URL. Classification is deterministic across the established announcement categories, with importance/priority fields. The endpoint adds a dated real NSE example to its ordinary feed when within the requested window; the new briefing pipeline must not treat this as live data. No BSE feed is available. | NSE works when available; BSE missing. Home currently has no all-updates/routine collapse or provider coverage details. |
| Filing explanations | Home action “Why this filing matters” | `POST /api/announcements/explain` → persisted alert-history item → `interpret_evidence` | Explanation is generated from the filing's stored metadata and source URL; deterministic fallback is category-level context. The LLM is bounded by those facts and requires citations; an unavailable/invalid synthesis falls back. The attached NSE document is not downloaded or extracted by this workflow. | Existing feature works as filing-context interpretation, not extracted financial impact. |
| Daily briefing | Home “Build briefing” | `POST /api/intelligence/briefing` → market snapshot + direct NSE fetch + `interpret_evidence` | Stateless and user-triggered only. It fetches prices and NSE filings, ranks neither a full feed nor source coverage by provider, returns only a synthesized answer/facts/sources/coverage, and reports `retention=request_not_persisted`. It accepts 1–168 hours but Home always sends 24 hours. Live API had no persisted briefing to retrieve. | Partially implemented; no GET/history, persistence, date/window controls, BSE status, announcement cards, or active report metadata. |
| Announcement ingest/dedupe | Announcements feed | NSE sequence IDs, then `_upsert_alert_history` by stable ID | Real rows are filtered to tracked portfolio symbols; known IDs are deduplicated in alert-history storage. No independent ingestion schedule/background job. Data is fetched on API request and cached only as historical alert records. | Partial; request-driven, NSE only, no BSE. |
| Quarterly results | Research financials UI | `GET /api/research/financials` → `quarterly_comparisons`; JSON evidence in `data/reports/evidence.json` and financial records | Figures are manually entered from a selected PDF page. The existing pipeline validates the page excerpt against the source PDF, stores statement basis/type and computes QoQ/YoY only for comparable periods. Existing Titan/Reliance saved data is available and source-page-linked. Briefing endpoint currently never reads it. It must not infer metrics from announcement text or ask an LLM to extract numbers. | Backend research workflow exists; Home results intelligence is not integrated. |
| Document citations/retrieval | Ask FINN and Sources | `/api/research/query`, Phase 1 retrieval, citations and source validation; Phase 2 discovery and Phase 3 explicit import | Primary-source PDFs are indexed with page-aware citations. Discovery/import is an explicit user flow. Briefing synthesis currently cites NSE listing attachments and Yahoo quote pages, not retrieved PDF pages; it has no primary-source document retrieval for briefings. | Existing Research works separately; Home briefing must link sources and distinguish market/exchange evidence from Research PDF evidence. |
| Persistence/background work | Browser Home state | JSON persistence for alert history and research records; in-memory market cache | No SQL database or briefing job queue exists. No scheduler refreshes an intelligence report. The compatible approach is a small atomic JSON report store matching the current application persistence pattern; generation stays on explicit refresh and can be loaded via GET. | Briefings missing; no new infrastructure required. |

## Live evidence captured before changes

Local API calls on 15 Nov 2026 returned:

- `GET /health`: 200; Yahoo Finance via yfinance; OpenRouter configured.
- `GET /api/portfolio`: 200; 20 tracked companies, 20 quotes available, 9 signal rows; latest completed market session 13 Nov 2026.
- `GET /api/announcements?window_hours=24`: 200; NSE feed reported available, zero filings in the window.
- `GET /api/alerts/history?window_hours=168`: 200; 14 alert-history records.
- `GET /api/research/financials?ticker=TITAN`: 200; source-page-linked quarterly results exist for FY2026-Q2, FY2027-Q1, and FY2027-Q2 (with calculated comparisons). Reliance likewise has saved periods. The ticker must be the normalized research ticker in the records, not the `.NS` market symbol.
- There was no GET/latest briefing endpoint or persisted briefing record.

## Reuse and changes required

Reuse the current NSE client, classifier, alert-history dedupe, `_market_snapshot`, alert settings, evidence-bounded `interpret_evidence`, and `quarterly_comparisons`. Keep alert settings and OR-trigger calculations unchanged. Do not insert the dated demo filing into live briefings. Make the existing POST briefing persist its generated structured report and retain its current request/response fields; add an additive GET/latest endpoint. Add supported 24h, 48h and 7d selection (custom dates remain unsupported), event-level source/verification fields, explicit NSE/BSE provider status, a ranked feed with routine collapse, and saved quarterly figures only when their cited source period/basis can be matched. Do not describe BSE as covered: report its provider status as unsupported/unavailable until a permitted live feed is implemented.

## Requirement status before implementation

- Daily briefing generation: **Backend only, partial** (POST; no persistence or automatic load).
- NSE announcement ingestion: **Backend only, partial** (real request-driven feed).
- BSE announcement ingestion: **Not implemented**.
- Classification and deterministic importance: **Backend implemented**, not fully used by Home.
- End-of-day price/volume ingestion: **Backend implemented** through yfinance; provider limitations surfaced.
- Unusual price/volume detection: **Backend implemented** using persisted user thresholds and completed sessions.
- Materiality ranking: **Backend partially implemented** by category score and alert priority; no multi-factor relevance ranking.
- Quarterly Revenue/EBITDA/PBT/PAT extraction: **Manual, source-validated Research workflow only**; not automatic and not currently surfaced in Home.
- Citation and retrieval: **Research backend implemented**; briefing cites feed/market sources, not extracted financial PDF passages.
- Historical briefing persistence: **Not implemented**.
- Home time controls, routine collapse and complete priority feed: **Not implemented**.


## Post-implementation status

The new `docs/home-intelligence-implementation-report.md` records the frontend-to-backend evidence, actual live result, exact test status and remaining gaps. Since the pre-change audit above:

- Daily briefings now persist in an atomic, capped JSON store and can be loaded through an additive latest-report GET endpoint.
- The existing briefing POST now returns structured events, source/provider status, source freshness, and page-checked saved Research quarterly figures while preserving its request body.
- Home now loads saved briefings, offers 24-hour / 48-hour / 7-day selections and an explicit rebuild action, displays ranked events with source links, collapses routine rows, and surfaces financial evidence and active alerts.
- The live EOD run verified 20/20 quote coverage and two actual threshold signals. The live NSE request succeeded but found no filing in the selected 24-hour period. No sample announcement was inserted. BSE remains unavailable.
- The Home Ask FINN action hands the question and optional issuer into the existing Research scope-confirmation workflow.
- Responsive browser checks passed at 390×844 and 1440×1000 with no horizontal overflow.

See the implementation report for incomplete items: no BSE feed, no automatic PDF financial extraction, no scheduled/background briefing generation, and no persisted-report archive API/UI.
