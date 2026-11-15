# FINN Alerts Audit and Implementation Report

Date: 15 November 2026

## Executive result

The Alerts screen now reads its summary, seven-day trend, category distribution and feed from the same persisted alert history. The sidebar badge now means unread persisted alerts across the stored history. It no longer adds current snapshot triggers to in-memory high-priority announcements.

On the live local application during verification:

- Market data: 20/20 tracked companies available; latest completed session 13 November 2026.
- NSE: live provider available; 0 filings returned for the last 24 hours.
- Persisted alerts: 0 in the last 24 hours; 14 in the last seven days (9 price movements, 5 volume spikes, 0 filings).
- Seven-day chart: 5 events on 12 November, 9 on 13 November, and zero on the other five displayed India-time dates.
- Unread: 10 across stored history; 9 inside the selected seven-day window.
- Example preserved from actual history: SBI volume was 1.13× the prior 20-session average against a 1.10× trigger.

These counts are live observations, not hardcoded UI values.

## Audit and root cause

### Frontend

- The sidebar badge was `portfolio.alert_count + high-priority rows in the currently loaded announcements response`.
- `portfolio.alert_count` represents market triggers from the latest portfolio snapshot. It is neither a history count nor an unread count, and it has no selected-window filter.
- The feed separately called `GET /api/alerts/history?window_hours=24` on initial load and counted only returned persisted rows.
- The resulting badge and feed measured different records and different periods. A market snapshot from the last completed Friday session remained in the badge on Sunday, while the 24-hour feed correctly excluded events older than its cutoff. The screenshot's 9 was therefore not a count of the feed's persisted last-24-hour alerts.
- A second frontend bug could leave the feed showing the wrong range: `loadAnnouncements()` also initiated alert-history loading. A late 24-hour announcement response could start a second 24-hour history request after the user selected seven days. The last response won, regardless of the user's latest selection.

### Backend

- `GET /api/portfolio` requests completed daily quote rows and generates market events. It uses unadjusted daily close prices, excludes weekends and an in-progress current session, compares the final close with the previous completed close, and compares final volume with the previous 20 completed sessions.
- The settings retain OR semantics: either the absolute daily percentage threshold or the volume multiple can create a signal. Missing price/volume values do not create a signal.
- `_market_alert_events` creates stable IDs from ticker, signal type and session date. `_upsert_alert_history` deduplicates by ID, preserves read status and first-seen time, and atomically replaces the JSON history file.
- NSE announcements are fetched through the existing NSE client, classified by the existing processor, and upserted into the same alert history. Their source links are retained.
- `GET /api/alerts/history` previously used a lower time bound only, sorted ISO timestamp strings lexically, and treated timestamp-without-offset values as UTC. It could include future-dated records and mishandle ordering when timestamps used different offsets.
- Alert storage is `data/alert_history.json`; this project does not use a database for alert history. A process-local lock protects concurrent threads within one process.
- There is no scheduled background alert-generation job. Generation is request-triggered by portfolio refresh/quote retrieval and the announcement feed request. We kept that existing architecture rather than adding an in-process scheduler that could run more than once across server workers.

## Changes made

### Backend

- Added UTC timestamp parsing and a shared time-window selector with inclusive lower bound and an upper bound at the current instant. Malformed timestamps are ignored; existing offset-free records retain their established UTC interpretation.
- Sorts alerts by parsed instants rather than string representation.
- Added `GET /api/alerts/summary?window_hours=...`, returning selected-window totals, unread/high-priority counts, filing/price/volume counts, seven India-time daily trend points and market coverage/freshness.
- Kept `GET /api/alerts/history` compatible and added `total_count`, selected-window `unread_count`, all-history `all_unread_count`, and its summary object.
- Read/unread remains persisted through the existing `PUT /api/alerts/read` endpoint.
- No portfolio accounting, Research, announcement classification, threshold settings, or other API contracts were changed.

### Frontend

- The sidebar now displays unread alerts from persisted history, not the separate portfolio snapshot counter.
- Added four real-data summary cards: Total Alerts, High Priority, Price Moves and Volume Spikes.
- Added a seven-day IST event chart and category proportions for the selected period.
- Retained the existing 24-hour, 7-day and 30-day filters, filing/price/volume categories, unread-only filter, thresholds, source links, read/unread, refresh and company Research actions.
- Added stale-request protection so a late request cannot replace a newer selected period.
- Fixed a mobile CSS grid that placed alert content in a 28-pixel column after hiding the status rail.
- Added the FINN SVG favicon, eliminating the browser's prior `/favicon.ico` 404 during UI checks.
- Styling remains black and lime and supports reduced-motion preferences already present in the app.

