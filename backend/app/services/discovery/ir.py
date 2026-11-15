"""Controlled listing-page adapters for verified company investor-relations sites."""
from __future__ import annotations

import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import PurePosixPath
from urllib.parse import unquote, urljoin, urlsplit

from app.services.discovery.http import DEFAULT_HTTP_CLIENT, SafeOfficialHttpClient
from app.services.discovery.providers import DiscoveryProvider
from app.services.discovery.schema import DiscoveryCandidate, DocumentType, ReportingPeriod, VerificationStatus
from app.services.issuers.registry import Issuer


class _Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.links.append((self._href, " ".join(" ".join(self._text).split())))
            self._href, self._text = None, []


class IRSourceNotConfigured(RuntimeError):
    """No reviewed company IR page mapping is available for this issuer."""


def _doc_type(text: str) -> DocumentType | None:
    value = text.casefold().replace("_", " ").replace("-", " ")
    if "transcript" in value and any(w in value for w in ("call", "earnings", "earning", "concall", "conference", "quarter")):
        return DocumentType.EARNINGS_CALL_TRANSCRIPT
    if "annual report" in value or "integrated annual report" in value:
        return DocumentType.ANNUAL_REPORT
    if any(w in value for w in ("quarterly result", "financial result", "unaudited result", "audited result", "results for the quarter", "financial performance for the quarter", "quarter ended")):
        return DocumentType.QUARTERLY_RESULTS
    if any(w in value for w in ("investor presentation", "analyst presentation", "investor meet presentation", "investor day presentation", "financial presentation", "earnings presentation")):
        return DocumentType.INVESTOR_PRESENTATION
    return None


def _period(text: str) -> ReportingPeriod | None:
    text = text.replace("_", " ")
    text = re.sub(r"(?i)\b(Q[1-4])\s*-\s*(FY)", r"\1 \2", text)
    match = re.search(r"(?i)\bq\s*([1-4])\s*(?:of\s*)?fy\s*([0-9]{2,4}(?:\s*[-/]\s*[0-9]{2,4})?)", text)
    if match:
        return ReportingPeriod.from_label(f"Q{match.group(1)} FY{match.group(2)}")
    match = re.search(r"(?i)\b(20\d{2})\s*[-/]\s*(\d{2,4}).*?\bq\s*([1-4])\s*(?:results?)?", text)
    if match:
        start, end = int(match.group(1)), match.group(2)
        expected_end = (start + 1) % 100
        if int(end[-2:]) == expected_end:
            return ReportingPeriod.from_label(f"Q{match.group(3)} FY{start}-{end[-2:]}")
    match = re.search(r"(?i)\b(?:FY|financial year)\s*([0-9]{4}(?:\s*[-/]\s*[0-9]{2,4})?)", text)
    if match:
        return ReportingPeriod.from_label(f"FY{match.group(1)}")
    if "annual report" in text.casefold():
        match = re.search(r"(?i)annual\s+report[^0-9]{0,60}((?:19|20)\d{2})\s*[-/]\s*(\d{2,4})\b", text)
        if match:
            return ReportingPeriod.from_label(f"FY{match.group(1)}-{match.group(2)}")
    quarter_only = re.search(r"(?i)q\s*([1-4])(?=\D|$)", text)
    if quarter_only:
        return ReportingPeriod.from_label(f"Q{quarter_only.group(1)}")
    return None


def _publication_date(text: str) -> datetime | None:
    for pattern in (r"\b(20\d{2})[-_](\d{2})[-_](\d{2})\b", r"\b(\d{2})[-_](\d{2})[-_](20\d{2})\b"):
        found = re.search(pattern, text)
        if found:
            parts = list(map(int, found.groups()))
            try:
                return datetime(*parts) if pattern.startswith(r"\b(20") else datetime(parts[2], parts[1], parts[0])
            except ValueError:
                pass
    month_day = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b", text, re.I)
    if month_day:
        try:
            return datetime.strptime(" ".join(month_day.groups()), "%b %d %Y")
        except ValueError:
            pass
    return None


