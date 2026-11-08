import json
import re
from pathlib import Path
from threading import Lock

from fastapi import HTTPException

from app.services.research.documents import REPORTS_DIR, _manifest

FINANCIALS_PATH = REPORTS_DIR / "financials.json"
PROMISES_PATH = REPORTS_DIR / "promises.json"
_lock = Lock()
METRICS = {"revenue", "ebitda", "pbt", "pat", "o2c_ebitda"}
CORE_METRICS = {"revenue", "ebitda", "pbt", "pat"}
PROMISE_METRICS = METRICS | {"revenue_growth_yoy", "ebitda_margin", "pbt_margin", "pat_margin", "annualized_o2c_ebitda"}
PERIOD_RE = re.compile(r"^FY(20\d{2})-Q([1-4])$", re.I)


def normalize_period(period: str) -> str:
    value = period.strip().upper().replace(" ", "")
    match = PERIOD_RE.fullmatch(value)
    if not match:
        raise HTTPException(status_code=422, detail="Use a quarter such as FY2026-Q2.")
    return f"FY{match.group(1)}-Q{match.group(2)}"


def _read(path: Path) -> list[dict]:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def _document(document_id: str, ticker: str, page: int) -> dict:
    doc = next((item for item in _manifest() if item.get("id") == document_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload and select a primary-source PDF first.")
    if doc["ticker"].upper() != ticker.strip().upper():
        raise HTTPException(status_code=422, detail="The ticker must match the selected source document.")
    if page < 1 or page > int(doc["pages"]):
        raise HTTPException(status_code=422, detail=f"Source page must be between 1 and {doc['pages']}.")
    return {"document_id": doc["id"], "source_url": doc.get("source_url"), "filename": doc["filename"], "document_type": doc["document_type"], "reporting_period": doc["reporting_period"], "page": page}


def add_quarter(ticker: str, period: str, unit: str, page: int, excerpt: str, document_id: str, values: dict) -> list[dict]:
    ticker = ticker.strip().upper()
    period = normalize_period(period)
    citation = _document(document_id, ticker, page)
    source = {**citation, "excerpt": excerpt.strip()[:1200]}
    rows = _read(FINANCIALS_PATH)
    saved = []
    for metric, value in values.items():
        normalized_metric = metric.strip().lower()
        if normalized_metric not in METRICS or value is None:
            continue
        amount = float(value)
        if amount < 0 and normalized_metric in {"revenue", "ebitda"}:
            # Negative EBITDA/revenue can occur in reported statements, so retain it as filed.
            pass
        record = {"ticker": ticker, "period": period, "metric": normalized_metric, "value": amount, "unit": unit.strip()[:24], "source": source}
        rows = [row for row in rows if not (row.get("ticker") == ticker and row.get("period") == period and row.get("metric") == normalized_metric)]
        rows.append(record)
        saved.append(record)
    if not saved:
        raise HTTPException(status_code=422, detail="Enter at least one of Revenue, EBITDA, PBT, or PAT.")
    _save(FINANCIALS_PATH, rows)
    return saved


def _period_index(period: str) -> int | None:
    match = PERIOD_RE.fullmatch(period or "")
    return int(match.group(1)) * 4 + int(match.group(2)) - 1 if match else None


def _period_from_index(index: int) -> str:
    year, quarter_index = divmod(index, 4)
    return f"FY{year}-Q{quarter_index + 1}"


def quarterly_comparisons(ticker: str) -> dict:
    ticker = ticker.strip().upper()
    rows = [row for row in _read(FINANCIALS_PATH) if row.get("ticker") == ticker]
    by_key = {(row["period"], row["metric"]): row for row in rows}
    periods = sorted({row["period"] for row in rows}, key=lambda period: _period_index(period) or 0, reverse=True)
    results = []
    for period in periods:
        current_idx = _period_index(period)
        if current_idx is None:
            continue
        metrics = {}
        for metric in sorted(CORE_METRICS):
            current = by_key.get((period, metric))
            if not current:
                continue
            comparisons = {}
            for label, previous_period in (("qoq", _period_from_index(current_idx - 1)), ("yoy", _period_from_index(current_idx - 4))):
                previous = by_key.get((previous_period, metric))
                change = None
                if not previous:
                    status = "missing_data"
                elif previous.get("unit") != current.get("unit"):
                    status = "unit_mismatch"
                elif float(previous["value"]) <= 0:
                    status = "non_positive_base"
                else:
                    change = (float(current["value"]) - float(previous["value"])) / float(previous["value"]) * 100
                    status = "available"
                comparisons[label] = {
                    "period": previous_period,
                    "value": previous["value"] if previous else None,
                    "unit": previous.get("unit") if previous else None,
                    "change_pct": round(change, 2) if change is not None else None,
                    "status": status,
                    "source": previous.get("source") if previous else None,
                }
            metrics[metric] = {"value": current["value"], "unit": current["unit"], "source": current["source"], **comparisons}
        results.append({"period": period, "metrics": metrics})
    return {"ticker": ticker, "periods": results}


def _actual_guidance_value(ticker: str, period: str, metric: str, records: list[dict]) -> tuple[float | None, str | None, list[dict]]:
    lookup = {(row["ticker"], row["period"], row["metric"]): row for row in records}
    key = (ticker, period)
    if metric == "annualized_o2c_ebitda":
        current_index = _period_index(period)
        current = lookup.get((*key, "o2c_ebitda"))
        previous = lookup.get((ticker, _period_from_index(current_index - 1), "o2c_ebitda")) if current_index is not None else None
        if not current or not previous or current.get("unit") != previous.get("unit"):
            return None, None, []
        annualized = (float(current["value"]) + float(previous["value"])) * 2
        return annualized, "₹ crore annualized", [previous["source"], current["source"]]
    if metric in METRICS:
        actual = lookup.get((*key, metric))
        if not actual:
            return None, None, []
        # Do not compare amounts with different scales (for example crore vs lakh).
        return (float(actual["value"]), actual["unit"], [actual["source"]])
    current_index = _period_index(period)
    revenue = lookup.get((*key, "revenue"))
    if current_index is None or revenue is None or float(revenue["value"]) <= 0:
        return None, None, []
    if metric == "revenue_growth_yoy":
        prior = lookup.get((ticker, _period_from_index(current_index - 4), "revenue"))
        if not prior or float(prior["value"]) <= 0:
            return None, None, []
        value = (float(revenue["value"]) - float(prior["value"])) / abs(float(prior["value"])) * 100
        return value, "%", [revenue["source"], prior["source"]]
    numerator_metric = {"ebitda_margin": "ebitda", "pbt_margin": "pbt", "pat_margin": "pat"}.get(metric)
    numerator = lookup.get((*key, numerator_metric)) if numerator_metric else None
    if not numerator:
        return None, None, []
    value = float(numerator["value"]) / float(revenue["value"]) * 100
    return value, "%", [numerator["source"], revenue["source"]]


def add_promise(ticker: str, metric: str, target_period: str, target_value: float, unit: str, page: int, quote: str, document_id: str) -> dict:
    ticker = ticker.strip().upper()
    metric = metric.strip().lower()
    if metric not in PROMISE_METRICS:
        raise HTTPException(status_code=422, detail="Choose a supported financial metric or margin/growth measure.")
    target_period = normalize_period(target_period)
    citation = _document(document_id, ticker, page)
    rows = _read(PROMISES_PATH)
    promise = {"id": f"{ticker}-{target_period}-{metric}", "ticker": ticker, "metric": metric, "target_period": target_period, "target_value": float(target_value), "unit": unit.strip()[:24], "quote": quote.strip()[:1200], "source": citation}
    rows = [row for row in rows if row.get("id") != promise["id"]]
    rows.append(promise)
    _save(PROMISES_PATH, rows)
    return promise


def list_promises(ticker: str) -> list[dict]:
    ticker = ticker.strip().upper()
    records = _read(FINANCIALS_PATH)
    promises = [row for row in _read(PROMISES_PATH) if row.get("ticker") == ticker]
    output = []
    for promise in promises:
        actual, actual_unit, actual_sources = _actual_guidance_value(ticker, promise["target_period"], promise["metric"], records)
        if actual is not None and actual_unit != promise["unit"]:
            actual = None
            actual_unit = None
            actual_sources = []
            status = "unit_mismatch"
        else:
            status = None
        target = float(promise["target_value"])
        delta = actual - target if actual is not None else None
        if status == "unit_mismatch":
            pass
        elif actual is None:
            status = "awaiting_actual"
        elif abs(delta) < 0.005:
            status = "met"
        elif delta > 0:
            status = "above_guidance"
        else:
            status = "below_guidance"
        output.append({**promise, "actual_value": round(actual, 2) if actual is not None else None, "actual_unit": actual_unit, "deviation": round(delta, 2) if delta is not None else None, "status": status, "actual_sources": actual_sources})
    return sorted(output, key=lambda row: row["target_period"], reverse=True)
