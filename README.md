# FINN — AI Investment Intelligence Agent

A mobile-first prototype for portfolio intelligence and evidence-grounded company research. The first working slice loads the demo portfolio, fetches daily price and volume history through yfinance, computes daily changes and unusual-volume signals deterministically, and reports unavailable data without filling it with demo numbers.

The company universe is a watchlist, not a set of assumed holdings. Add your actual share quantities and average buy prices in the Holdings section to calculate invested capital, market value, daily P&L, and unrealized P&L. These position inputs are saved in this browser's local storage.

## Product premise

FINN has two workflows:

- **Push:** monitor a selected portfolio, prioritize company developments, and explain why an event may matter.
- **Pull:** research an NSE-listed company using primary-source documents, with citations attached to claims.

The demo universe is a product-testing set, not an investment recommendation.

## Demo universe

20 companies across 11 sectors are listed in `data/portfolio.json`. Research-only examples are Adani Enterprises, Titan, Trent, Bajaj Finance, and Coal India. The checked-in research bundle includes official annual reports for Titan, Trent, and Bajaj Finance, plus quarterly releases and an investor presentation for Reliance. Each seeded document keeps its original source URL in `data/reports/documents.json`.

## Repository layout

- `frontend/` — React + TypeScript + Vite mobile-first app shell.
- `backend/` — FastAPI app with market data, NSE announcements, thresholds, and source-grounded PDF research.
- `data/portfolio.json` — demo companies and sectors.
- `docs/decisions.md` — initial product and engineering decisions.

## Run locally

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite listens on the local network for phone testing. Keep the computer and phone on the same Wi-Fi, then open the `Network` URL printed by Vite on the phone (for example, `http://192.168.1.20:5173`). The API remains on the computer and is reached through Vite's `/api` proxy. If Windows Firewall asks, allow Node/Vite on **Private networks**.

### Backend