class CompanyIRProvider(DiscoveryProvider):
    provider_id = "ir"
    # Explicitly reviewed listing pages; no generic crawling or following links.
    PAGES = {
        "RELIANCE.NS": {
            "annual_report": "https://www.ril.com/investors/financial-reporting",
            "quarterly_results": "https://www.ril.com/investors/financial-reporting",
            "earnings_call_transcript": "https://www.ril.com/investors/events-presentations",
            "investor_presentation": "https://www.ril.com/investors/financial-reporting",
        },
        "research:titan": {
            "annual_report": (
                "https://www.titancompany.in/investors/annual-reports",
                "https://www.titancompany.in/investors/corporate-announcements",
            ),
            "quarterly_results": "https://www.titancompany.in/investors/investor-relations/quarterly-results",
            "earnings_call_transcript": "https://www.titancompany.in/investors/corporate-announcements",
            "investor_presentation": (
                "https://www.titancompany.in/investors/presentations-at-investor-conferences",
                "https://www.titancompany.in/investors/investor-relations/quarterly-results",
                "https://www.titancompany.in/investors/corporate-announcements",
            ),
        },
    }
    DOCUMENT_HOSTS = {
        "RELIANCE.NS": ("rilstaticasset.akamaized.net",),
        "research:titan": (),
    }

    def __init__(self, http: SafeOfficialHttpClient = DEFAULT_HTTP_CLIENT):
        self.http = http

    def discover(self, issuer: Issuer, document_type: DocumentType, reporting_period: ReportingPeriod | None = None):
        configured_pages = self.PAGES.get(issuer.issuer_id, {}).get(document_type.value)
        if document_type == DocumentType.OTHER:
            return ()
        if not configured_pages:
            raise IRSourceNotConfigured("No reviewed investor-relations listing page is configured for this issuer/document type.")
        pages = configured_pages if isinstance(configured_pages, tuple) else (configured_pages,)
        approved = tuple(domain.domain for domain in issuer.official_ir_domains if domain.status == "verified")
        if not approved:
            raise IRSourceNotConfigured("No verified investor-relations domain is configured for this issuer.")
        found: dict[str, DiscoveryCandidate] = {}
        for page in pages:
            host = urlsplit(page).hostname or ""
            if not any(host == d or host.endswith("." + d) for d in approved):
                raise RuntimeError("Configured IR page is outside the issuer's verified domains.")
            response = self.http.fetch(page, allowed_domains=approved)
            parser = _Links()
            parser.feed(response.text)
            for href, label in parser.links:
                if not href or href.startswith(("#", "mailto:", "javascript:")):
                    continue
                absolute = urljoin(response.url, href)
                parsed = urlsplit(absolute)
                # Direct links are allowlisted per verified company site. Listing HTML
                # itself is never fetched recursively and documents are never downloaded.
                link_host = parsed.hostname or ""
                approved_document_hosts = approved + self.DOCUMENT_HOSTS.get(issuer.issuer_id, ())
                if parsed.scheme != "https" or not any(link_host == d or link_host.endswith("." + d) for d in approved_document_hosts):
                    continue
                path_name = unquote(PurePosixPath(parsed.path).name)
                if parsed.path.rstrip("/").casefold() == urlsplit(response.url).path.rstrip("/").casefold():
                    continue
                if PurePosixPath(parsed.path).suffix.casefold() not in {".pdf", ".xlsx", ".xls", ".csv", ".xml", ".html", ".htm"}:
                    continue
                text = f"{label} {path_name} {parsed.path}"
                if _doc_type(text) != document_type:
                    continue
                title = " ".join((label if label and label.casefold() not in {"view", "view details", "download", "read more", "know more"} else PurePosixPath(path_name).stem).split())
                if not title:
                    continue
                candidate = DiscoveryCandidate(
                    issuer_id=issuer.issuer_id,
                    document_type=document_type,
                    reporting_period=_period(text),
                    title=title[:300],
                    source_page_url=response.url,
                    document_url=absolute,
                    publication_date=_publication_date(text),
                    source_provider=self.provider_id,
                    verification_status=VerificationStatus.VERIFIED,
                    metadata={"link_text": label[:300], "listing_page": page},
                )
                if reporting_period and (not candidate.reporting_period or candidate.reporting_period.normalized_label != reporting_period.normalized_label):
                    continue
                found.setdefault(candidate.candidate_id, candidate)
        return tuple(found.values())
