# FINN — Full Product Revision Backlog

This document consolidates the product reviews for Home, Alerts, Research, and Portfolio. FINN is being developed as a mobile-first investor application. The list is a planning record; priorities below are proposed for the eventual full revision and do not authorize implementing features one by one.

## Product principles

- Keep the phone experience primary: clear sub-panels, reachable controls, safe-area-aware bottom navigation, readable financial data, and touch-sized actions.
- Preserve the navy and ivory visual identity, serif section headings, restrained orange accents, and consistent component behavior across modules.
- Keep unavailable, stale, illustrative, and manually entered data visibly distinct. Never create synthetic historical returns to fill a chart.
- Keep daily P&L separate from unrealized P&L. Both can be true at the same time.
- Cite material research claims to source documents and exact pages. Distinguish management statements from FINN interpretation.
- Do not infer diversification from sector count alone or imply evidence quality from document count alone.

## Current product foundation

- **Home:** Portfolio and watchlist summaries, daily portfolio data, latest filing, and current-holdings historical valuation are present. The historical valuation uses today's share quantities and is not actual historical account performance.
- **Alerts:** A unified feed supports company filings and market signals, categories, severity, source links, threshold explanations, and read state. Price and volume conditions can trigger independently; market calculations use completed sessions and available data.
- **Research:** Ask FINN and Bull vs Bear retrieve source pages; citation checks can withhold generated synthesis and explain failure types. Financial comparisons support consolidated/standalone and reported/adjusted figures, trends and margins. Commitments track revisions and comparable outcomes. The document library supports source management and a shared, source-linked financial evidence store.
- **Portfolio:** Holdings support quantities and average cost with market value, invested cost, daily P&L, unrealized P&L, sector exposure, concentration measures, and a watchlist of tracked companies.

These are the current prototype capabilities, not a claim that the data providers or calculations have been independently audited.

## Proposed priorities

### P0 — Trust, data integrity, and portfolio accounting

1. **Transaction history and realized P&L**
   - Record buys and sells as individual transactions with date, quantity, price, fees, and source or user-entry provenance.
   - Define and display the cost-basis method before calculating realized and unrealized P&L.
   - Reconcile transaction totals to current holdings; retain transaction history when a holding is edited or removed.

2. **Accurate historical portfolio performance**
   - Keep the existing “current holdings historical valuation” view explicitly labeled as today's quantities applied to past prices.
   - Add actual account performance only after transaction dates, purchases, sales, cash flows, and dividends are represented.
   - Choose and disclose a return methodology that handles external cash flows consistently. Never present the current-quantity reconstruction as actual account history.

3. **Price freshness and provenance**
   - Show market-data provider, last successful update time, exchange session date, and stale/unavailable state wherever prices affect totals or alerts.
   - Define stale-data thresholds and behavior for partial provider outages; do not silently reuse old prices as current.

4. **Financial evidence and source integrity**
   - Keep a common source-document → extracted/saved evidence → Financials, Commitments, and Bull vs Bear flow.
   - Preserve metric, value, unit, period, reporting basis, reported/adjusted definition, source page, and excerpt.
   - Continue exposing citation verification failures by source, page mapping, or unsupported claim, and withhold unverified synthesis.
   - Make manual entry explicit until a validated extraction workflow exists. Do not label manually entered values as automatically extracted.

5. **Alert correctness**
   - Do not generate signals with missing inputs, incomplete sessions, or market holidays.
   - Suppress duplicates by company, signal type, and trading session; distinguish corporate filing ingestion from market-signal ingestion.
   - Show last successful update and preserve original exchange links and filing timestamps.

### P1 — Core investor intelligence

1. **NIFTY 50 benchmark comparison** with the selected period, return methodology, source, and coverage visible.
2. **Risk analytics:** volatility, drawdown, and concentration alongside sector and individual-stock exposure; explain inputs and sample window.
3. **Watchlist price alerts** for target-price crossings, with configurable direction, threshold, and notification/read history.
4. **Company detail and fundamentals** from cited sources, with reporting period, consolidated/standalone basis, units, and stale/missing fields made clear.
5. **Research quality and missing-data workflow:** historical-input prompts, consistent quarter definitions, zero/negative comparison handling, and visible distinction between evidence coverage and evidence independence/quality.
6. **Management-guidance track record:** retain revisions and use explicit achieved/exceeded/missed/pending/not-comparable rules; missing actuals must never count as misses.

### P2 — Portfolio organization and reporting

