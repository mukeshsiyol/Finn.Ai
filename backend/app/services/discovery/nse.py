"""Read-only adapter for NSE's public corporate filing pages and JSON feeds."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from urllib.parse import urlencode, urlsplit
from zoneinfo import ZoneInfo

from app.services.discovery.http import DEFAULT_HTTP_CLIENT, OfficialSourceError, SafeOfficialHttpClient
from app.services.discovery.providers import DiscoveryProvider
from app.services.discovery.schema import DiscoveryCandidate, DocumentType, ReportingPeriod, VerificationStatus
from app.services.issuers.registry import Issuer


NSE_ORIGIN = "https://www.nseindia.in"
NSE_ANNOUNCEMENTS_PAGE = f"{NSE_ORIGIN}/companies-listing/corporate-filings-announcements"
NSE_INTEGRATED_PAGE = f"{NSE_ORIGIN}/companies-listing/corporate-integrated-filing"
NSE_ALLOWED_DOMAINS = ("nseindia.in", "nseindia.com")
IST = ZoneInfo("Asia/Kolkata")
MAX_LOOKBACK_DAYS = 730


def _first(row: dict, *keys: str):
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def _parse_nse_date(value: object) -> datetime | None:
    if not value:
        return None
    raw = str(value).strip()
    for pattern in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%d-%b-%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, pattern).replace(tzinfo=IST)
        except ValueError:
            pass
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.astimezone(IST) if parsed.tzinfo else parsed.replace(tzinfo=IST)
    except ValueError:
        return None


def _reporting_period(text: str, end_date: object | None = None) -> ReportingPeriod | None:
    compact = re.sub(r"\s+", " ", text)
    match = re.search(r"(?i)\bQ\s*([1-4])\s*(?:of\s*)?FY\s*([0-9]{2,4}(?:\s*[-/]\s*[0-9]{2,4})?)", compact)
    if match:
        return ReportingPeriod.from_label(f"Q{match.group(1)} FY{match.group(2)}")
    match = re.search(r"(?i)\bFY\s*([0-9]{2,4}(?:\s*[-/]\s*[0-9]{2,4})?)", compact)
    if match:
        return ReportingPeriod.from_label(f"FY{match.group(1)}")
    if end_date:
        return ReportingPeriod.from_label(f"Period ended {str(end_date).strip()}")
    return None


def _classify(title: str, details: str = "") -> tuple[DocumentType, str | None]:
    text = f"{title} {details}".casefold()
    if "annual report" in text or "integrated annual report" in text:
        return DocumentType.ANNUAL_REPORT, None
    if "transcript" in text and any(term in text for term in ("call", "concall", "earnings", "quarterly")):
        return DocumentType.EARNINGS_CALL_TRANSCRIPT, None
    if "presentation" in text and any(term in text for term in ("investor", "analyst", "financial", "results", "quarterly")):
        return DocumentType.INVESTOR_PRESENTATION, None
    if "integrated filing" in text and any(term in text for term in ("financial", "result")):
        return DocumentType.QUARTERLY_RESULTS, "integrated_financial_filing"
    if any(term in text for term in ("financial results", "quarterly results", "unaudited results", "audited results", "results for the quarter")):
        if any(term in text for term in ("annual results", "year ended", "financial year ended", "quarter and year ended")):
            return DocumentType.OTHER, "annual_financial_results"
        return DocumentType.QUARTERLY_RESULTS, None
    if any(term in text for term in ("analyst", "investor meet", "institutional investor", "earnings call", "conference call")):
        return DocumentType.OTHER, "investor_financial_disclosure"
    if any(term in text for term in ("credit rating", "rating rationale", "credit rating rationale")):
        return DocumentType.OTHER, "credit_rating_disclosure"
    return DocumentType.OTHER, None


def _revision_fields(row: dict) -> tuple[str | None, str | None]:
    label = str(_first(row, "revision_Remark", "revisionRemark", "revision_remarks", "revisionRemarks", "old_new", "oldNewFlag", "type_Sub") or "").strip()
    if not label or not any(word in label.casefold() for word in ("revision", "revised")):
        return None, None
    filing_id = _first(row, "seq_Id", "seq_id", "seqNumber", "seq_num", "id")
    return str(filing_id or label), label


def _date_window() -> tuple[str, str]:
    now = datetime.now(IST)
    start = now - timedelta(days=MAX_LOOKBACK_DAYS)
    return start.strftime("%d-%m-%Y"), now.strftime("%d-%m-%Y")


class NSEDiscoveryProvider(DiscoveryProvider):
    provider_id = "nse"

    def __init__(self, http: SafeOfficialHttpClient = DEFAULT_HTTP_CLIENT) -> None:
        self.http = http

    def discover(self, issuer: Issuer, document_type: DocumentType, reporting_period: ReportingPeriod | None = None) -> tuple[DiscoveryCandidate, ...]:
        if issuer.nse_symbol.status != "verified" or not issuer.nse_symbol.value:
            raise OfficialSourceError("NSE discovery skipped: this issuer has no verified NSE symbol.")
        symbol = issuer.nse_symbol.value
        from_date, to_date = _date_window()
        announcements_params = urlencode({"index": "equities", "symbol": symbol, "from_date": from_date, "to_date": to_date})
        integrated_params = urlencode({"index": "equities", "symbol": symbol, "page": 1, "size": 100})
        announcements_response = self.http.fetch(
            f"{NSE_ORIGIN}/api/corporate-announcements?{announcements_params}",
            allowed_domains=NSE_ALLOWED_DOMAINS,
            accept="application/json",
        )
        integrated_response = self.http.fetch(
            f"{NSE_ORIGIN}/api/integrated-filing-results?{integrated_params}",
            allowed_domains=NSE_ALLOWED_DOMAINS,
            accept="application/json",
        )
        announcements = _parse_json_rows(announcements_response.text, expected_list=True)
        integrated = _parse_json_rows(integrated_response.text, expected_list=False)
        rows: list[tuple[dict, str]] = [(row, "announcement") for row in announcements]
        rows.extend((row, "integrated") for row in integrated)

        output: list[DiscoveryCandidate] = []
        for row, source_kind in rows:
            if not isinstance(row, dict):
                continue
            returned_symbol = str(_first(row, "symbol", "SYMBOL") or "").strip().upper()
            if returned_symbol != symbol:
                continue
            if source_kind == "integrated":
                title = " - ".join(str(value).strip() for value in (_first(row, "type"), _first(row, "type_Sub")) if value not in (None, "")) or "Integrated Filing - Financials"
                if not any(term in title.casefold() for term in ("financial", "result")):
                    continue
                details = str(_first(row, "revision_Remark", "revision_Remark") or "")
                doc_type = DocumentType.QUARTERLY_RESULTS
                subtype = "integrated_financial_filing"
                direct_url = _first(row, "pdf_attach", "ixbrl") or _first(row, "xbrl")
                filing_id = _first(row, "seq_Id", "seq_id")
                filed_at = _parse_nse_date(_first(row, "broadcast_Date", "creation_Date"))
                date_label = _first(row, "qe_Date")
                period = _reporting_period(title, date_label)
                page_url = f"{NSE_INTEGRATED_PAGE}?{urlencode({'symbol': symbol, 'tabIndex': 'equity'})}"
            else:
                title = str(_first(row, "desc", "subject", "sub") or "Corporate filing").strip()
                details = str(_first(row, "attchmntText", "details", "voiceSummary") or "")
                doc_type, subtype = _classify(title, details)
                if doc_type == DocumentType.OTHER and subtype is None:
                    continue
                direct_url = _first(row, "attchmntFile", "attachment", "url")
                filing_id = _first(row, "seq_id", "seqId", "id")
                filed_at = _parse_nse_date(_first(row, "an_dt", "exchdisstime", "sort_date"))
                period = _reporting_period(f"{title} {details}")
                page_url = f"{NSE_ANNOUNCEMENTS_PAGE}?{urlencode({'symbol': symbol})}"

            if doc_type != document_type:
                continue
            if reporting_period and (period is None or period.normalized_label != reporting_period.normalized_label):
                continue
            if direct_url:
                try:
                    parsed_document = urlsplit(str(direct_url).strip())
                    document_host = parsed_document.hostname or ""
                    allowed_document_host = parsed_document.scheme.lower() == "https" and any(
                        document_host == domain or document_host.endswith("." + domain)
                        for domain in NSE_ALLOWED_DOMAINS
                    )
                except ValueError:
                    allowed_document_host = False
                if not allowed_document_host:
                    direct_url = None
            revision_id, revision_label = _revision_fields(row)
            metadata = {
                "filing_id": str(filing_id) if filing_id is not None else None,
                "filing_source": source_kind,
                "filing_subtype": subtype,
                "company_name_reported_by_exchange": _first(row, "cmName", "sm_name", "companyName"),
                "statement_basis": _first(row, "consolidated"),
                "audited_status": _first(row, "audited"),
                "revision_status": _first(row, "type_Sub", "old_new", "revision_Remark"),
                "xbrl_url": _first(row, "xbrl"),
            }
            output.append(DiscoveryCandidate(
                issuer_id=issuer.issuer_id,
                document_type=doc_type,
                reporting_period=period,
                title=title[:300],
                source_page_url=page_url,
                document_url=str(direct_url) if direct_url else None,
                publication_date=filed_at,
                source_provider=self.provider_id,
                verification_status=VerificationStatus.VERIFIED,
                revision_id=revision_id,
                revision_label=revision_label,
                metadata=metadata,
            ))
        return tuple(output)


def _parse_json_rows(text: str, *, expected_list: bool) -> list[dict]:
    import json

    try:
        payload = json.loads(text)
    except (TypeError, json.JSONDecodeError) as exc:
        raise OfficialSourceError("NSE returned malformed JSON.") from exc
    if expected_list:
        if not isinstance(payload, list):
            raise OfficialSourceError("NSE announcements response was not a list.")
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise OfficialSourceError("NSE integrated-filing response did not contain a data list.")
    return [row for row in payload["data"] if isinstance(row, dict)]
