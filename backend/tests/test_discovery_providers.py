import json
from pathlib import Path

import pytest

from app.services.discovery.bse import BSEDiscoveryProvider
from app.services.discovery.http import OfficialSourceRateLimited, OfficialSourceTimeout, PageResponse, SafeOfficialHttpClient, UnsafeSourceUrl
from app.services.discovery.ir import CompanyIRProvider, _period
from app.services.discovery.nse import NSEDiscoveryProvider
from app.services.discovery.providers import ProviderStatus
from app.services.discovery.schema import DocumentType, ReportingPeriod
from app.services.issuers.registry import load_issuer_registry, resolve_issuer

FIXTURES = Path(__file__).parent / "fixtures" / "discovery"


class FixtureHttp:
    def __init__(self, payloads):
        self.payloads = payloads
        self.calls = []

    def fetch(self, url, *, allowed_domains, accept="text/html,application/json"):
        self.calls.append(url)
        key = "integrated" if "integrated-filing-results" in url else "announcements" if "corporate-announcements?" in url else "html"
        body = self.payloads.get(key, b"")
        content_type = "application/json" if key in {"integrated", "announcements"} else "text/html"
        return PageResponse(url, 200, content_type, body if isinstance(body, bytes) else body.encode())


@pytest.fixture
def issuers():
    return load_issuer_registry()


def test_nse_adapter_normalizes_verified_filings_and_revisions(issuers):
    http = FixtureHttp({
        "announcements": (FIXTURES / "nse_announcements.json").read_bytes(),
        "integrated": (FIXTURES / "nse_integrated.json").read_bytes(),
    })
    provider = NSEDiscoveryProvider(http)
    result = provider.search(resolve_issuer("RELIANCE", issuers), DocumentType.QUARTERLY_RESULTS)
    assert result.status == ProviderStatus.SUCCESS
    assert len(result.candidates) == 2
    assert {x.metadata["filing_id"] for x in result.candidates} == {"NSE-FILING-101", "NSE-REV-103"}
    assert all(x.verification_status == "verified" for x in result.candidates)
    assert all(x.document_url for x in result.candidates)
    assert all(x.source_page_url.startswith("https://www.nseindia.in/") for x in result.candidates)


def test_nse_does_not_use_inherited_unverified_symbol(issuers):
    provider = NSEDiscoveryProvider(FixtureHttp({}))
    result = provider.search(resolve_issuer("TCS", issuers), DocumentType.QUARTERLY_RESULTS)
    assert result.status == ProviderStatus.ERROR
    assert result.error_type == "OfficialSourceError"


def test_nse_preserves_a_known_filing_with_missing_untrusted_attachment(issuers):
    http = FixtureHttp({
        "announcements": (FIXTURES / "nse_announcements.json").read_bytes(),
        "integrated": b'{"data": []}',
    })
    result = NSEDiscoveryProvider(http).search(resolve_issuer("RELIANCE", issuers), DocumentType.OTHER)
    assert result.status == ProviderStatus.SUCCESS
    annual = next(item for item in result.candidates if item.metadata.get("filing_id") == "NSE-FILING-102")
    assert annual.document_url is None
    assert annual.metadata["filing_subtype"] == "annual_financial_results"


def test_nse_malformed_provider_response_is_reported(issuers):
    http = FixtureHttp({"announcements": b"<html>blocked</html>", "integrated": b'{"data": []}'})
    result = NSEDiscoveryProvider(http).search(resolve_issuer("RELIANCE", issuers), DocumentType.QUARTERLY_RESULTS)
    assert result.status == ProviderStatus.ERROR
    assert "malformed JSON" in result.message


@pytest.mark.parametrize("doc_type", list(DocumentType)[:4])
def test_ril_ir_fixture_supports_four_types(issuers, doc_type):
    provider = CompanyIRProvider(FixtureHttp({"html": (FIXTURES / "ril_ir.html").read_bytes()}))
    result = provider.search(resolve_issuer("RIL", issuers), doc_type)
    assert result.status == ProviderStatus.SUCCESS
    candidate = result.candidates[0]
    assert candidate.document_type == doc_type
    assert candidate.source_page_url.startswith("https://www.ril.com/")
    assert candidate.document_url.startswith("https://rilstaticasset.akamaized.net/")
    assert candidate.verification_status == "verified"


def test_titan_empty_transcript_is_honest_empty_result(issuers):
    provider = CompanyIRProvider(FixtureHttp({"html": (FIXTURES / "titan_empty_transcript.html").read_bytes()}))
    result = provider.search(resolve_issuer("Titan", issuers), DocumentType.EARNINGS_CALL_TRANSCRIPT)
    assert result.status == ProviderStatus.EMPTY


@pytest.mark.parametrize("doc_type", list(DocumentType)[:4])
def test_titan_ir_fixture_supports_four_types_and_filters_untrusted_link(issuers, doc_type):
    provider = CompanyIRProvider(FixtureHttp({"html": (FIXTURES / "titan_ir.html").read_bytes()}))
    result = provider.search(resolve_issuer("Titan", issuers), doc_type)
    assert result.status == ProviderStatus.SUCCESS
    assert result.candidates
    assert all("attacker.example" not in (item.document_url or "") for item in result.candidates)


def test_bse_documents_unavailable_permitted_access(issuers):
    provider = BSEDiscoveryProvider()
    result = provider.search(resolve_issuer("500114", issuers), DocumentType.QUARTERLY_RESULTS)
    assert result.status == ProviderStatus.ERROR
    assert "subscription-only" in result.message
    assert result.error_type == "UnsupportedSourceAccess"


def test_http_rejects_unapproved_redirect_destination():
    class Response:
        status_code = 302
        headers = {"location": "https://127.0.0.1/private"}
    client = SafeOfficialHttpClient(request_get=lambda *a, **k: Response(), resolver=lambda host: None)
    with pytest.raises(UnsafeSourceUrl):
        client.fetch("https://www.ril.com/list", allowed_domains=("ril.com",))


def test_http_timeout_exhausts_one_bounded_retry():
    calls = []
    def timeout(*args, **kwargs):
        calls.append(1)
        raise TimeoutError("fixture timeout")
    client = SafeOfficialHttpClient(request_get=timeout, resolver=lambda host: None)
    with pytest.raises(OfficialSourceTimeout):
        client.fetch("https://www.ril.com/list", allowed_domains=("ril.com",))
    assert len(calls) == 2


def test_http_rate_limit_is_not_retried():
    calls = []
    class Response:
        status_code = 429
        headers = {"content-type": "application/json"}
    def rate_limit(*args, **kwargs):
        calls.append(1)
        return Response()
    client = SafeOfficialHttpClient(request_get=rate_limit, resolver=lambda host: None)
    with pytest.raises(OfficialSourceRateLimited):
        client.fetch("https://www.ril.com/list", allowed_domains=("ril.com",))
    assert len(calls) == 1


def test_reporting_period_parser_does_not_confuse_url_month_with_fiscal_period():
    assert _period("/2026-11/Transcript-Q2-FY2027.pdf").normalized_label == "Q2 FY2027"
    assert _period("2026 - 2027 Financial Presentation - Q2 Results").normalized_label == "Q2 FY2026-27"
    assert _period("Annual Report 1986 - 1987.pdf").normalized_label == "FY1986-1987"
    assert _period("SEearningcalltranscriptsQ2.pdf").normalized_label == "Q2"