1. **Watchlist categories** for long-term and short-term ideas, plus manage/remove tracked companies.
2. **Quick add to holdings** from a watchlist row while preserving the distinction between a tracked company and an owned position.
3. **Dividends and corporate actions:** track dividend events and account for splits and bonus issues in quantities and cost basis before showing adjusted returns.
4. **Portfolio report export** with clear as-of date, data source, holdings, transactions, realized/unrealized P&L, and methodology notes.
5. **Asset allocation** across supported asset classes (for example, equities and cash) only when those assets are actually represented in the account data; do not imply a complete allocation from an equity-only holdings list.

## Module-specific review notes

### Home

- Keep the portfolio performance card directly below the KPI cards and compact when historical data is unavailable.
- Show eligible holding count and provide a historical-price coverage detail view; do not invent history.
- Make KPI definitions clear. In particular, distinguish portfolio positions, priced positions, tracked-company coverage, daily P&L, and unrealized P&L.
- Preserve the latest filing card and its source link.

### Alerts

- Keep a unified feed with separate filing and market-signal categories, clear priority, source, event time, and read/unread state.
- State trigger logic in plain language. Price is compared with the previous completed close; volume is compared with the prior 20 completed sessions; either configured condition may independently trigger an alert.
- Keep filing categories, original exchange source links, duplicate suppression, historical alert tracking, and freshness visible.

### Research

- **Ask FINN:** searchable/filterable document library, upload validation and duplicate detection, replace/re-index/delete flows, exact PDF-page links, supporting excerpts, and explicit distinction between management statements and FINN interpretation.
- **Verification:** list each failed citation and why. Evidence coverage (documents/pages/types) must not be presented as evidence quality; flag repeated text or common source domains as heuristic signals only.
- **Financials:** preserve basis and figure-type distinctions, show trends over four/eight quarters, margins and percentage-point changes, and identify missing comparison-period inputs. Verify entered figure-to-page mappings.
- **Commitments:** retain revisions and exact guidance quotes; define tolerance for achieved versus exceeded; use pending before period end and not comparable for incompatible definitions/basis.
- **Bull vs Bear:** support the bull case, bear case, final assessment, assumptions, valuation inputs, catalysts, unresolved questions, and source-linked claims. Do not manufacture symmetry when evidence supports only one side.
- **Document management:** show version history and Pending/Processing/Indexed/Failed status. Warn when deleting a source with linked financial figures, guidance, or citations.

### Portfolio and Watchlist

- Keep invested cost, market value, today's P&L, and unrealized P&L as distinct values with visible definitions.
- Move from average-cost-only edits toward transaction-based accounting and realized P&L.
- Preserve sector allocation and stock-level concentration; add risk and benchmark views when their inputs are reliable.
- Sector allocation and stock concentration are already started. NIFTY 50 benchmark comparison, risk/volatility analytics, realized P&L, dividend tracking, and broader asset allocation remain gaps at this review stage; realized P&L is P0, benchmark/risk are P1, and dividend/asset allocation are P2 in the proposed priorities above.
- Add watchlist price alerts, categories, company details, historical return ranges (1W/1M/3M/1Y), quick add to holdings, and watchlist management.
- Clearly separate current-holdings historical valuation from transaction-aware account performance.

## Architecture decisions for the full revision

Resolve these together before implementation:

- **Persistence and ownership:** browser-local prototype storage versus durable user accounts and server-side portfolio/transaction storage.
- **Portfolio ledger:** transaction schema, cost-basis method, fees/taxes, cash flows, corporate actions, dividends, and correction/audit history.
- **Performance methodology:** time-weighted versus money-weighted returns, treatment of deposits/withdrawals, benchmark dates, and partial price coverage.
- **Market data:** provider terms, delayed/live status, exchange calendars, stale-price rules, and fallback behavior.
- **Financial evidence:** common canonical metric definitions, units/scales, company period/basis model, manual versus extracted values, and document version dependencies.
- **Alerts:** ingestion schedule, session/holiday calendar, duplicate keys, retention, notification channel, and read-state ownership.
- **Mobile delivery:** responsive web/PWA versus a packaged native app, offline behavior, push notification requirements, and secure local data handling.

## Suggested revision sequence

1. Agree on persistence, accounting, data-source, and return-method decisions.
2. Define canonical transaction, portfolio-snapshot, market-price, financial-evidence, and alert records.
3. Validate existing calculations and sample data against those definitions.
4. Design and review the complete mobile flows across Home, Alerts, Research, and Portfolio.
5. Implement the P0 accounting and data-integrity foundation before layering on P1/P2 features.
