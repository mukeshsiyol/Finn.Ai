# Home intelligence implementation report

Date: 15 November 2026

## Outcome

Home now loads the most recent saved briefing for the exact tracked-company set and selected reporting window. Users can request a new source check from the same screen. The main feed separates company filings from market signals, ranks developments by the existing deterministic priority/importance values, makes routine items expandable, and links each item to its provider source. The presentation follows the supplied dark charcoal and electric-lime reference. No sample announcement was inserted into the briefing.

The audit that preceded implementation is in [home-intelligence-audit.md](home-intelligence-audit.md).

## Frontend → API → service → data → result

| Feature | Frontend and request | Backend/data path | Verification and status |
|---|---|---|---|
| Load prior briefing | `App.tsx` Home effect → `GET /api/intelligence/briefing?tickers=…&window_hours=24` | `latest_intelligence_briefing` → atomic JSON report store at `data/intelligence_briefings.json` (ignored by Git) | **Implemented and end-to-end verified.** A saved report was returned to Home after reload. Matching is exact on sorted tickers and window. |
| Rebuild briefing | Home action → existing `POST /api/intelligence/briefing` with tracked issuer context and selected 24/48/168-hour window | `intelligence_briefing` → `_market_snapshot` (Yahoo Finance via yfinance), `fetch_portfolio_announcements` (NSE), `classify_announcement`, `quarterly_comparisons`, `interpret_evidence`, JSON persistence | **Implemented and end-to-end verified.** Live request returned HTTP 200 and persisted the structured report. |
| Price/volume signals | Report `developments` and `portfolio.alerts` | Actual completed-session close/volume; 20-session volume baseline; existing alert thresholds and alert history | **Implemented and end-to-end verified.** QA data contained 20/20 quotes and two triggered signals for 13 Nov 2026: SBIN volume at 1.13× its 20-session baseline; TMPV price move −3.31% with volume at 1.20×. Both cite the Yahoo Finance instrument page. |
| NSE filings | Report feed; source link from each filing | Existing NSE client and processor; direct fetch, deterministic classification, stable-ID/content dedupe; source URLs checked against NSE host suffixes | **Implemented; provider returned an honest empty result in the live 24-hour window.** Fixture tests verify classification, dedupe, official URL status, and preservation of listing-page vs direct-document URLs. The dated demo filing present in the ordinary announcements endpoint is not used in briefing generation. |
| BSE filings | Provider coverage chip and uncertainty message | No permitted unauthenticated structured BSE feed is configured | **Not implemented; explicitly unavailable.** Home does not claim BSE coverage. |
| Quarterly results | Home result panel, with one citation link on each metric | Existing page-checked Research records → `quarterly_comparisons` calculates comparable QoQ/YoY from stored figures and same basis/type | **Implemented for existing records, not automated extraction.** Live data showed Reliance FY2027-Q2 revenue, EBITDA, PBT and PAT with source PDF page 2 and comparisons. The service only includes a saved value if the cited excerpt contains that number. Missing periods and non-comparable calculations are labeled separately. |
| Active alerts | Compact Home summary → existing Alerts route | `/api/portfolio` current alert list, using existing market snapshot and alert settings | **Implemented and end-to-end verified.** Live results showed SBI and Tata Motors Passenger Vehicles; links to Alerts remain available. Existing settings and OR semantics were not changed. |
| Ask FINN handoff | Home question and optional company → existing Research workspace | Existing Research company/document selection and explicit source-scope confirmation; no query is submitted from Home | **Implemented and browser-tested.** The question and selected company carried into Research, where scope confirmation remains required. No conversation history is implied. |

## API changes

- Added `GET /api/intelligence/briefing` for latest saved briefing retrieval. It accepts `tickers` and `window_hours` (1–168), validates NSE/BSE ticker shape, and returns an explicit `exists` result when no report matches.
- Kept the existing POST route and request shape; the response now adds structured developments, provider statuses, financial records, window/company metadata and a persisted briefing ID. The existing `retention` field now accurately says `persisted`.
- Added `source_page_url` and `document_url` to normalized NSE filing rows without changing existing source URL behavior.
- No portfolio, alert-settings, Research, upload, import or ledger routes were modified.

