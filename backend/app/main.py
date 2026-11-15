import json
import logging
import math
import os
import re
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from threading import Lock
from zoneinfo import ZoneInfo

import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from app.services.announcements.nse_client import fetch_portfolio_announcements
from app.services.announcements.processor import classify_announcement, explain_with_rules
from app.services.intelligence.openai_service import ai_is_enabled, ai_provider_name, generate_text
from app.services.intelligence.orchestrator import interpret_evidence
from app.services.research.documents import STOPWORDS, WORD_RE, add_pdf, list_documents, remove_document, reindex_document, retrieve_pages, retrieve_ticker_pages, UPLOADS_DIR, validate_page_excerpt
from app.services.research.engine import synthesize_research_answer, verify_generated_claims as _verify_generated_claims
from app.services.research.financials import add_promise, add_quarter, document_dependencies, list_financial_evidence, list_promises, quarterly_comparisons, remove_document_records
from app.services.discovery.api import router as discovery_router
from app.services.research.import_api import router as import_router
from app.services.research.import_service import import_service

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")

@asynccontextmanager
async def _lifespan(_app):
    try:
        recovery = import_service.recover_after_restart()
        if any(recovery.values()):
            logging.getLogger("finn").warning("research_import_startup_recovery %s", recovery)
    except Exception as exc:
        logging.getLogger("finn").error("research_import_startup_recovery_failed error_type=%s", type(exc).__name__)
    yield


app = FastAPI(title="FINN API", version="0.1.0", description="Portfolio intelligence and evidence-grounded research", lifespan=_lifespan)
logger = logging.getLogger("finn")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(discovery_router)
app.include_router(import_router)

PORTFOLIO_PATH = ROOT / "data" / "portfolio.json"
SETTINGS_PATH = ROOT / "data" / "alert_settings.json"
ALERT_HISTORY_PATH = ROOT / "data" / "alert_history.json"
_snapshot_cache: dict = {"expires_at": 0.0, "payload": None}
_history_cache: dict = {"expires_at": 0.0, "key": None, "payload": None}
_cache_lock = Lock()
_settings_lock = Lock()
_alert_history_lock = Lock()


class AlertSettings(BaseModel):
    volume_multiple: float = Field(default=1.3, ge=1.1, le=10)
    price_move_pct: float = Field(default=4.0, ge=0.5, le=25)


class AlertReadUpdate(BaseModel):
    id: str = Field(min_length=1, max_length=500)
    is_read: bool


class AnnouncementInput(BaseModel):
    company: str = Field(max_length=160)
    ticker: str = Field(max_length=32)
    subject: str = Field(max_length=500)
    details: str = Field(max_length=2000, default="")
    category: str = Field(max_length=40)
    importance: int = Field(ge=0, le=100)
    source_url: str = Field(max_length=1000)


class MarketAlertInput(BaseModel):
    ticker: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9&.-]+\.(NS|BO)$")


class ResearchQuestion(BaseModel):
    document_id: str | None = Field(default=None, min_length=1, max_length=64)
    ticker: str | None = Field(default=None, min_length=1, max_length=32)
    question: str = Field(min_length=5, max_length=500)

    @model_validator(mode="after")
    def validate_scope(self):
        if bool(self.document_id) == bool(self.ticker):
            raise ValueError("Choose either one source document or all indexed sources for a company.")
        return self


class QuarterlyEntry(BaseModel):
    document_id: str = Field(min_length=1, max_length=64)
    ticker: str = Field(min_length=1, max_length=32)
    period: str = Field(min_length=8, max_length=16)
    unit: str = Field(min_length=1, max_length=24)
    page: int = Field(ge=1)
    excerpt: str = Field(min_length=10, max_length=1200)
    values: dict[str, float | None]
    statement_basis: str = "consolidated"
    figure_type: str = "reported"
    adjustment_note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_values(self):
        allowed = {"revenue", "ebitda", "pbt", "pat", "o2c_ebitda"}
        if not self.values or set(self.values) - allowed:
            raise ValueError("Enter one or more supported financial metrics.")
        if any(value is not None and not math.isfinite(value) for value in self.values.values()):
            raise ValueError("Financial values must be finite numbers.")
        return self


class GuidanceEntry(BaseModel):
    document_id: str = Field(min_length=1, max_length=64)
    ticker: str = Field(min_length=1, max_length=32)
    metric: str = Field(min_length=3, max_length=32)
    target_period: str = Field(min_length=8, max_length=16)
    target_value: float = Field(allow_inf_nan=False)
    unit: str = Field(min_length=1, max_length=24)
    page: int = Field(ge=1)
    quote: str = Field(min_length=10, max_length=1200)
    statement_basis: str = "consolidated"
    figure_type: str = "reported"
    adjustment_note: str = Field(default="", max_length=500)


class BullBearRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=32)


class PortfolioIntelligenceHolding(BaseModel):
    ticker: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9&.-]+\.(NS|BO)$")
    company: str = Field(min_length=1, max_length=120)
    sector: str = Field(default="Unclassified", max_length=80)
    weight_pct: float = Field(ge=0, le=100, allow_inf_nan=False)
    daily_change_pct: float | None = Field(default=None, ge=-100, le=1000, allow_inf_nan=False)
    session_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class PortfolioIntelligenceMetrics(BaseModel):
    market_value: float = Field(ge=0, allow_inf_nan=False)
    daily_pnl: float = Field(allow_inf_nan=False)
    unrealized_pnl: float = Field(allow_inf_nan=False)
    largest_sector: str | None = Field(default=None, max_length=80)
    largest_sector_pct: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    top_three_sector_pct: float | None = Field(default=None, ge=0, le=300, allow_inf_nan=False)
    stock_hhi: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)
    sector_count: int = Field(ge=0, le=100)
    volatility_pct: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)
    max_drawdown_pct: float | None = Field(default=None, ge=-100, le=0, allow_inf_nan=False)
    account_return_pct: float | None = Field(default=None, ge=-100, le=10000, allow_inf_nan=False)
    benchmark_return_pct: float | None = Field(default=None, ge=-100, le=10000, allow_inf_nan=False)


class HoldingCorrelation(BaseModel):
    ticker_a: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9&.-]+\.(NS|BO)$")
    ticker_b: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9&.-]+\.(NS|BO)$")
    company_a: str = Field(min_length=1, max_length=120)
    company_b: str = Field(min_length=1, max_length=120)
    correlation: float = Field(ge=-1, le=1, allow_inf_nan=False)
    observations: int = Field(ge=20, le=2000)
    from_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    to_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class PortfolioIntelligenceRequest(BaseModel):
    question: str = Field(default="What are the main portfolio risks and changes to review?", min_length=5, max_length=500)
    as_of_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    priced_holding_count: int = Field(ge=0, le=100)
    total_holding_count: int = Field(ge=0, le=100)
    metrics: PortfolioIntelligenceMetrics
    holdings: list[PortfolioIntelligenceHolding] = Field(max_length=30)
    correlations: list[HoldingCorrelation] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def validate_weights_and_coverage(self):
        if len(self.holdings) > self.total_holding_count or self.total_holding_count < self.priced_holding_count:
            raise ValueError("Portfolio holding coverage counts are inconsistent.")
        if self.holdings and not 98 <= sum(item.weight_pct for item in self.holdings) <= 102:
            raise ValueError("Priced holding weights must total approximately 100%.")
        return self


class BriefingCompany(BaseModel):
    ticker: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9&.-]+\.(NS|BO)$")
    company: str = Field(min_length=1, max_length=120)
    sector: str = Field(default="Unclassified", max_length=80)


class IntelligenceBriefingRequest(BaseModel):
    companies: list[BriefingCompany] = Field(max_length=20)
    window_hours: int = Field(default=24, ge=1, le=168)


class ResearchCompareRequest(BaseModel):
    tickers: list[str] = Field(min_length=2, max_length=4)
    statement_basis: str = Field(default="consolidated", pattern="^(consolidated|standalone)$")
    figure_type: str = Field(default="reported", pattern="^(reported|adjusted)$")
    adjustment_note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_tickers(self):
        normalized = [ticker.strip().upper() for ticker in self.tickers]
        if len(set(normalized)) != len(normalized) or any(not re.fullmatch(r"[A-Z0-9&.-]{1,15}\.(?:NS|BO)", ticker) for ticker in normalized):
            raise ValueError("Choose two to four distinct Indian exchange tickers.")
        if self.figure_type == "adjusted" and not self.adjustment_note.strip():
            raise ValueError("Adjusted comparisons require the same explicit adjustment definition.")
        return self


def _validate_research_company(company: str, ticker: str) -> str:
    normalized_ticker = ticker.strip().upper()
    normalized_name = re.sub(r"[^a-z0-9]", "", company.lower())
    tracked = next((item for item in _company_universe()["companies"] if item["ticker"].upper() in {normalized_ticker, f"{normalized_ticker}.NS"}), None)
    if tracked:
        expected_name = re.sub(r"[^a-z0-9]", "", tracked["name"].lower())
        if normalized_name != expected_name:
            raise HTTPException(status_code=422, detail=f"Ticker {normalized_ticker} belongs to {tracked['name']}. Check the company and ticker pairing.")
        return tracked["ticker"].upper()
    elif not re.fullmatch(r"[A-Z0-9&.-]{1,32}(?:\.(?:NS|BO))?", normalized_ticker):
        raise HTTPException(status_code=422, detail="Use a valid NSE ticker, such as RELIANCE.NS.")
    return normalized_ticker


