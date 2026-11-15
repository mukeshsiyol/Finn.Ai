# Phase 4 Frontend Architecture Audit

## Existing architecture

- **Runtime:** React + TypeScript + Vite, mounted from `frontend/src/main.tsx`. No router dependency is installed. `App.tsx` implements hash routes (`#/home`, `#/research`, `#/portfolio`, `#/alerts`) and browser back/forward handling; preserve those URLs.
- **Application shell:** One fixed desktop sidebar, a shared top bar and content root, and a fixed four-item mobile bottom navigation. Screen content is conditionally rendered from one 1,300-line `App.tsx` component.
- **Component hierarchy:** `AIConversation` renders the reusable evidence exchange UI; `IntelligenceAnswer` presents portfolio/briefing answers; `portfolioLedger.ts` owns transaction migration, position derivation and accounting calculations. Most remaining screen UI is inline in `App.tsx`.
- **Styles:** `styles.css` contains a minified light-theme base; `theme.css` contains roughly 1,700 lines of accumulated redesign and responsive overrides. Its token values are currently a warm/blue-green palette, and several overrides conflict. Phase 4 should consolidate the source of truth and apply the approved black/charcoal/lime system consistently.
- **Authentication:** No frontend authentication flow or auth API was found. The shell's “Investor desk” is a local workspace label, not an authenticated identity.

## Routes and existing functionality

| Route | Current capabilities | Phase 4 destination |
| --- | --- | --- |
| `#/home` | Daily briefing request; Ask FINN handoff to Research with explicit scope confirmation; priced coverage; priced holdings summary; alert/filing attention list; portfolio performance chart and historical coverage; sector/concentration analysis; market freshness and API failure states. | Daily Intelligence: briefing and prioritized developments first, contextual Ask FINN, an honest portfolio snapshot, position/sector insights, direct links to Alerts, Research and Portfolio. Preserve unavailable/partial states and avoid displaying unpriced holdings as zero. |
| `#/research` | Company/document selection; retrieval-backed Ask FINN; citations and verification; company-source option; financial records and comparisons (Revenue, EBITDA, PBT, PAT; QoQ/YoY; basis and reported/adjusted controls); promise tracker; bull/bear analysis; manual PDF upload, document library, delete/reindex/replace. | Investor-facing company investigation first; evidence-backed answer and recent context; financial and investment analysis; a secondary Sources & Documents area with existing manual management plus Phase 2/3 discovery/import/status/retry controls. |
| `#/portfolio` | Holdings, ledger-weighted cost basis and P&L; price/history/benchmark; asset and sector allocation; concentration/risk indicators; watchlist search/categories/add/remove/edit; fundamentals; price targets; trade editor; deposits/withdrawals/dividends/splits/bonuses; opening-balance warnings; CSV export. | Holdings overview with coherent allocation/risk narrative; distinct priced vs unpriced holdings; searchable watchlist; Activity remains accessible. Preserve `portfolioLedger.ts` as the accounting source and all existing actions. |
| `#/alerts` | Exchange announcements and alert history; 24h/7d/30d windows; filing/category filters; unread-only/read updates; announcement and market explanations; threshold settings for price and volume with current backend OR semantics; source/error states. | Prioritized Intelligence Feed, filter rail, readable event cards and links to Research. Move trigger settings into a secondary disclosure without changing their API or save behavior. |

## Existing API and data flows

- **Portfolio/market:** `GET /api/portfolio`, `/api/portfolio/quotes`, `/api/portfolio/history`, `/api/portfolio/benchmark`, `/api/portfolio/fundamentals`; appends `?refresh=true` on manual refresh. `App.tsx` renders backend-calculated portfolio market and alert data and uses `portfolioLedger.ts` for the existing client-side transaction ledger/accounting model. No new financial calculations should be added during the redesign.
- **Announcements/alerts:** `/api/announcements`, `/api/alerts/history`, `PUT /api/alerts/read`, `GET/PUT /api/settings/alerts`, `/api/announcements/explain`, and `/api/market/explain`.
- **AI:** `aiApi.ts` owns request parsing/validation for `/api/research/query`, `/api/intelligence/briefing`, `/api/intelligence/portfolio`, `/api/research/compare`, filing explanations and market-signal explanations. It does not expose credentials. `AIConversation` and `IntelligenceAnswer` retain facts, AI interpretation, sources, citations, verification failures and fallback modes.
- **Research/manual files:** `/api/research/documents`, `/api/research/documents` POST, per-document dependencies, DELETE, reindex POST and replacement PUT; `/api/research/promises` GET/POST; `/api/research/bull-bear` POST. Upload and replace use `FormData`; PDF limit is 45 MB.
- **Discovery/import gap:** Backend routes exist at `GET /api/research/discovery`, `POST /api/research/discovery/import`, `GET /api/research/imports`, `GET /api/research/imports/{id}` and `POST /api/research/imports/{id}/retry`. The current frontend has no client methods or visible UI for these flows. Phase 4 should add typed frontend methods using those existing contracts, request discovery only after company selection, require an explicit per-candidate Import action, and display server status/failure/retry state.
- **History/state:** Watchlist selection, categories, custom companies, price alert targets/events and transactions persist in `localStorage`. This is existing client state; do not silently migrate or discard it.
- **Loading/errors:** Async screen operations have busy/error flags and abort controllers for some history requests. Global refresh, alert, research, upload, comparison, briefing and AI errors are mostly local messages. The redesign should keep them visible and distinguish unavailable from empty.

## Charting and data integrity

There is no external chart dependency. Existing visualisations are SVG/CSS rendered in `App.tsx` from backend price/history and existing ledger outputs. Preserve the data source and explicit “insufficient history” states. Do not derive proxy returns for missing periods, assume missing market values are zero, or fabricate company fundamentals, company summaries, alert confidence, AI status or citations.

## Reuse/refactor plan

- Reuse all current API functions and data types; add only typed helpers for the existing discovery/import endpoints.
- Keep hash routes and `navigate()` behavior. Refine shared shell markup and styles rather than introducing a second navigation framework.
- Keep `portfolioLedger.ts` calculations intact.
- Keep `AIConversation` and `IntelligenceAnswer` as shared research/trust components, restyling them to the new tokens.
- Preserve every inline workflow and modal in `App.tsx`; reshape their hierarchy and place them into screen-specific sections/disclosures.
- Replace conflicting root palette declarations and reduce late override drift. Shared spacing, surfaces, navigation, fields, buttons, states and chart colors should come from one set of CSS tokens.

## No backend changes / known limitations

- No auth UI currently exists; none will be invented in the frontend.
- Daily briefing and company/portfolio AI requests are not persisted by the backend; keep that notice.
- Discovery/import are bounded by Phase 2 source coverage and Phase 3's PDF/verified-source constraints. BSE discovery may honestly report unavailable; display provider warnings/status rather than inventing results.
- Market data can be delayed, stale or missing. Continue showing session/retrieval timestamps and partial coverage.
- Only data included in current backend responses should be displayed. A business description or company-level summary cannot be populated from mock copy.

## Validation plan

- Run typecheck and production build after integration.
- Run the full backend regression suite and compare backend file status before/after to ensure no backend edits.
- Start the real local API and Vite application; exercise each hash route, AI handoff, manual PDF controls, discovery → explicit import → status/retry UI, portfolio/watchlist actions, alert filters/settings and responsive layouts at desktop and phone widths.
- Inspect browser console and horizontal overflow; capture screenshots for the four routes if browser tooling is available.
