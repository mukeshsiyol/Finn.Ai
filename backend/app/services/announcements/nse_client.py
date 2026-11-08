from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from curl_cffi import requests

NSE_HOME = "https://www.nseindia.com"
ANNOUNCEMENTS_URL = f"{NSE_HOME}/api/corporate-announcements"
ANNOUNCEMENTS_PAGE = f"{NSE_HOME}/companies-listing/corporate-filings-announcements"


def fetch_portfolio_announcements(companies: list[dict], window_hours: int = 24) -> list[dict]:
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    start = now - timedelta(hours=window_hours)
    headers = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36",
        "accept": "application/json, text/plain, */*",
        "referer": ANNOUNCEMENTS_PAGE,
        "accept-language": "en-US,en;q=0.9",
    }
    with requests.Session(impersonate="chrome") as session:
        session.headers.update(headers)
        session.get(NSE_HOME, timeout=12)
        response = session.get(
            ANNOUNCEMENTS_URL,
            params={"index": "equities", "from_date": start.strftime("%d-%m-%Y"), "to_date": now.strftime("%d-%m-%Y")},
            timeout=20,
        )
        response.raise_for_status()
        rows = response.json()

    if not isinstance(rows, list):
        raise RuntimeError("NSE returned an unexpected announcement response.")

    by_symbol = {company["ticker"].removesuffix(".NS").removesuffix(".BO").upper(): company for company in companies}
    results = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(_first(row, "symbol", "SYMBOL", "ticker") or "").upper()
        company = by_symbol.get(symbol)
        if not company:
            continue
        subject = str(_first(row, "subject", "sub", "SUBJECT", "desc") or "Corporate filing")
        details = str(_first(row, "details", "desc", "DETAILS", "attchmntText") or "")
        raw_date = str(_first(row, "dt", "broadcastDateTime", "broadcast_date_time", "date", "timestamp") or "")
        filed_at = _parse_nse_date(raw_date)
        if filed_at is None or filed_at < start:
            continue
        attachment = _first(row, "attchmntFile", "attachment", "ATTACHMENT", "url")
        if attachment:
            attachment = str(attachment)
            if not attachment.startswith("http"):
                attachment = f"{NSE_HOME}/{attachment.lstrip('/')}"
        results.append({
            "id": str(_first(row, "seq_id", "seqId", "id") or f"{symbol}-{filed_at.isoformat()}-{subject[:24]}"),
            "company": company["name"],
            "ticker": company["ticker"],
            "symbol": symbol,
            "subject": subject[:500],
            "details": details[:2000],
            "filed_at": filed_at.isoformat(),
            "source_url": attachment or ANNOUNCEMENTS_PAGE,
            "source_name": "NSE corporate announcement",
        })
    return sorted(results, key=lambda item: item["filed_at"], reverse=True)


def _first(row: dict, *keys: str):
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def _parse_nse_date(value: str):
    formats = ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%Y-%m-%d %H:%M:%S")
    for fmt in formats:
        try:
            return datetime.strptime(value.strip(), fmt).replace(tzinfo=ZoneInfo("Asia/Kolkata"))
        except ValueError:
            pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(ZoneInfo("Asia/Kolkata")) if parsed.tzinfo else parsed.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
    except ValueError:
        return None
