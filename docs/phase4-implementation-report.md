# Phase 4 Implementation Report

## What changed

The existing FINN frontend now presents a shared black-and-lime investment workspace across Home, Research, Portfolio and Alerts. The redesign retains the hash routes, existing services, data and accounting flows.

- **Home:** Daily intelligence and priority developments now lead the page; Ask FINN follows the attention feed, while price coverage and portfolio metrics sit lower. Filing and market explanations use existing explanation services and display only returned content. Home-to-Research carries the question and optional company, then requires a source scope confirmation. The historical chart is explicitly labeled as historical value of current holdings, with its proxy methodology and omitted transaction/cash-flow factors beside it; its percentage is not labeled account return.
- **Research:** The company search and selected issuer coverage lead the page, with source-backed recent feed items and document-type-appropriate suggested questions. Workspace navigation is compact, icon-led, and uses a restrained lime active state. Ask FINN retains citation links and inspectable page excerpts. Financial figures and commitment entry forms are secondary disclosures, leaving saved comparisons and guidance outcomes first. Sources retains official-source discovery, explicit verified-candidate imports, import progress/status/retry, manual PDF upload and document-library actions; the selected company is carried into discovery.
- **Portfolio:** Holdings, watchlist and activity workflows remain accessible. Existing holdings and watchlist rows link to company research. Concentration now includes allocation bars and plain-language exposure descriptions based on the existing priced-holdings figures. Accounting and P&L remain in the existing ledger/backend paths.
- **Alerts:** Feed-first page with current filters and actions. Threshold settings moved into a disclosure without changing the settings API or OR-trigger semantics. Alert cards can open company research.
- **Shared shell:** Persistent desktop workspace navigation, mobile bottom navigation, shared surfaces/tokens, responsive card/table layouts and visible focus states.

## Routes, components and API integrations

Preserved routes: `#/home`, `#/research`, `#/portfolio`, `#/alerts`.

The implementation reuses `App.tsx`, `AIConversation`, `IntelligenceAnswer`, the existing hash navigation and existing portfolio ledger. It adds `SourceDiscovery.tsx` and typed frontend methods for the Phase 2/3 routes already implemented by the backend:

- `GET /api/research/discovery`
- `POST /api/research/discovery/import`
- `GET /api/research/imports`
- `GET /api/research/imports/{id}`
- `POST /api/research/imports/{id}/retry`

Imports require a user to select a candidate and the frontend only offers import for a candidate marked verified with a direct document URL. Existing upload, document library, replace, delete, re-index, financial comparison, commitment, bull/bear, alert and portfolio endpoints were not changed.

## Validation

- `npm run check`: passed (TypeScript check and Vite production build; 2,066 modules transformed).
- Full backend suite: **94 passed, 1 warning, 16.46 seconds**, using `--basetemp=tmp/phase4-full-suite`. The warning is the installed Starlette/httpx TestClient deprecation.
- `git diff --check`: passed. Git emitted only existing LF-to-CRLF normalization notices.
- Browser-tested the final app in Chrome at 1440 × 1000 and 390 × 844. All four route headings loaded, page errors were empty, and none of the routes had horizontal page overflow at either width.
- Research workflow checks: selected Reliance from company search (7 indexed sources shown), opened Financials, Commitments, Bull vs Bear and Sources, and verified the landing shows document coverage and sourced developments. Home-to-Research carried the typed question, company context, and selected document into the explicit source-scope confirmation.
- Live read-only discovery resolved Reliance through the issuer registry and returned 185 candidates. IR/NSE providers reported successful/empty results; BSE providers returned errors. Selecting a candidate exposed the explicit import control. No document was imported, so stored records were not modified; the full backend suite covers import pipeline behavior.
- One Ask FINN question retrieved source pages but returned “Retrieved source pages are available, but the AI correction attempt failed.” No answer citation was produced. This is a backend AI response failure; the frontend displayed the returned failure and no fake answer. It remains unresolved because Phase 4 prohibits backend changes.
- Portfolio showed 20 tracked companies and 0 current holdings in this local browser profile. The holdings empty state and transaction-history limitation were accurate; concentration metrics were correctly unavailable for an empty portfolio. Alerts displayed its feed and all four category filters.
- Captured fresh desktop and mobile viewport screenshots for all four routes. These are browser captures, not physical-device photographs.

## Screenshots

These are the final refinement captures from Chrome. Mobile images are browser viewport captures, not physical-device photographs.

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Home | [Home · 1440 × 1000](../frontend/docs/screenshots/phase4-final-home-desktop.png) | [Home · 390 × 844](../frontend/docs/screenshots/phase4-final-home-mobile.png) |
| Alerts | [Alerts · 1440 × 1000](../frontend/docs/screenshots/phase4-final-alerts-desktop.png) | [Alerts · 390 × 844](../frontend/docs/screenshots/phase4-final-alerts-mobile.png) |
| Research | [Research · 1440 × 1000](../frontend/docs/screenshots/phase4-final-research-desktop.png) | [Research · 390 × 844](../frontend/docs/screenshots/phase4-final-research-mobile.png) |
| Portfolio | [Portfolio · 1440 × 1000](../frontend/docs/screenshots/phase4-final-portfolio-desktop.png) | [Portfolio · 390 × 844](../frontend/docs/screenshots/phase4-final-portfolio-mobile.png) |

## Preservation and limitations

- Phase 4 changes are confined to frontend files and Phase 4 documentation/screenshots. Backend paths already showed unrelated working-tree changes before this phase and were left untouched.
- No backend response contracts, financial calculations, portfolio ledger behavior, manual upload APIs, stored documents or PDFs were changed.
- No data or AI response was replaced with a mock. The browser uses existing local API data and existing empty/stale/error states.
- Company overviews remain limited to actual indexed documents and returned backend information. No unsupported company description or AI confidence was added.
- Discovery coverage remains limited to verified issuer/source mappings and available providers. Some candidates may lack a direct PDF, and BSE/provider limitations remain visible.
- The backend's existing single-process file persistence and background import limitations are unchanged.

## Files

- Added `docs/phase4-design-system.md`, this report and `docs/phase4-frontend-audit.md`.
- Added `frontend/src/phase4.css` and `frontend/src/components/research/SourceDiscovery.tsx`.
- Updated `frontend/src/App.tsx`, `frontend/src/services/aiApi.ts`, `frontend/src/theme.css`, `frontend/src/main.tsx` and `frontend/index.html`.
- Added eight route screenshots under `frontend/docs/screenshots/`.