## Live workflow evidence

A local browser run generated and loaded a real briefing using available provider and stored Research data (the QA backend had LLM credentials disabled, so it used the real deterministic evidence fallback rather than making a model call):

- Market provider: Yahoo Finance via yfinance, 20/20 company quotes available.
- Latest completed market session: 13 Nov 2026.
- NSE provider: request succeeded; zero filings in the selected 24-hour period.
- BSE provider: unavailable and disclosed.
- Market signals: two, with actual close moves, baseline volume ratios and trigger thresholds.
- Research records: Reliance FY2027-Q2 values for all four core metrics; each card links to the stored PDF page. Values are manually entered and page-checked, not automatically extracted or independently recalculated from PDF text.
- AI: no model was called in the browser run; displayed briefing summary was deterministic and labeled as such. OpenRouter generation remains controlled by the existing backend configuration.

## Responsive and browser checks

Browser tested at 1440×1000 and 390×844. `document.documentElement.scrollWidth` matched the viewport at both sizes (no horizontal overflow). No browser page errors or failed API requests were recorded. The 48-hour control issued a GET for that reporting window and displayed the empty saved-report state; returning to 24 hours loaded the saved report. The Ask FINN handoff preserved the question and opened Research with source-scope confirmation.

Screenshots:

- Desktop: [home-intelligence-desktop.png](screenshots/home-intelligence-desktop.png)
- Mobile: [home-intelligence-mobile.png](screenshots/home-intelligence-mobile.png)

## Tests

- Focused backend intelligence tests: **17 passed**.
- Full backend regression suite after the final changes: **106 passed, 1 warning, 17.07 seconds**. The warning is an upstream Starlette/httpx deprecation notice. Pytest used a workspace-local temporary base because the platform's default Windows temp path is inaccessible to the test process.
- Frontend TypeScript check and production build: **passed**. The later frontend-only Home/Research redesign is validated separately in `research-ui-implementation-report.md`.
- Python compilation and `git diff --check`: passed in the final regression pass.

## Classification against acceptance criteria

- Saved briefing auto-load and manual rebuild: **Implemented and end-to-end verified.**
- Default 24-hour window and 48-hour/7-day controls: **Implemented.** Browser verified 24h and 48h request flow; 7d control shares the same validated API path.
- Real exchange-source filings: **Implemented; live window empty.** Fixture path verified. The ordinary announcements endpoint's dated example is excluded.
- Classification, dedupe and priority ordering: **Implemented using existing rules; fixture verified.** Ranking is deterministic by importance then recency; it is not an AI materiality model.
- Routine item collapse: **Implemented.** The live result had no routine filing to expand; routine-item rendering is covered through the same normalized report contract.
- Revenue/EBITDA/PBT/PAT and QoQ/YoY: **Implemented for page-checked stored Research figures.** Automatic financial extraction from exchange attachments remains **not implemented**.
- EOD price and volume threshold signals: **Implemented and end-to-end verified** for this live snapshot. Market data is provider-delayed/best-effort, not exchange-direct.
- Active alerts summary and Alerts link: **Implemented and end-to-end verified.**
- Source links, provider coverage and error visibility: **Implemented.** Causal explanation is intentionally not claimed from price/volume alone.
- Background scheduling / automatic refresh: **Not implemented.** Home auto-loads a saved report; rebuild is explicit and synchronous. No queue or scheduler was introduced.
- Historical report browsing: JSON retains up to 120 reports, while this API exposes only the latest match; there is no archive screen/list endpoint.

## Persistence and operational limits

The project currently persists comparable research and alert data in JSON files, so briefing records use the same local-file pattern with atomic replacement and a 120-report cap. The file is Git-ignored. On hosts with ephemeral filesystems (including a default Render deployment), this data does not survive instance replacement unless persistent disk storage is configured. Concurrent independent server processes also do not share the in-process write lock. A database migration or background scheduler is outside this change.

NSE coverage remains request-driven and provider-dependent. BSE discovery/ingestion is unsupported. Quarterly report values are not automatically extracted from filings. These are backend/data limitations, not hidden UI omissions.
