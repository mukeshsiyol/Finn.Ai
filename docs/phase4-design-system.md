# Phase 4 Design System

## Direction

FINN uses a dark, evidence-led investment workspace. The supplied mobile references informed the charcoal surfaces, electric-lime actions, compact financial visualisations and bottom navigation. The existing FINN identity and four hash routes remain in place.

## Tokens

| Use | Value |
| --- | --- |
| Main canvas | `#090909` |
| Card surface | `#1C1C1C` |
| Elevated surface | `#242424` |
| Lime accent | `#D7FF00` |
| Primary text | `#FFFFFF` |
| Secondary text | `#A1A1A1` |
| Subtle border | `#303030` |

Lime is reserved for active navigation, primary actions, key chart marks and positive state indicators. Cards use flat charcoal fills and low contrast borders rather than glass or decorative gradients. Existing financial colors are mapped to readable lime/rose treatments.

## Layout and components

- One application shell supports Home, Alerts, Research and Portfolio.
- Desktop uses a persistent workspace sidebar and shared top bar. Mobile uses a fixed four-item bottom bar with a content safe area.
- Screen headers, tab rails, buttons, form fields, evidence cards, status badges, empty states and disclosure panels share spacing, border and surface rules.
- Research keeps Ask FINN, Financials, Commitments and Bull vs bear together; source discovery, explicit import, upload and library management are in the secondary Sources section.
- Alert trigger settings are behind a disclosure; their values, OR semantics and save API are unchanged.
- Charts and portfolio values continue to use existing backend data and ledger calculations.

## Responsive behavior

- Desktop browser review: 1440 × 1000.
- Phone viewport review: 390 × 844.
- At phone width, Research and Alerts use document scrolling rather than clipped inner scroll areas; the alert metadata collapses into one column to avoid horizontal overflow.
- Holdings and watchlist rows use stacked layouts. Financial tables keep a minimum readable row width and can scroll within their own table region.
- The bottom navigation stays fixed and page content reserves space below it.
- Reduced-motion preferences are honored.

## Accessibility and trust

- Existing semantic buttons, form labels, active tab state, live status messages and dialog labels are preserved.
- Keyboard focus remains visible through the existing focus treatment.
- Unavailable values stay unavailable; stale or partial market data keeps its freshness context.
- The UI does not add unsupported company summaries, AI confidence, financial values or citations.
- Imported documents can only be initiated after explicit selection and a verified candidate status.

## Implementation files

- `frontend/src/phase4.css` supplies the Phase 4 shared visual and responsive layer.
- `frontend/src/theme.css` holds the approved palette tokens.
- `frontend/index.html` sets the dark browser theme color.
- `frontend/src/App.tsx` retains the existing route and feature workflows while arranging screen content.
- `frontend/src/components/research/SourceDiscovery.tsx` provides discovery, explicit import and import status/retry.
- `frontend/src/services/aiApi.ts` adds typed helpers for existing discovery/import routes only.