```bash
cd backend
# Use Python 3.11 or newer.
# Windows PowerShell (Python 3.11):
py -3.11 -m venv .venv311
.\.venv311\Scripts\python.exe -m pip install -r requirements.txt
.\.venv311\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# macOS/Linux:
# .venv/bin/python -m pip install -r requirements.txt
# .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The dashboard calls `GET /api/portfolio`. The API refreshes market data at most once every five minutes unless a manual refresh is requested. Volume and daily price thresholds are configurable in the UI; calculations run in Python. A market session in progress is not scored for volume anomalies. Alerts pair the observed price and volume move with an explicit note that no cause is established. `GET /api/announcements` fetches portfolio filings from NSE, classifies and ranks them with deterministic category rules, and links to the exchange source. The 30-day demo window includes one dated, source-linked Reliance NSE filing so Push can be demonstrated when the live query has no matching portfolio items; the card is labelled as a verified example. Importance scores are prototype heuristics, not calibrated financial standards. The announcement window can be set to 24 hours, 7 days, or 30 days; an empty window is labelled with its time range.

The 20-company tracked universe is separate from actual holdings. The holdings screen lets a presenter add clearly marked synthetic demo positions until the view contains at least 15 positions; these are stored in that browser's local storage and can be edited or removed. They must not be presented as real investor holdings.

Research accepts uploaded text-searchable primary-source PDFs up to 45 MB for any NSE ticker (not only the 20-company tracked universe), including annual reports, quarterly results, and earnings-call transcripts. It extracts pages separately, uses layout-aware PDF text extraction, separates likely table rows from narrative text, normalizes common spacing and encoding artifacts, and retrieves relevant pages with document, period, page, and passage citations. Seeded documents and financial rows are included for a ready-to-run research demonstration. Ask FINN source citations link to the original company or exchange PDF at the cited page. Without a model, Ask FINN returns locally selected source sentences and labels them as extractive evidence; it also states when it cannot isolate a direct answer. This is not equivalent to natural-language model synthesis. With `OPENROUTER_API_KEY` configured, FINN uses the OpenRouter-compatible endpoint and verifies generated citation IDs before displaying the answer. An optional Ollama provider can run a local model without a hosted API key when Ollama and a model are installed.

### Company research workflow

1. Upload an annual report, quarterly-results filing, investor presentation, or concall transcript as a text-searchable PDF. Enter the company's NSE ticker; the research workflow is not limited to the 20-company demo universe.
2. Ask a question. FINN retrieves relevant pages from the selected primary source and shows the exact page and passage. With no model configured, the answer is extractive and may omit context. For an LLM-generated synthesis, configure OpenAI or the optional Ollama provider below.
3. For quarterly comparisons, transcribe reported Revenue, EBITDA, PBT, and PAT from the filing, along with the period, unit, and source page/passage. FINN calculates QoQ and YoY changes from quarters entered for that ticker. The Reliance demo includes four consecutive quarters and their matching year-ago values, with all four metrics and linked primary-source citations. The comparison deliberately uses the company's consolidated Gross Revenue line. FINN does not yet extract financial tables automatically. The comparison cells explicitly distinguish missing prior-period data, unit mismatches, and non-positive comparison bases; unlike units are not compared.
4. For management-promise tracking, record an explicit target, period, unit, and cited management quote. The Reliance demo includes a cited O2C annualized EBITDA benchmark from its Q2 FY27 presentation and computes a comparable H1 run rate from reported Q1 and Q2 segment EBITDA. New commitments can also be entered manually; FINN labels the commitment met, above, or below guidance when its actual period is available. Guidance extraction remains manual.
5. Bull vs bear retrieves evidence pages across uploaded documents for the selected ticker. Without an API key, FINN reports directional quarter trends and source topics matched by local rules, with citations. With the key it can add a cited model synthesis.

Uploads, extracted page text, research figures, commitments, and alert thresholds are stored locally under `data/`. Automatic discovery/download of annual reports or concall transcripts, scanned-PDF OCR, outbound notifications, and automatic quarterly/guidance extraction are not implemented. NSE and Yahoo Finance access are best-effort and can fail or return incomplete data. Review their data-provider usage terms before using this beyond a personal prototype.

## AI configuration

Copy `backend/.env.example` to `backend/.env`. OpenRouter is the configured hosted provider: set `OPENROUTER_API_KEY` and keep `FINN_OPENROUTER_MODEL=openrouter/auto` to let its Auto router select a model. FINN calls OpenRouter's OpenAI-compatible chat completions endpoint. The routed model and its use are subject to OpenRouter account pricing and limits. If both OpenRouter and OpenAI keys are set, OpenRouter takes precedence. Direct OpenAI remains available through `OPENAI_API_KEY` and `FINN_OPENAI_MODEL`. For local synthesis without a hosted API key, install Ollama, pull a model, then set `FINN_LLM_PROVIDER=ollama`, `FINN_OLLAMA_BASE_URL=http://127.0.0.1:11434`, and `FINN_OLLAMA_MODEL` to the exact installed model tag. Never commit `backend/.env`.

## Deploy to Render

The repository includes a Render Blueprint (`render.yaml`) and a multi-stage Dockerfile. The single web service serves the built React app and FastAPI API from the same origin, so browser API calls need no separate CORS or frontend URL configuration. In Render, create a new Blueprint from this repository and select the `main` branch. Set `OPENROUTER_API_KEY` in the Blueprint prompt or service environment settings; the app still runs its local evidence workflow if the key is omitted. Rotate any key previously pasted into chat before adding it to Render.

The Blueprint uses Render's free web-service plan for a low-cost demo. Free services can sleep while idle, and their filesystem is ephemeral: uploaded PDFs and newly entered research/commitment data can be lost after a restart or redeploy. The seeded reports are included in the image and return on each deploy. For retained uploads and edits, switch to a paid web service and attach a persistent disk, then configure the app's data paths to use that disk before relying on it for saved user data.