def _validate_research_source_url(source_url: str) -> str:
    value = source_url.strip()
    if value:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise HTTPException(status_code=422, detail="Source links must use a valid HTTPS URL.")
    return value


def _company_universe() -> dict:
    with PORTFOLIO_PATH.open(encoding="utf-8") as stream:
        return json.load(stream)


def _get_settings() -> dict:
    default = {"volume_multiple": 1.3, "price_move_pct": 4.0}
    try:
        stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return AlertSettings(**{**default, **stored}).model_dump()
    except (OSError, json.JSONDecodeError, ValueError):
        return default


def _save_settings(settings: AlertSettings) -> dict:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = settings.model_dump()
    with _settings_lock:
        SETTINGS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        _snapshot_cache["expires_at"] = 0.0
    return payload


def _read_alert_history() -> list[dict]:
    try:
        payload = json.loads(ALERT_HISTORY_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _upsert_alert_history(incoming: list[dict]) -> None:
    if not incoming:
        return
    with _alert_history_lock:
        existing = _read_alert_history()
        by_id = {str(row.get("id")): row for row in existing if row.get("id")}
        now = datetime.now(timezone.utc).isoformat()
        for event in incoming:
            alert_id = str(event.get("id", ""))
            if not alert_id:
                continue
            prior = by_id.get(alert_id)
            by_id[alert_id] = {**(prior or {}), **event, "is_read": bool(prior.get("is_read")) if prior else False, "first_seen_at": prior.get("first_seen_at", now) if prior else now}
        ordered = sorted(by_id.values(), key=lambda row: str(row.get("event_at", "")), reverse=True)[:2000]
        ALERT_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = ALERT_HISTORY_PATH.with_suffix(".tmp")
        temporary_path.write_text(json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary_path.replace(ALERT_HISTORY_PATH)


def _market_alert_events(companies: list[dict]) -> list[dict]:
    events = []
    for company in companies:
        session = company.get("session_date")
        if not session:
            continue
        for signal in ("unusual_price", "unusual_volume"):
            if not company.get(signal):
                continue
            kind = "price_movement" if signal == "unusual_price" else "volume_spike"
            events.append({
                "id": f"market-{company['ticker']}-{kind}-{session}",
                "kind": "market",
                "signal_type": kind,
                "category": kind,
                "ticker": company["ticker"],
                "company": company["name"],
                "sector": company.get("sector", ""),
                "priority": "high" if kind == "price_movement" else "medium",
                "importance": 85 if kind == "price_movement" else 65,
                "session_date": session,
                "event_at": f"{session}T15:30:00+05:30",
                "change_pct": company.get("change_pct"),
                "price_threshold_pct": company.get("price_threshold_pct"),
                "volume_ratio_20d": company.get("volume_ratio_20d"),
                "volume_threshold": company.get("volume_threshold"),
                "volume": company.get("volume"),
                "average_volume_20d": company.get("average_volume_20d"),
                "price": company.get("price"),
                "previous_close": company.get("previous_close"),
                "source_url": f"https://finance.yahoo.com/quote/{company['ticker']}",
                "source_name": "Yahoo Finance via yfinance",
                "rule_explanation": "Price is compared with the previous completed trading session close." if kind == "price_movement" else "Completed-session volume is compared with the previous 20 completed trading sessions.",
            })
    return events


def _market_snapshot(company: dict, settings: dict) -> dict:
    ticker = company["ticker"]
    checked_at = datetime.now(timezone.utc).isoformat()
    try:
        # Use unadjusted exchange closes for current valuation and daily P&L. Adjusted
        # closes belong in the separate long-range performance series below.
        history = yf.Ticker(ticker).history(period="2mo", interval="1d", auto_adjust=False)
        if not history.empty:
            # Yahoo can occasionally return an invalid weekend daily bar; NSE does not trade on weekends.
            history = history[history.index.dayofweek < 5]
        india_now = datetime.now(ZoneInfo("Asia/Kolkata"))
        session_is_open = india_now.weekday() < 5 and time(9, 15) <= india_now.time().replace(tzinfo=None) < time(15, 30)
        if not history.empty and session_is_open and history.index[-1].date() == india_now.date():
            # Intraday bars are provisional: keep prices and volume alerts on the
            # most recent completed trading session until today's session closes.
            history = history.iloc[:-1]
        if history.empty or "Close" not in history:
            return {**company, "market_status": "unavailable", "checked_at": checked_at, "source_name": "Yahoo Finance via yfinance", "reason": "Yahoo Finance returned no recent price history."}

        valid_history = history.dropna(subset=["Close"])
        prices = valid_history["Close"]
        if len(prices) < 2:
            return {**company, "market_status": "unavailable", "checked_at": checked_at, "source_name": "Yahoo Finance via yfinance", "reason": "Not enough price history to calculate a daily change."}

        last_price = float(prices.iloc[-1])
        previous_price = float(prices.iloc[-2])
        change_pct = ((last_price / previous_price) - 1) * 100 if previous_price else None
        volume = valid_history["Volume"] if "Volume" in valid_history else []
        latest_volume_value = float(volume.iloc[-1]) if len(volume) else float("nan")
        latest_volume = int(latest_volume_value) if math.isfinite(latest_volume_value) else None
        baseline = volume.iloc[-21:-1] if len(volume) >= 21 else []
        avg_volume = float(baseline.mean()) if len(baseline) == 20 and not baseline.isna().any() else None
        volume_ratio = latest_volume / avg_volume if latest_volume is not None and avg_volume else None
        latest_session = valid_history.index[-1].date()

        return {
            **company,
            "market_status": "available",
            "session_date": latest_session.isoformat(),
            "price_updated_at": checked_at,
            "checked_at": checked_at,
            "source_name": "Yahoo Finance via yfinance",
            "currency": "INR",
            "price": round(last_price, 2),
            "previous_close": round(previous_price, 2),
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
            "volume": latest_volume,
            "average_volume_20d": round(avg_volume) if avg_volume is not None else None,
            "volume_ratio_20d": round(volume_ratio, 2) if volume_ratio is not None else None,
            "volume_status": "available" if volume_ratio is not None else "unavailable",
            "volume_threshold": settings["volume_multiple"],
            "price_threshold_pct": settings["price_move_pct"],
            "unusual_volume": bool(volume_ratio is not None and volume_ratio >= settings["volume_multiple"]),
            "unusual_price": bool(change_pct is not None and abs(change_pct) >= settings["price_move_pct"]),
        }
    except Exception:
        return {**company, "market_status": "unavailable", "checked_at": checked_at, "source_name": "Yahoo Finance via yfinance", "reason": "Yahoo Finance could not provide data for this ticker right now."}


def _portfolio_snapshot(force: bool = False) -> dict:
    now = datetime.now(timezone.utc).timestamp()
    with _cache_lock:
        if not force and _snapshot_cache["payload"] is not None and now < _snapshot_cache["expires_at"]:
            return _snapshot_cache["payload"]

    universe = _company_universe()
    settings = _get_settings()
    with ThreadPoolExecutor(max_workers=4) as pool:
        companies = list(pool.map(lambda company: _market_snapshot(company, settings), universe["companies"]))

    market_events = _market_alert_events(companies)
    _upsert_alert_history(market_events)

    alerts = []
    for company in companies:
        alert_types = []
        if company.get("unusual_volume"):
            alert_types.append("unusual_volume")
        if company.get("unusual_price"):
            alert_types.append("unusual_price")
        if alert_types:
            alerts.append({**company, "alert_types": alert_types})

    last_successful_update = datetime.now(timezone.utc).isoformat() if any(company.get("market_status") == "available" for company in companies) else None
    with _cache_lock:
        previous_payload = _snapshot_cache.get("payload")
        if last_successful_update is None and previous_payload:
            last_successful_update = previous_payload.get("last_successful_update")
    payload = {
        "source": "Yahoo Finance via yfinance",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "notice": universe["notice"],
        "companies": companies,
        "settings": settings,
        "available_count": sum(company["market_status"] == "available" for company in companies),
        "alert_count": len(market_events),
        "alerts": alerts,
        "last_successful_update": last_successful_update,
    }
    with _cache_lock:
        _snapshot_cache["payload"] = payload
        _snapshot_cache["expires_at"] = now + 300
    return payload

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "data_mode": "yahoo-finance", "market_data": "best-effort; unavailable values are omitted", "ai_enabled": str(ai_is_enabled()).lower(), "ai_provider": ai_provider_name()}


@app.get("/api/portfolio")
def portfolio(refresh: bool = False) -> dict:
    try:
        return _portfolio_snapshot(force=refresh)
    except (OSError, json.JSONDecodeError):
        raise HTTPException(status_code=500, detail="The portfolio universe could not be loaded.")


@app.get("/api/portfolio/history")
def portfolio_history(tickers: str = Query(min_length=1, max_length=1000), period: str = Query(default="1y", pattern="^(1y|3y|5y)$"), basis: str = Query(default="adjusted", pattern="^(adjusted|raw)$")) -> dict:
    requested = list(dict.fromkeys(value.strip().upper() for value in tickers.split(",") if value.strip()))
    if not requested or len(requested) > 20:
        raise HTTPException(status_code=422, detail="Request between 1 and 20 portfolio tickers.")
    if any(not re.fullmatch(r"[A-Z0-9&.-]{1,15}\.(?:NS|BO)", ticker) for ticker in requested):
        raise HTTPException(status_code=400, detail="Use an Indian exchange ticker ending in .NS or .BO.")

    cache_key = (tuple(sorted(requested)), period, basis)
    now = datetime.now(timezone.utc).timestamp()
    with _cache_lock:
        if _history_cache["key"] == cache_key and now < _history_cache["expires_at"]:
            return _history_cache["payload"]

    def load_history(ticker: str) -> tuple[str, list[dict]]:
        try:
            # The current-holdings chart uses adjusted closes. Transaction-ledger
            # performance uses raw closes and the account's recorded cash dividends.
            frame = yf.Ticker(ticker).history(period=period, interval="1d", auto_adjust=basis == "adjusted")
            if frame.empty or "Close" not in frame:
                return ticker, []
            frame = frame[frame.index.dayofweek < 5]
            closes = frame["Close"].dropna()
            rows = [{"date": point.date().isoformat(), "close": round(float(value), 4)} for point, value in closes.items() if float(value) > 0]
            return ticker, rows
        except Exception:
            logger.exception("Could not load portfolio history for %s", ticker)
            return ticker, []

    with ThreadPoolExecutor(max_workers=4) as pool:
        histories = dict(pool.map(load_history, requested))
    payload = {"histories": histories, "source": "Yahoo Finance via yfinance", "basis": basis, "period": period, "retrieved_at": datetime.now(timezone.utc).isoformat()}
    with _cache_lock:
        _history_cache.update({"key": cache_key, "payload": payload, "expires_at": now + 300})
    return payload


@app.get("/api/portfolio/benchmark")
def portfolio_benchmark(period: str = Query(default="1y", pattern="^(1y|3y|5y)$")) -> dict:
    now = datetime.now(timezone.utc).timestamp()
    cache_key = ("^NSEI", period)
    with _cache_lock:
        cached = _history_cache.get("benchmark")
        if cached and cached.get("key") == cache_key and now < cached.get("expires_at", 0):
            return cached["payload"]
    try:
        frame = yf.Ticker("^NSEI").history(period=period, interval="1d", auto_adjust=True)
        rows = [{"date": point.date().isoformat(), "close": round(float(value), 4)} for point, value in frame["Close"].dropna().items() if float(value) > 0] if not frame.empty and "Close" in frame else []
    except Exception as exc:
        logger.exception("Could not load NIFTY 50 benchmark history")
        raise HTTPException(status_code=502, detail="NIFTY 50 benchmark data is unavailable right now.") from exc
    payload = {"ticker": "^NSEI", "name": "NIFTY 50", "period": period, "history": rows, "source": "Yahoo Finance via yfinance · adjusted closes", "retrieved_at": datetime.now(timezone.utc).isoformat()}
    with _cache_lock:
        _history_cache["benchmark"] = {"key": cache_key, "payload": payload, "expires_at": now + 900}
    return payload


@app.get("/api/portfolio/quotes")
def portfolio_quotes(tickers: str = Query(min_length=1, max_length=1000)) -> dict:
    requested = list(dict.fromkeys(value.strip().upper() for value in tickers.split(",") if value.strip()))
    if not requested or len(requested) > 20 or any(not re.fullmatch(r"[A-Z0-9&.-]{1,15}\.(?:NS|BO)", ticker) for ticker in requested):
        raise HTTPException(status_code=422, detail="Request up to 20 Indian exchange tickers ending in .NS or .BO.")
    universe = {company["ticker"]: company for company in _company_universe()["companies"]}
    companies = [universe.get(ticker, {"name": ticker.removesuffix(".NS").removesuffix(".BO"), "ticker": ticker, "sector": "Unclassified"}) for ticker in requested]
    settings = _get_settings()
    with ThreadPoolExecutor(max_workers=4) as pool:
        values = list(pool.map(lambda company: _market_snapshot(company, settings), companies))
    return {"companies": values, "source": "Yahoo Finance via yfinance", "retrieved_at": datetime.now(timezone.utc).isoformat()}


@app.get("/api/portfolio/fundamentals")
def portfolio_fundamentals(ticker: str = Query(min_length=4, max_length=20, pattern=r"^[A-Za-z0-9&.-]+\.(NS|BO)$")) -> dict:
    normalized = ticker.upper()
    try:
        info = yf.Ticker(normalized).get_info()
        keys = {
            "market_cap": "marketCap", "trailing_pe": "trailingPE", "forward_pe": "forwardPE",
            "price_to_book": "priceToBook", "return_on_equity": "returnOnEquity",
            "revenue_growth": "revenueGrowth", "earnings_growth": "earningsGrowth",
            "debt_to_equity": "debtToEquity", "dividend_yield": "dividendYield",
            "profit_margin": "profitMargins", "sector": "sector", "industry": "industry",
            "currency": "currency", "company_name": "longName",
        }
        values = {key: info.get(provider_key) for key, provider_key in keys.items()}
        for key, value in list(values.items()):
            if isinstance(value, float) and not math.isfinite(value):
                values[key] = None
        return {"ticker": normalized, "metrics": values, "source": "Yahoo Finance company profile and statistics", "retrieved_at": datetime.now(timezone.utc).isoformat(), "notice": "Provider estimates and reported ratios may be delayed or incomplete. Review primary filings before relying on a figure."}
    except Exception as exc:
        logger.exception("Could not load fundamentals for %s", normalized)
        raise HTTPException(status_code=502, detail="Company fundamentals are unavailable right now.") from exc


@app.get("/api/alerts/history")
def alert_history(window_hours: int = Query(default=720, ge=1, le=8760)) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    with _alert_history_lock:
        events = _read_alert_history()
    visible = []
    for event in events:
        try:
            event_time = datetime.fromisoformat(str(event.get("event_at", "")).replace("Z", "+00:00"))
            if event_time.tzinfo is None:
                event_time = event_time.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if event_time.astimezone(timezone.utc) >= cutoff:
            visible.append(event)
    visible.sort(key=lambda event: str(event.get("event_at", "")), reverse=True)
    cached_payload = _snapshot_cache.get("payload")
    return {"alerts": visible, "window_hours": window_hours, "last_successful_market_update": cached_payload.get("last_successful_update") if cached_payload else None}


@app.put("/api/alerts/read")
def update_alert_read_status(update: AlertReadUpdate) -> dict:
    with _alert_history_lock:
        events = _read_alert_history()
        found = False
        for event in events:
            if event.get("id") == update.id:
                event["is_read"] = update.is_read
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Alert not found in local history.")
        ALERT_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = ALERT_HISTORY_PATH.with_suffix(".tmp")
        temporary_path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary_path.replace(ALERT_HISTORY_PATH)
    return {"id": update.id, "is_read": update.is_read}


@app.get("/api/settings/alerts")
def get_alert_settings() -> dict:
    return _get_settings()


@app.put("/api/settings/alerts")
def update_alert_settings(settings: AlertSettings) -> dict:
    return _save_settings(settings)


@app.get("/api/announcements")
def announcements(window_hours: int = Query(default=24, ge=1, le=720)) -> dict:
    live_error = False
    try:
        companies = _company_universe()["companies"]
        rows = fetch_portfolio_announcements(companies, window_hours)
    except Exception:
        logger.exception("NSE live announcements unavailable; using the dated, source-linked filing example if it falls in the selected window.")
        rows = []
        live_error = True

    # This is a real, independently verifiable NSE IXBRL record. Keep it available
    # as a labelled demonstration item when the live NSE query has no matching row.
    verified_filing = {
        "id": "nse-reliance-q2fy27-ixbrl-20261030",
        "company": "Reliance Industries",
        "ticker": "RELIANCE.NS",
        "symbol": "RELIANCE",
        "subject": "Integrated Filing — IndAS: unaudited consolidated Q2 and half-year FY2027 results",
        "details": "NSE IXBRL filing approved at the board meeting on 30 Oct 2026 for the quarter and half year ended 30 Sep 2026. Open the exchange record to verify the filing metadata and reported period.",
        "filed_at": "2026-10-30T21:32:55+05:30",
        "source_url": "https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_207709_30102026213255_iXBRL_WEB.html",
        "source_name": "NSE IXBRL filing",
        "is_verified_example": True,
    }
    filed_time = datetime.fromisoformat(verified_filing["filed_at"])
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    in_window = now - timedelta(hours=window_hours) <= filed_time <= now
    has_same_filing = any(row.get("id") == verified_filing["id"] or (str(row.get("ticker", "")).upper().startswith("RELIANCE") and "september 30, 2026" in f"{row.get('subject', '')} {row.get('details', '')}".lower()) for row in rows)
    if in_window and not has_same_filing:
        rows.append(verified_filing)
    if live_error and not any(row.get("is_verified_example") for row in rows):
        raise HTTPException(status_code=503, detail="NSE announcements are unavailable and the verified example is outside this time window.")

    items = []
    for row in rows:
        classification = classify_announcement(row["subject"], row["details"])
        row.update(classification)
        row["rule_explanation"] = explain_with_rules(row["company"], row["category"], row["subject"], row["details"])
        row["kind"] = "filing"
        row["exchange"] = "NSE"
        row["priority"] = row.get("priority", "routine")
        row["event_at"] = row["filed_at"]
        items.append(row)
    _upsert_alert_history(items)
    items.sort(key=lambda item: (item["importance"], item["filed_at"]), reverse=True)
    return {"source": "NSE corporate announcements", "exchange": "NSE", "window_hours": window_hours, "items": items, "live_feed_available": not live_error, "last_successful_update": datetime.now(timezone.utc).isoformat() if not live_error else None, "notice": "Includes one dated, source-linked NSE filing example for demonstration." if any(item.get("is_verified_example") for item in items) else None, "ai_enabled": ai_is_enabled()}


@app.post("/api/announcements/explain")
def explain_announcement(item: AnnouncementInput) -> dict:
    source_url = _validate_research_source_url(item.source_url)
    stored = next((row for row in _read_alert_history() if row.get("kind") == "filing" and str(row.get("ticker", "")).upper() == item.ticker.upper() and row.get("subject") == item.subject and row.get("source_url") == source_url), None)
    if not stored:
        raise HTTPException(status_code=404, detail="This filing is no longer in FINN's loaded source feed. Refresh filings before requesting an explanation.")
    details = str(stored.get("details") or "")
    fallback = explain_with_rules(str(stored.get("company") or item.company), str(stored.get("category") or item.category), str(stored.get("subject") or item.subject), details)
    source = {"id": "F1", "label": "NSE corporate filing", "source_date": stored.get("filed_at"), "source_url": source_url, "excerpt": f"Company: {stored.get('company', item.company)}. Ticker: {stored.get('ticker', item.ticker)}. Filed at: {stored.get('filed_at', 'unknown')}. Category: {stored.get('category', item.category)}. Subject: {stored.get('subject', item.subject)}. Details: {details}"}
    facts = [f"NSE filed {source['source_date']}: {source['excerpt']}"]
    synthesis = interpret_evidence(capability="company intelligence", task="Explain why this specific filing may matter, and state what the filing alone does not establish.", facts=facts, sources=[source], fallback=fallback, max_tokens=180)
    return {"explanation": synthesis["answer"], "interpretation": synthesis["answer"] if synthesis["ai_generated"] else None, "facts": facts, "uncertainties": ["The filing alone may not establish its financial or operating impact."], "source_url": source_url, "source_name": "NSE corporate announcement", "source_date": source["source_date"], "sources": [source], "verification": synthesis["verification"], "ai_generated": synthesis["ai_generated"], "mode": synthesis["mode"], "notice": synthesis["verification"].get("note") if synthesis["mode"] in {"evidence_only", "rule_based_fallback"} else None}


@app.post("/api/market/explain")
def explain_market_alert(item: MarketAlertInput) -> dict:
    snapshot = _portfolio_snapshot()
    company = next((row for row in snapshot["companies"] if row["ticker"].upper() == item.ticker.upper()), None)
    if not company or company.get("market_status") != "available":
        raise HTTPException(status_code=503, detail="A current completed-session quote is unavailable for this company.")
    triggered = []
    if company.get("unusual_price"):
        triggered.append("price movement")
    if company.get("unusual_volume"):
        triggered.append("volume")
    if not triggered:
        raise HTTPException(status_code=409, detail="No configured market signal is active for the latest completed session.")
    source_url = f"https://finance.yahoo.com/quote/{company['ticker']}"
    facts = []
    if company.get("change_pct") is not None:
        facts.append(f"Latest completed session close changed {company['change_pct']:+.2f}% versus previous close {company.get('previous_close')}; configured threshold ±{company['price_threshold_pct']:.2f}%.")
    if company.get("volume_ratio_20d") is not None:
        facts.append(f"Completed-session volume was {company['volume_ratio_20d']:.2f}× the previous 20 completed sessions' average; configured threshold {company['volume_threshold']:.2f}×.")
    if company.get("price") is not None:
        facts.append(f"Latest completed-session close: ₹{company['price']:.2f}.")
    base = {"ticker": company["ticker"], "company": company["name"], "session_date": company["session_date"], "retrieved_at": company["checked_at"], "source_url": source_url, "source_name": company.get("source_name"), "triggered_conditions": triggered, "facts": facts}
    price = f"The latest close moved {company['change_pct']:+.2f}%" if company.get("change_pct") is not None else "No price change was available"
    volume = f"volume was {company['volume_ratio_20d']:.2f}× its 20-session average" if company.get("volume_ratio_20d") is not None else "volume comparison was unavailable"
    explanation = f"{company['ticker']}: {price}; {volume}. This is an unusual end-of-day signal because {', '.join(triggered)} crossed configured thresholds. The signal does not establish a cause."
    source = {"id": "M1", "label": f"{company['source_name']} completed-session quote", "source_date": company["session_date"], "source_url": source_url, "excerpt": " ".join(facts)}
    synthesis = interpret_evidence(capability="market intelligence", task=f"Explain the {', '.join(triggered)} threshold signal for {company['name']}.", facts=facts, sources=[source], fallback=explanation, max_tokens=180)
    return {**base, "explanation": synthesis["answer"], "interpretation": synthesis["answer"] if synthesis["ai_generated"] else None, "uncertainties": ["An unusual market signal does not establish its cause."], "sources": [source], "ai_generated": synthesis["ai_generated"], "mode": synthesis["mode"], "verification": synthesis["verification"]}


@app.post("/api/intelligence/portfolio")
def portfolio_intelligence(request: PortfolioIntelligenceRequest) -> dict:
    """Interpret a browser-calculated portfolio snapshot for this request only."""
    metrics = request.metrics.model_dump()
    source_url = "https://finance.yahoo.com/"
    sources = [{
        "id": "P0", "label": "FINN portfolio calculations", "source_date": request.as_of_date,
        "source_url": source_url,
        "excerpt": (
            f"As of {request.as_of_date}; market value ₹{metrics['market_value']:.2f}; daily P&L ₹{metrics['daily_pnl']:.2f}; "
            f"unrealized P&L ₹{metrics['unrealized_pnl']:.2f}; priced holdings {request.priced_holding_count}/{request.total_holding_count}; "
            f"largest sector {metrics['largest_sector'] or 'unavailable'} at {metrics['largest_sector_pct'] if metrics['largest_sector_pct'] is not None else 'unavailable'}%; "
            f"top three sectors {metrics['top_three_sector_pct'] if metrics['top_three_sector_pct'] is not None else 'unavailable'}%; "
            f"stock HHI {metrics['stock_hhi'] if metrics['stock_hhi'] is not None else 'unavailable'}; "
            f"sectors represented {metrics['sector_count']}; annualized volatility {metrics['volatility_pct'] if metrics['volatility_pct'] is not None else 'unavailable'}%; "
            f"maximum drawdown {metrics['max_drawdown_pct'] if metrics['max_drawdown_pct'] is not None else 'unavailable'}%; "
            f"account return {metrics['account_return_pct'] if metrics['account_return_pct'] is not None else 'unavailable'}%; "
            f"NIFTY 50 comparison {metrics['benchmark_return_pct'] if metrics['benchmark_return_pct'] is not None else 'unavailable'}%."
        ),
    }]
    facts = [sources[0]["excerpt"]]
    for index, holding in enumerate(request.holdings, start=1):
        excerpt = f"{holding.company} ({holding.ticker}) is {holding.weight_pct:.2f}% of priced equity exposure in {holding.sector}; daily movement {holding.daily_change_pct if holding.daily_change_pct is not None else 'unavailable'}%; market data session {holding.session_date or 'unavailable'}."
        source = {"id": f"P{index}", "label": f"Portfolio holding and market quote · {holding.company}", "source_date": holding.session_date or request.as_of_date, "source_url": f"https://finance.yahoo.com/quote/{holding.ticker}", "excerpt": excerpt}
        sources.append(source)
        facts.append(excerpt)
    for index, pair in enumerate(request.correlations, start=1):
        if abs(pair.correlation) < 0.65:
            continue
        relation = "moved together" if pair.correlation > 0 else "moved in opposite directions"
        excerpt = f"Adjusted daily-return correlation for {pair.company_a} ({pair.ticker_a}) and {pair.company_b} ({pair.ticker_b}) was {pair.correlation:+.2f} across {pair.observations} shared daily return observations from {pair.from_date} to {pair.to_date}; the pair {relation} in this sample. Correlation is historical co-movement, not causation or a forecast."
        sources.append({"id": f"R{index}", "label": "FINN calculated adjusted-price return correlation", "source_date": pair.to_date, "excerpt": excerpt})
        facts.append(excerpt)
    fallback = (
        f"Deterministic portfolio snapshot as of {request.as_of_date}: {request.priced_holding_count} of {request.total_holding_count} holdings are priced. "
        f"Largest sector exposure is {metrics['largest_sector'] or 'unavailable'} ({metrics['largest_sector_pct'] if metrics['largest_sector_pct'] is not None else 'not available'}%). "
        "FINN cannot infer correlated risk from sector weights alone. Review holdings with missing or stale prices before drawing conclusions."
    )
    strong_pairs = [pair for pair in request.correlations if abs(pair.correlation) >= 0.65]
    if strong_pairs:
        pair_summary = "; ".join(f"{pair.company_a} and {pair.company_b} had {pair.correlation:+.2f} adjusted daily-return correlation over {pair.observations} shared sessions ({pair.from_date} to {pair.to_date})" for pair in strong_pairs[:3])
        fallback += f" Historical co-movement signals: {pair_summary}. Correlation does not establish causation or predict future co-movement."
    if not request.holdings:
        return {"answer": "No priced holdings were supplied for portfolio interpretation. Refresh prices and try again.", "mode": "evidence_only", "ai_generated": False, "verification": {"status": "insufficient_evidence", "failures": [], "note": "No priced holding sources were available."}, "sources": [], "retention": "request_not_persisted"}
    synthesis = interpret_evidence(capability="portfolio intelligence", task=request.question, facts=facts, sources=sources, fallback=fallback, max_tokens=300)
    calculations = [{"name": key.replace("_", " "), "value": value, "unit": "INR" if key in {"market_value", "daily_pnl", "unrealized_pnl"} else "%" if key.endswith("_pct") else "count" if key == "sector_count" else "index" if key == "stock_hhi" else "sector", "as_of_date": request.as_of_date} for key, value in metrics.items()]
    uncertainties = []
    if request.priced_holding_count < request.total_holding_count:
        uncertainties.append(f"Prices are available for {request.priced_holding_count} of {request.total_holding_count} holdings; omitted positions may change exposures.")
    if metrics["volatility_pct"] is None or metrics["max_drawdown_pct"] is None:
        uncertainties.append("Historical risk metrics are unavailable or have insufficient observations.")
    if metrics["benchmark_return_pct"] is None:
        uncertainties.append("A date-aligned NIFTY 50 comparison is unavailable.")
    if not strong_pairs:
        uncertainties.append("No strong pairwise adjusted-return correlation met the minimum observation and threshold rules; this does not establish that holdings are uncorrelated.")
    return {**synthesis, "interpretation": synthesis["answer"] if synthesis["ai_generated"] else None, "facts": [source["excerpt"] for source in sources[1:]], "calculations": calculations, "uncertainties": uncertainties, "sources": sources, "as_of_date": request.as_of_date, "coverage": {"priced_holdings": request.priced_holding_count, "total_holdings": request.total_holding_count}, "retention": "request_not_persisted"}


@app.post("/api/intelligence/briefing")
def intelligence_briefing(request: IntelligenceBriefingRequest) -> dict:
    selected = list({company.ticker.upper(): company for company in request.companies}.values())
    universe = {company["ticker"].upper(): company for company in _company_universe()["companies"]}
    companies = [{"name": universe.get(item.ticker.upper(), {}).get("name", item.company), "ticker": item.ticker.upper(), "sector": universe.get(item.ticker.upper(), {}).get("sector", item.sector)} for item in selected]
    settings = _get_settings()
    with ThreadPoolExecutor(max_workers=4) as pool:
        market_rows = list(pool.map(lambda company: _market_snapshot(company, settings), companies))

    facts: list[str] = []
    sources: list[dict] = []
    market_coverage = sum(row.get("market_status") == "available" for row in market_rows)
    for row in market_rows:
        triggered = []
        if row.get("unusual_price"):
            triggered.append("price movement")
        if row.get("unusual_volume"):
            triggered.append("volume spike")
        if not triggered:
            continue
        bits = [f"{row['name']} ({row['ticker']}) triggered {', '.join(triggered)} on completed session {row.get('session_date')}."]
        if row.get("change_pct") is not None:
            bits.append(f"Close move {row['change_pct']:+.2f}% against ±{row['price_threshold_pct']:.2f}% threshold.")
        if row.get("volume_ratio_20d") is not None:
            bits.append(f"Volume {row['volume_ratio_20d']:.2f}× against {row['volume_threshold']:.2f}× threshold.")
        fact = " ".join(bits)
        source = {"id": f"I{len(sources) + 1}", "label": f"Yahoo Finance completed-session quote · {row['name']}", "source_date": row.get("session_date"), "source_url": f"https://finance.yahoo.com/quote/{row['ticker']}", "excerpt": fact}
        sources.append(source)
        facts.append(fact)

    filing_error = None
    filings = []
    try:
        if companies:
            filings = fetch_portfolio_announcements(companies, request.window_hours)
    except Exception as exc:
        logger.exception("Could not load NSE filings for the requested intelligence briefing.")
        filing_error = "NSE filing feed unavailable"
    for filing in filings[:12]:
        category = classify_announcement(filing["subject"], filing.get("details", ""))["category"]
        fact = f"{filing['company']} ({filing['ticker']}) filed on NSE at {filing['filed_at']}: {filing['subject']}. Category: {category}. Details: {filing.get('details', '')}"
        source = {"id": f"F{sum(1 for entry in sources if entry['id'].startswith('F')) + 1}", "label": "NSE corporate filing", "source_date": filing["filed_at"], "source_url": filing["source_url"], "excerpt": fact}
        sources.append(source)
        facts.append(fact)

    coverage = {"market_available": market_coverage, "companies_requested": len(companies), "filings_available": filing_error is None, "filings_found": len(filings), "window_hours": request.window_hours}
    if not selected:
        return {"answer": "Track companies in the watchlist to build a source-backed daily briefing.", "mode": "evidence_only", "ai_generated": False, "facts": [], "calculations": [], "interpretation": None, "uncertainties": ["No tracked companies were submitted."], "sources": [], "coverage": coverage, "verification": {"status": "insufficient_scope", "failures": [], "note": "No tracked companies were submitted."}, "retention": "request_not_persisted"}
    if not facts:
        if filing_error or market_coverage < len(companies):
            answer = f"No material event was confirmed in the available data. Market prices were available for {market_coverage} of {len(companies)} tracked companies."
            if filing_error:
                answer += " The NSE filing feed was unavailable, so this briefing is incomplete."
            if market_coverage < len(companies):
                answer += " Missing company prices mean market signals could not be checked for every tracked company."
        else:
            answer = f"No threshold-crossing market signal or NSE filing was found in the available {request.window_hours}-hour window. Market prices were available for all {market_coverage} tracked companies."
        return {"answer": answer, "mode": "deterministic_no_events", "ai_generated": False, "facts": [], "calculations": [], "interpretation": None, "uncertainties": ["Feed and price coverage may be incomplete." ] if filing_error or market_coverage < len(companies) else [], "sources": [], "coverage": coverage, "verification": {"status": "not_applicable", "failures": [], "note": filing_error or "No material events were present in the data sources checked."}, "retention": "request_not_persisted"}
    fallback = f"FINN found {len(facts)} dated tracked-company items. Market price coverage was {market_coverage}/{len(companies)}; open the source references to review each event."
    if filing_error:
        fallback += " NSE filings were unavailable; this briefing may be incomplete."
    synthesis = interpret_evidence(capability="personalised investor briefing", task="Summarize the most relevant tracked-company developments, explain why they may matter, and identify limitations. Do not imply that an unusual market signal has a known cause.", facts=facts, sources=sources, fallback=fallback, max_tokens=360)
    uncertainties = []
    if filing_error:
        uncertainties.append("The NSE filing feed was unavailable; this briefing is incomplete.")
    if market_coverage < len(companies):
        uncertainties.append(f"Market quotes were available for {market_coverage} of {len(companies)} tracked companies.")
    return {**synthesis, "interpretation": synthesis["answer"] if synthesis["ai_generated"] else None, "facts": facts, "calculations": [], "uncertainties": uncertainties, "sources": sources, "coverage": coverage, "retention": "request_not_persisted"}


@app.post("/api/research/compare")
def compare_research_companies(request: ResearchCompareRequest) -> dict:
    tickers = [ticker.strip().upper() for ticker in request.tickers]
    company_names = {doc["ticker"].upper(): doc.get("company", doc["ticker"]) for doc in list_documents()}
    reports = {ticker: quarterly_comparisons(ticker, request.statement_basis, request.figure_type, request.adjustment_note) for ticker in tickers}
    period_maps = {ticker: {row["period"]: row["metrics"] for row in reports[ticker]["periods"]} for ticker in tickers}
    shared_periods = set.intersection(*(set(rows) for rows in period_maps.values()))
    if not shared_periods:
        raise HTTPException(status_code=422, detail="These companies do not have a shared entered quarter using the selected statement basis and figure presentation.")
    source_by_key: dict[tuple[str, str, int], dict] = {}
    rows = []
    facts = []
    for period in sorted(shared_periods, reverse=True)[:8]:
        common_metrics = set.intersection(*(set(period_maps[ticker][period]) for ticker in tickers))
        metric_rows = []
        for metric in sorted(common_metrics):
            data_rows = [period_maps[ticker][period][metric] for ticker in tickers]
            units = {row["unit"] for row in data_rows}
            if len(units) != 1:
                continue
            values = []
            for ticker, data in zip(tickers, data_rows):
                evidence = data["source"]
                key = (ticker, evidence["filename"], int(evidence["page"]))
                if key not in source_by_key:
                    source_id = f"C{len(source_by_key)+1}"
                    document_id = evidence.get("document_id")
                    source_by_key[key] = {"id": source_id, "label": f"{company_names.get(ticker, ticker)} · {evidence['filename']}", "ticker": ticker, "company": company_names.get(ticker, ticker), "document_type": evidence.get("document_type", "Uploaded report"), "reporting_period": period, "page": int(evidence["page"]), "source_date": evidence.get("indexed_at"), "source_url": evidence.get("source_url") or (f"/api/research/documents/{document_id}/file#page={evidence['page']}" if document_id else None), "excerpt": evidence.get("excerpt", "")}
                source = source_by_key[key]
                value = float(data["value"])
                values.append({"ticker": ticker, "company": company_names.get(ticker, ticker), "value": value, "unit": data["unit"], "source_id": source["id"], "source_page": source["page"], "filename": source["label"]})
                facts.append(f"{period} {metric.replace('_',' ')} for {ticker} was {value:g} {data['unit']} [{source['id']}].")
            metric_rows.append({"metric": metric, "unit": next(iter(units)), "values": values})
        if metric_rows:
            rows.append({"period": period, "metrics": metric_rows})
    if not rows:
        raise HTTPException(status_code=422, detail="The companies have shared quarters, but no common metrics with matching units were entered.")
    sources = list(source_by_key.values())
    fallback = f"FINN found {sum(len(item['metrics']) for item in rows)} comparable metric-period rows across {len(tickers)} companies. Values use {request.statement_basis} statements and {request.figure_type} figures; comparisons include only identical entered quarters and matching units."
    synthesis = interpret_evidence(capability="investment research comparison", task="Compare the supplied companies only on the exact shared reported metrics. Describe differences without ranking investments, inferring causes, or making valuation claims.", facts=facts, sources=sources, fallback=fallback, max_tokens=320)
    uncertainty = "This compares saved figures only; it does not establish valuation, business quality, or future performance."
    return {**synthesis, "interpretation": synthesis["answer"] if synthesis["ai_generated"] else None, "facts": facts, "calculations": [], "uncertainties": [uncertainty], "tickers": tickers, "statement_basis": request.statement_basis, "figure_type": request.figure_type, "adjustment_note": request.adjustment_note.strip() if request.figure_type == "adjusted" else "", "comparisons": rows, "sources": sources}


@app.get("/api/research/documents")
def research_documents() -> dict:
    return {"documents": list_documents(), "ai_enabled": ai_is_enabled(), "ai_provider": ai_provider_name()}


@app.post("/api/research/documents")
async def upload_research_document(
    company: str = Form(min_length=1, max_length=120),
    ticker: str = Form(min_length=1, max_length=32),
    document_type: str = Form(min_length=1, max_length=60),
    reporting_period: str = Form(min_length=1, max_length=80),
    source_url: str = Form(default="", max_length=1000),
    file: UploadFile = File(...),
) -> dict:
    ticker = _validate_research_company(company, ticker)
    source_url = _validate_research_source_url(source_url)
    result = await add_pdf(company, ticker, document_type, reporting_period, file)
    if source_url:
        from app.services.research.documents import _manifest, _manifest_lock, MANIFEST_PATH
        with _manifest_lock:
            records = _manifest()
            for record in records:
                if record.get("id") == result["id"]:
                    record["source_url"] = source_url
                    break
            MANIFEST_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        result["source_url"] = source_url
    return result


@app.put("/api/research/documents/{document_id}")
async def replace_research_document(
    document_id: str,
    company: str = Form(min_length=1, max_length=120),
    ticker: str = Form(min_length=1, max_length=32),
    document_type: str = Form(min_length=1, max_length=60),
    reporting_period: str = Form(min_length=1, max_length=80),
    source_url: str = Form(default="", max_length=1000),
    file: UploadFile = File(...),
) -> dict:
    ticker = _validate_research_company(company, ticker)
    source_url = _validate_research_source_url(source_url)
    previous = next((doc for doc in list_documents() if doc["id"] == document_id), None)
    if not previous:
        raise HTTPException(status_code=404, detail="Source document not found.")
    result = await add_pdf(company, ticker, document_type, reporting_period, file)
    matching_versions = [doc for doc in list_documents() if doc.get("company") == previous.get("company") and doc.get("ticker") == previous.get("ticker") and doc.get("document_type") == previous.get("document_type") and doc.get("reporting_period") == previous.get("reporting_period")]
    next_version = max((int(doc.get("version_number", 1)) for doc in matching_versions), default=1) + 1
    if source_url:
        from app.services.research.documents import _manifest, _manifest_lock, MANIFEST_PATH
        with _manifest_lock:
            records = _manifest()
            for record in records:
                if record.get("id") == document_id:
                    record["superseded_by"] = result["id"]
                    break
            for record in records:
                if record.get("id") == result["id"]:
                    record["source_url"] = source_url
                    record["replaces"] = document_id
                    record["version_number"] = next_version
                    break
            MANIFEST_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        result["source_url"] = source_url
    else:
        from app.services.research.documents import _manifest, _manifest_lock, MANIFEST_PATH
        with _manifest_lock:
            records = _manifest()
            for record in records:
                if record.get("id") == document_id:
                    record["superseded_by"] = result["id"]
                elif record.get("id") == result["id"]:
                    record["replaces"] = document_id
                    record["version_number"] = next_version
            MANIFEST_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    result["version_number"] = next_version
    return result


@app.delete("/api/research/documents/{document_id}")
def delete_research_document(document_id: str) -> dict:
    record = remove_document(document_id)
    remove_document_records(document_id)
    return {"deleted": record["id"], "filename": record["filename"]}


@app.get("/api/research/documents/{document_id}/dependencies")
def research_document_dependencies(document_id: str) -> dict:
    if not any(doc["id"] == document_id for doc in list_documents()):
        raise HTTPException(status_code=404, detail="Source document not found.")
    return document_dependencies(document_id)


@app.post("/api/research/documents/{document_id}/reindex")
def reindex_research_document(document_id: str) -> dict:
    return reindex_document(document_id)


@app.get("/api/research/documents/{document_id}/file")
def open_research_document(document_id: str) -> FileResponse:
    record = next((doc for doc in list_documents() if doc["id"] == document_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Source document not found.")
    path = UPLOADS_DIR / f"{document_id}.pdf"
    if not path.is_file() or path.parent != UPLOADS_DIR:
        raise HTTPException(status_code=404, detail="Stored PDF is missing.")
    return FileResponse(path, media_type="application/pdf", filename=record["filename"], content_disposition_type="inline")


@app.post("/api/research/query")
def research_query(query: ResearchQuestion) -> dict:
    if query.ticker:
        document, sources = retrieve_ticker_pages(query.ticker, query.question)
    else:
        document, sources = retrieve_pages(query.document_id or "", query.question)
    if not sources:
        return {"answer": "I could not find a matching passage in this document. Try a more specific question or upload a text-searchable primary source.", "mode": "no_matching_evidence", "sources": [], "ai_generated": False}

    if not ai_is_enabled():
        query_terms = {word.lower().rstrip("s") for word in WORD_RE.findall(query.question) if word.lower() not in STOPWORDS and len(word) > 2}
        asks_about_management = bool(re.search(r"\b(management|what did .* say|what was .* view|guidance|outlook|expectation)\b", query.question, re.I))
        asks_for_reported_numbers = bool(re.search(r"\b(revenue|ebitda|pbt|pat|profit|financial|reported|figures|numbers|table)\b", query.question, re.I))
        ranked_sentences = []
        for source in sources:
            excerpt = source.get("excerpt", "")
            if asks_about_management and not asks_for_reported_numbers:
                excerpt = excerpt.split("PAGE TEXT:\n", 1)[-1] if "PAGE TEXT:\n" in excerpt else ""
                raw_speaker_blocks = re.split(r"(?=Company Speaker\s*\()", excerpt, flags=re.I)
                speaker_blocks = [re.split(r"Questioner\s*\(", block, maxsplit=1, flags=re.I)[0] for block in raw_speaker_blocks if re.match(r"Company Speaker\s*\(", block, re.I)]
                excerpt = "\n".join(speaker_blocks)
            parts = (speaker_blocks
                     if asks_about_management and not asks_for_reported_numbers
                     else re.split(r"(?<=[.!?])\s+|\n+", excerpt))
            for part in parts:
                sentence = re.sub(r"\s+", " ", part).replace("\ufffd", " ").strip(" |\t·•-")
                if not sentence or sentence.startswith(("EXTRACTED TABLE ROWS", "PAGE TEXT:")):
                    continue
                if len(sentence.split()) < 7:
                    continue
                terms = {word.lower().rstrip("s") for word in WORD_RE.findall(sentence) if len(word) > 2}
                overlap = len(query_terms & terms)
                if overlap:
                    excerpt_text = sentence
                    if len(excerpt_text) > 480:
                        clipped = excerpt_text[:480]
                        boundaries = list(re.finditer(r"[.!?](?=\s|$)", clipped))
                        excerpt_text = clipped[:boundaries[-1].end()] if boundaries else clipped.rsplit(" ", 1)[0]
                        excerpt_text += " …"
                    ranked_sentences.append((overlap / max(len(query_terms), 1), excerpt_text, source))
        ranked_sentences.sort(key=lambda item: (item[0], item[2].get("relevance", 0)), reverse=True)
        selected = []
        seen_pages = set()
        for relevance, sentence, source in ranked_sentences:
            key = (source["filename"], source["page"])
            if key in seen_pages:
                continue
            seen_pages.add(key)
            selected.append((sentence, source))
            if len(selected) == (1 if asks_about_management and not asks_for_reported_numbers else 3):
                break
        if selected:
            lead = "Management stated (direct source excerpt):" if asks_about_management and not asks_for_reported_numbers else "Extracted answer from the selected primary source:"
            answer = lead + "\n" + "\n".join(f"• {sentence} [{source['id']}]" for sentence, source in selected)
            answer += "\n\nThis is a local extractive answer, not model-generated. It may omit context; review the cited page before drawing a conclusion."
        else:
            answer = "The selected document has relevant pages, but I could not isolate a sentence that directly answers this question. Review the cited passages below; FINN will not infer an answer from a weak match."
        return {"answer": answer, "mode": "extractive_local", "sources": sources, "ai_generated": False, "document": {"company": document["company"], "ticker": document["ticker"], "filename": document["filename"]}}

    answer, verification = synthesize_research_answer(query.question, sources)
    valid_ids = {source["id"] for source in sources}
    cited_ids = set(re.findall(r"\[(S\d+)\]", answer))
    unknown_ids = sorted(cited_ids - valid_ids)
    if verification["status"] == "withheld":
        answer = "FINN could not verify citations in its generated response, so it is withholding the synthesis. Review the retrieved primary-source passages below."
        return {
            "answer": answer,
            "mode": "evidence_only",
            "sources": sources,
            "cited_source_ids": [],
            "unknown_citation_ids": unknown_ids,
            "verification": verification,
            "ai_generated": False,
            "document": {"company": document["company"], "ticker": document["ticker"], "filename": document["filename"]},
        }
    return {
        "answer": answer,
        "mode": "ai_grounded",
        "sources": sources,
        "cited_source_ids": sorted(cited_ids & valid_ids),
        "unknown_citation_ids": unknown_ids,
        "verification": verification,
        "ai_generated": True,
        "document": {"company": document["company"], "ticker": document["ticker"], "filename": document["filename"]},
    }


@app.get("/api/research/financials")
def research_financials(ticker: str = Query(min_length=1, max_length=32), statement_basis: str = Query(default="consolidated", pattern="^(consolidated|standalone)$"), figure_type: str = Query(default="reported", pattern="^(reported|adjusted)$"), adjustment_note: str = Query(default="", max_length=500)) -> dict:
    return quarterly_comparisons(ticker, statement_basis, figure_type, adjustment_note)


@app.get("/api/research/evidence")
def research_evidence(ticker: str = Query(min_length=1, max_length=32)) -> dict:
    return {"ticker": ticker.upper(), "records": list_financial_evidence(ticker)}


@app.post("/api/research/financials")
def add_research_financials(entry: QuarterlyEntry) -> dict:
    page_match_score = validate_page_excerpt(entry.document_id, entry.page, entry.excerpt)
    if entry.figure_type == "adjusted" and not entry.adjustment_note.strip():
        raise HTTPException(status_code=422, detail="Describe the adjustment basis before saving adjusted figures.")
    records = add_quarter(entry.ticker, entry.period, entry.unit, entry.page, entry.excerpt, entry.document_id, entry.values, entry.statement_basis, entry.figure_type, entry.adjustment_note)
    return {"saved": records, "source_page_match": page_match_score, "comparisons": quarterly_comparisons(entry.ticker, entry.statement_basis, entry.figure_type, entry.adjustment_note)}


@app.get("/api/research/promises")
def research_promises(ticker: str = Query(min_length=1, max_length=32)) -> dict:
    promises = list_promises(ticker)
    completed = [item for item in promises if item.get("is_current_guidance") and item.get("status") in {"achieved", "exceeded", "missed"}]
    achieved = sum(item.get("status") in {"achieved", "exceeded"} for item in completed)
    miss_rates = [abs(item["deviation"]) / abs(item["target_value"]) * 100 for item in completed if item.get("deviation") is not None and abs(float(item.get("target_value", 0))) > 1e-9]
    track_record = {"completed_count": len(completed), "achieved_count": achieved, "missed_count": sum(item.get("status") == "missed" for item in completed), "achievement_rate_pct": round(achieved / len(completed) * 100, 1) if len(completed) >= 3 else None, "mean_absolute_deviation_pct": round(sum(miss_rates) / len(miss_rates), 1) if len(miss_rates) >= 3 else None, "minimum_sample": 3, "note": "Achieved includes outcomes within 1% of guidance; exceeded is above that tolerance. Missing or incomparable data is excluded. This small sample is not a predictive management credibility score."}
    return {"ticker": ticker.upper(), "promises": promises, "track_record": track_record}


@app.post("/api/research/promises")
def add_research_promise(entry: GuidanceEntry) -> dict:
    validate_page_excerpt(entry.document_id, entry.page, entry.quote)
    promise = add_promise(entry.ticker, entry.metric, entry.target_period, entry.target_value, entry.unit, entry.page, entry.quote, entry.document_id, entry.statement_basis, entry.figure_type, entry.adjustment_note)
    return {"promise": promise, "promises": list_promises(entry.ticker)}


def _local_topic_cues(text: str) -> list[str]:
    value = text.lower()
    cues = []
    if any(term in value for term in ("margin down", "margins down", "margin lower", "margins lower", "margin declined", "margins declined", "margin pressure", "margins have come down", "margin compression", "margin contracted")):
        cues.append("margin or profitability pressure")
    if any(term in value for term in ("demand pressure", "weak demand", "demand declined", "demand decline", "demand fell", "lower demand", "demand is soft", "softening demand", "demand slowed", "demand softness")):
        cues.append("demand pressure")
    if any(term in value for term in ("inflation", "cost pressure", "costs increased", "cost increased", "higher costs", "costs rose", "cost rose")):
        cues.append("cost pressure")
    if any(term in value for term in ("increased debt", "higher debt", "debt burden", "leverage increased", "higher leverage", "borrowings increased", "higher borrowings")):
        cues.append("debt or financing pressure")
    if any(term in value for term in ("negative cash flow", "cash flow declined", "cash flow pressure", "cash flow weakened")):
        cues.append("cash-flow pressure")
    if any(term in value for term in ("litigation", "regulatory action", "penalty", "auditor qualification", "going concern")):
        cues.append("legal, regulatory, or audit issue")
    if any(term in value for term in ("delay", "delayed", "behind schedule", "cost overrun", "execution risk")):
        cues.append("execution delay or risk")
    return cues


def _local_financial_signals(ticker: str, sources: list[dict]) -> tuple[list[str], list[str]]:
    periods = quarterly_comparisons(ticker).get("periods", [])
    if not periods:
        return [], []
    latest = periods[0]
    positives: list[str] = []
    counterpoints: list[str] = []
    for metric in ("revenue", "ebitda", "pbt", "pat"):
        data = latest["metrics"].get(metric)
        if not data:
            continue
        source = data.get("source") or {}
        source_key = (source.get("filename"), source.get("page"))
        source_id = next((item["id"] for item in sources if (item.get("filename"), item.get("page")) == source_key), None)
        if source_id is None and source:
            source_id = f"B{len(sources) + 1}"
            sources.append({
                "id": source_id,
                "filename": source.get("filename", "Source PDF"),
                "document_id": source.get("document_id"),
                "source_url": source.get("source_url"),
                "document_type": source.get("document_type", "Quarterly results"),
                "reporting_period": source.get("reporting_period", latest["period"]),
                "page": source.get("page", 1),
                "relevance": 0,
                "excerpt": source.get("excerpt", ""),
            })
        qoq = data.get("qoq", {}).get("change_pct")
        yoy = data.get("yoy", {}).get("change_pct")
        label = metric.upper()
        value = f"{float(data['value']):,.2f}".rstrip("0").rstrip(".")
        unit = data.get("unit", "")
        cite = f" [{source_id}]" if source_id else ""
        periods_text = []
        if qoq is not None:
            periods_text.append(f"{qoq:+.2f}% QoQ")
        if yoy is not None:
            periods_text.append(f"{yoy:+.2f}% YoY")
        if not periods_text:
            continue
        trend = ", ".join(periods_text)
        sentence = f"{label}: {value} {unit} in {latest['period']} ({trend}).{cite}"
        # Treat these as reported movements, not as a prediction or recommendation.
        if (yoy is not None and yoy > 0 and (qoq is None or qoq >= 0)) or (yoy is None and qoq is not None and qoq > 0):
            positives.append(sentence)
        if (qoq is not None and qoq < 0) or (yoy is not None and yoy < 0):
            counterpoints.append(sentence)
    return positives, counterpoints


def _research_evidence_quality(sources: list[dict]) -> dict:
    page_count = len({(item.get("document_id"), item.get("filename"), item.get("page")) for item in sources})
    document_count = len({item.get("document_id") or item.get("filename") for item in sources})
    document_types = len({item.get("document_type") for item in sources if item.get("document_type")})
    if page_count >= 6 and document_count >= 2:
        coverage = "broad"
        confidence = "moderate"
    elif page_count >= 3:
        coverage = "moderate"
        confidence = "low"
    else:
        coverage = "limited"
        confidence = "low"
    families = {urlparse(item.get("source_url", "")).hostname.lower().removeprefix("www.") for item in sources if item.get("source_url") and urlparse(item.get("source_url", "")).hostname}
    excerpt_terms = []
    for item in sources:
        excerpt_terms.append({term.lower().rstrip("s") for term in WORD_RE.findall(item.get("excerpt", "")) if len(term) > 2})
    repeated_pairs = 0
    compared_pairs = 0
    for index, left in enumerate(excerpt_terms):
        for right in excerpt_terms[index + 1:]:
            if not left or not right:
                continue
            compared_pairs += 1
            similarity = len(left & right) / max(len(left | right), 1)
            if similarity >= 0.55:
                repeated_pairs += 1
    if repeated_pairs:
        quality, independence = "repeated evidence needs review", "possible content overlap"
    elif len(families) >= 2:
        quality, independence = "source variety visible", "multiple source domains"
    else:
        quality, independence = "independence unassessed", "source domains are missing or concentrated"
    return {"coverage": coverage, "confidence": confidence, "quality": quality, "independence": independence, "source_domains": len(families), "near_duplicate_passage_pairs": repeated_pairs, "compared_passage_pairs": compared_pairs, "source_pages": page_count, "documents": document_count, "document_types": document_types, "note": "Coverage counts retrieved material. Quality signals only identify source-domain variety and text overlap; repeated filings are not independent corroboration. Confidence describes retrieval coverage, not the likelihood of an investment outcome."}


@app.post("/api/research/bull-bear")
def bull_bear_analysis(request: BullBearRequest) -> dict:
    ticker = request.ticker.strip().upper()
    company_docs = [doc for doc in list_documents() if doc["ticker"].upper() == ticker]
    if not company_docs:
        raise HTTPException(status_code=404, detail="Upload an annual report, quarterly result, or concall transcript for this ticker first.")

    queries = {
        "bull": "revenue growth sales growth margins market share order wins capacity expansion new products",
        "bear": "debt leverage cash flow working capital litigation risk customer concentration margin decline auditor qualification demand cost pressure",
    }
    passages_by_side: dict[str, list[dict]] = {}
    for side, query_text in queries.items():
        side_passages: list[dict] = []
        for doc in company_docs:
            _, matches = retrieve_pages(doc["id"], query_text, limit=2)
            for match in matches:
                if all((prior["filename"], prior["page"]) != (match["filename"], match["page"]) for prior in side_passages):
                    side_passages.append(match)
        side_passages.sort(key=lambda item: item.get("relevance", 0), reverse=True)
        passages_by_side[side] = side_passages[:4]

    passage_map: dict[tuple[str, int], dict] = {}
    for side, matches in passages_by_side.items():
        for match in matches:
            key = (match["filename"], match["page"])
            if key not in passage_map:
                passage_map[key] = {**match, "case_sides": set()}
            passage_map[key]["case_sides"].add(side)
    passages = list(passage_map.values())[:8]
    if not passages:
        raise HTTPException(status_code=422, detail="No relevant text could be retrieved from the uploaded primary sources.")

    sources = []
    for index, passage in enumerate(passages, start=1):
        source = {**passage, "id": f"B{index}", "case_sides": sorted(passage["case_sides"])}
        sources.append(source)
    # Attach saved financial figures and management guidance to the same cited
    # source set used by Bull vs Bear, preserving each record's original page.
    for record in list_financial_evidence(ticker)[:12]:
        citation = record.get("source") or {}
        if not citation.get("document_id") or not citation.get("page"):
            continue
        entry_id = f"B{len(sources) + 1}"
        if record.get("evidence_kind") == "management_guidance":
            description = f"Management guidance for {record.get('target_period')}: {record.get('metric')} target {record.get('target_value')} {record.get('unit')}. Management quote: {record.get('quote', '')}"
        else:
            description = f"Saved financial evidence for {record.get('period')}: {record.get('metric')} = {record.get('value')} {record.get('unit')} ({record.get('statement_basis', 'consolidated')}, {record.get('figure_type', 'reported')})."
        sources.append({"id": entry_id, "document_id": citation["document_id"], "source_url": citation.get("source_url"), "filename": citation.get("filename", "Source PDF"), "document_type": citation.get("document_type", "Financial evidence"), "reporting_period": record.get("period") or record.get("target_period") or citation.get("reporting_period", ""), "page": citation["page"], "relevance": 0, "excerpt": description + "\n" + (citation.get("excerpt") or record.get("quote", "")), "evidence_kind": record.get("evidence_kind", "financial_value")})
    if not ai_is_enabled():
        positives, counterpoints = _local_financial_signals(ticker, sources)
        bull_sources = [item for item in sources if "bull" in item.get("case_sides", [])]
        bear_sources = [item for item in sources if "bear" in item.get("case_sides", [])]
        lines = ["Local evidence scan · deterministic calculations and source-topic matching; not investment advice.", "", "Bull case — cited positive evidence"]
        if positives:
            lines.extend(f"• {item}" for item in positives[:4])
        elif bull_sources:
            lines.append("No comparable quarterly figures are entered yet. Growth-related source pages were retrieved for review: " + ", ".join(f"[{item['id']}]" for item in bull_sources[:3]) + ".")
        else:
            lines.append("No growth evidence matched in the uploaded sources.")
        lines.extend(["", "Bear case — cited counterevidence and risk topics"])
        if counterpoints:
            lines.extend(f"• {item}" for item in counterpoints[:4])
        if bear_sources:
            labelled_risks = 0
            for item in bear_sources[:3]:
                cues = _local_topic_cues(item.get("excerpt", ""))
                if cues:
                    labelled_risks += 1
                    cue_text = ", ".join(cues[:3])
                    lines.append(f"• Explicit text cues for {cue_text} appear on {item['document_type']} page {item['page']} [{item['id']}].")
            if not labelled_risks and not counterpoints:
                lines.append("The risk-oriented search found relevant pages, but no specific negative cue met FINN's local rule threshold. Review the cited passages below.")
        elif not counterpoints:
            lines.append("No risk evidence matched in the uploaded sources; this does not mean there are no risks.")
        lines.extend(["", "Final assessment"])
        if positives and counterpoints:
            lines.append("The retrieved financial evidence is mixed. No overall direction is assigned; compare the cited periods and source disclosures.")
        elif positives:
            lines.append("The retrieved evidence leans positive on entered financial trends, but the risk search is not proof that risks are absent.")
        elif counterpoints:
            lines.append("The retrieved evidence contains financial counterpoints. Positive evidence was not sufficient to support a balanced directional conclusion.")
        else:
            lines.append("Evidence is insufficient for a directional conclusion.")
        lines.extend(["", "Assumptions and valuation", "No valuation conclusion is available from the uploaded operational and financial passages alone. Check whether reported periods, units, and statement basis are comparable.", "", "Catalysts and unresolved questions", "No future catalyst is assumed unless a source passage explicitly states one. Review the cited pages for timing, execution, funding, and unresolved risks.", "", f"Evidence quality: limited · {len(sources)} retrieved source pages; topic search and entered figures only. This scan may miss relevant disclosures."])
        return {"ticker": ticker, "mode": "local_analysis", "answer": "\n".join(lines), "sources": sources, "evidence_quality": _research_evidence_quality(sources), "verification": {"status": "deterministic", "failures": [], "note": "Local calculations and source-topic matches; review citations and source text."}, "ai_generated": False}

    evidence = "\n\n".join(f"[{source['id']}] {source['filename']}, {source['document_type']}, {source['reporting_period']}, page {source['page']}\n{source['excerpt']}" for source in sources)
    instructions = (
        "Write a primary-source analysis using only supplied passages and the cited entered financial records. "
        "Use these headings: Bull case; Bear case; Final assessment; Key assumptions; Valuation considerations; Potential catalysts; Unresolved questions; Evidence quality and confidence. "
        "Cite every material factual claim with a supplied ID such as [B1]. Distinguish explicit management statements (label 'Management stated') from FINN interpretation (label 'FINN interpretation'). "
        "Do not manufacture an argument to balance the other side. State when a side has little or no support. "
        "Do not invent a catalyst, valuation, outcome, risk, or metric. Say valuation is not assessed if no relevant inputs are provided. "
        "Explain important counterarguments and what evidence would change the view. Do not use outside knowledge, news, or broker commentary. Do not give investment advice."
    )
    try:
        answer = generate_text(instructions, f"Ticker: {ticker}\n\nPrimary-source evidence:\n{evidence}", 550)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="The primary-source pages were retrieved, but the bull/bear synthesis failed.") from exc
    import re
    valid_ids = {source["id"] for source in sources}
    cited_ids = set(re.findall(r"\[(B\d+)\]", answer))
    verification = _verify_generated_claims(answer, sources, "B")
    if not cited_ids or cited_ids - valid_ids or verification["status"] == "withheld":
        return {"ticker": ticker, "mode": "evidence_only", "answer": "FINN could not verify the generated citations, so it is withholding the synthesis. Review the retrieved primary-source pages below.", "sources": sources, "evidence_quality": _research_evidence_quality(sources), "verification": verification, "ai_generated": False}
    return {"ticker": ticker, "mode": "ai_grounded", "answer": answer, "sources": sources, "evidence_quality": _research_evidence_quality(sources), "verification": verification, "cited_source_ids": sorted(cited_ids), "ai_generated": True}

WEB_DIST = ROOT / "frontend" / "dist"
if WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="frontend-assets")

    @app.get("/")
    def root() -> FileResponse:
        return FileResponse(WEB_DIST / "index.html")

    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="frontend")
else:
    @app.get("/")
    def root() -> dict[str, str]:
        return {"name": "FINN", "message": "Investment intelligence API foundation"}
