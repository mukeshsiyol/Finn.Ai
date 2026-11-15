# FINN Home and Research UI Implementation Report

Date: 15 November 2026

## Scope

This change redesigns the Home discovery experience and the Research landing/workspace presentation only. It does not modify backend code, API contracts, data schemas, provider behavior, financial calculations or research business logic. Existing Research and document-management workflows remain connected to the same API layer.

## What changed

### Home before company selection

- Added a research-led hero and global search for a company or a natural-language question.
- Company matches come from the existing portfolio and indexed-document lists; no company is selected on first load.
- Selecting a company opens its existing Research workspace. A typed question is carried into Research, where FINN asks the user to confirm a company/document scope before any request is submitted.
- Added five Research path shortcuts, actual companies to explore, and a recently opened list. Recent selections are saved in the current browser only.
- Moved the existing Daily Intelligence briefing, portfolio snapshot, market history, alerts, and Ask FINN entry under a closed “Daily portfolio intelligence” disclosure. This keeps the existing functions available without showing company-specific financial values on the unselected landing screen.
- Company cards use initials and live company metadata; no company logos, popularity ranking, prices or financial claims are fabricated.

### Research before company selection

- Added a separate discovery landing with company/ticker search, five research paths, source coverage, companies to explore and recent selections.
- The five paths set the workspace section that opens after company selection: Ask FINN, Financials, Commitments, Bull / Bear and Sources.
- No Reliance company context or financial metrics are shown until the user selects a company.

### Selected-company workspace

- The selected company name and ticker are shown in the page header and existing context panel.
- The existing five section controls are compact and consistent, with a restrained lime active state. Mobile controls use a five-column icon-and-label layout.
- Existing source documents, citations, quarterly comparisons, management commitments, Bull / Bear analysis, discovery, explicit import, upload, library, re-index, replace and delete controls remain in their existing components.
- Existing company and document selection continues to control the API request context. Selecting a company does not submit an Ask FINN request.

## Files changed for this frontend-only redesign

- `frontend/src/App.tsx`
- `frontend/src/phase4.css`
- `docs/research-ui-implementation-report.md` (this report)
- `docs/screenshots/research-home-mobile.png`
- `docs/screenshots/research-home-desktop.png`
- `docs/screenshots/research-landing-mobile.png`
- `docs/screenshots/research-workspace-mobile.png`
- `docs/screenshots/research-workspace-desktop.png`

The separate Alerts work in this session also updates `frontend/src/App.tsx` and `frontend/src/phase4.css`; its backend changes are documented in `alerts-implementation-report.md`. No backend changes were made for this Home/Research UI request.

## Testing

- `npm run typecheck`: passed.
- Home at 390 × 844: no horizontal overflow; the Daily Portfolio Intelligence disclosure is closed by default; four data-backed company cards rendered.
- Research landing at 390 × 844: five research paths, four data-backed company cards, no preselected company, and no horizontal overflow.
- Home question handoff: the question “What did Reliance management say about margins?” appeared in Research, remained unsubmitted, and prompted the user to select a company/source scope.
- Company selection: Reliance Industries Limited opened with the existing seven indexed sources. Its selected ticker and context were displayed.
- All five workspace tabs were clicked and reported `aria-selected=true` for the selected section.
- Recent-selection behavior: Reliance appeared in Home’s Recently opened section after selection.
- Selected Research workspace at 390 × 844 and 1440 × 1000: body width matched viewport; no horizontal overflow.
- Browser run recorded no page errors or failed network requests.
- Production build is included in the final `npm run check` validation.

## Functionality classification

| Requirement | Status | Evidence / limits |
|---|---|---|
| Home discovery and global search | Implemented and browser-tested | Uses registered companies and existing indexed sources; unrecognized text is handed to Research as a question. |
| No default company selection | Implemented and browser-tested | No company or document is selected on startup; existing daily portfolio detail is collapsed. |
| Home company and recent sections | Implemented and browser-tested | Company data comes from current portfolio/source lists; recent choices are browser-local. |
| Research landing and five paths | Implemented and browser-tested | Path selection is carried into the selected-company workspace. |
| Ask FINN question handoff | Implemented and browser-tested | Question is preserved and explicit source-scope confirmation remains required. No AI request is sent during handoff. |
| Financials, Commitments, Bull / Bear, Sources | Existing functionality preserved and navigation-tested | The same backend integrations, data contracts and existing evidence controls remain. This UI check did not submit a new AI request or import a new document. |
| Responsive behavior | Browser-verified at 390 × 844 and 1440 × 1000 | No horizontal overflow on the tested landing/workspace routes. Additional physical-device testing was not performed. |

## Known limitations

- The Home brief, holdings and market intelligence remain available under the disclosure and continue to show only their existing backend data.
- Recent company selections are stored in local browser storage, not synchronized between devices or users.
- The research picker offers companies already present in FINN's portfolio universe or indexed document library. Public-source registry search remains in the existing Sources workflow after company selection.
- The Research response, PDF import/indexing, data availability and citations still depend on the existing backend and its provider/storage configuration; this frontend-only change does not alter those services.