### Files changed for Alerts

- `backend/app/main.py`
- `backend/tests/test_alert_history.py` (new)
- `frontend/src/App.tsx`
- `frontend/src/phase4.css`
- `frontend/index.html`
- `frontend/public/favicon.svg` (new)
- `docs/alerts-implementation-report.md` (this report)
- `docs/screenshots/alerts-mobile.png` (390 × 844)
- `docs/screenshots/alerts-desktop.png` (1440 × 1000)

## API examples

`GET /api/alerts/history?window_hours=24` returns the actual selected-period records. During verification it returned `total_count: 0` and `unread_count: 0`, which matched the source data on Sunday after Friday's latest market session.

`GET /api/alerts/history?window_hours=168` returned `total_count: 14`, `unread_count: 9`, with 9 price moves and 5 volume spikes.

`GET /api/alerts/summary?window_hours=168` returned the same seven-day totals and seven India-time trend buckets, plus source freshness and market company coverage.

`PUT /api/alerts/read` remains `{ "id": "<persisted-alert-id>", "is_read": true|false }` and updates the JSON store.

## Verification

- New alert tests: 6 passed. They cover UTC window boundaries, future/malformed timestamp exclusion, IST trend bucketing, category and unread counts, duplicate upserts/read-state preservation, price/volume calculations using exactly the prior 20 completed sessions, and persistence of generated threshold events.
- Full backend suite: 106 passed, 1 warning, 17.07 seconds. The warning is an upstream Starlette/httpx deprecation notice.
- Frontend typecheck and production build: passed (`npm run check`).
- Browser at 390 × 844: 14 seven-day records, 7 chart points, 390-pixel document width; the 24-hour filter showed 0 and the empty state; switching back to seven days restored 14; Volume Spikes showed 5.
- Browser at 1440 × 1000: 14 cards and 1440-pixel document width.
- Browser console: no application or API errors after adding the favicon. No failed requests.
- Manual endpoint observation: live market provider returned 20/20 companies; live NSE endpoint returned 0 filings in the 24-hour range. The latest session and provider update time were visible in the UI.
- Screenshots are captured at the requested mobile and desktop viewport sizes.

## Completion classification

| Capability | Status | Evidence / limitation |
|---|---|---|
| Persisted market alert generation | Verified | Live portfolio snapshot and persisted market history; unit test verifies generated event. |
| Price movement calculation | Verified | Final completed close versus previous completed close; test verifies 10.0% calculation. |
| Volume ratio | Verified | Uses exactly 20 previous completed sessions; test verifies 1.30× and history includes SBI 1.13× versus 1.10× threshold. |
| OR threshold semantics | Verified | Independent price or volume threshold event generation retained. |
| Duplicate prevention | Verified | Stable ticker/type/session ID plus idempotent upsert test. |
| Read/unread persistence | Verified | Existing update endpoint and file-backed persistence test. |
| Correct period/time-zone filtering | Verified | UTC instant filtering, future bound, IST trend dates and browser period/filter checks. |
| NSE ingestion/classification | Partially implemented | Existing NSE client and classifier reused; live provider returned successfully with no 24-hour filings. There is no BSE provider in the current Alerts path. |
| Priority/source-backed feed | Verified for available rows | Real persisted alert priority and source URLs are shown; no filing means no filing card in this sample. |
| Background scheduling | Missing | Refresh is request-triggered; no periodic worker is configured. |
| Restart persistence | Partially verified | JSON file survives a process restart if the filesystem is retained. No deployment restart was run during this task. Render ephemeral storage can discard local files on replacement unless a persistent disk is mounted. |
| Cross-process coordination | Partially implemented | Thread lock is process-local; multiple workers sharing one JSON file are not coordinated. |

## Remaining limitations

- There is no scheduled background polling, so data refresh depends on opening or refreshing the relevant workflow.
- The existing alert store is a JSON file. Persistent deployment storage must be configured to retain it across Render instance replacement; multi-worker file coordination is not provided.
- The existing announcement flow is NSE-based. BSE coverage is unavailable in this alert pipeline and should be surfaced as unsupported rather than implied coverage.
- Market links point to the Yahoo Finance quote source; NSE filing rows retain their exchange filing links. Alert cards do not claim that market signals were caused by a filing.
