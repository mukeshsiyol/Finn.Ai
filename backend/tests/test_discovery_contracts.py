import pytest
from pydantic import ValidationError

from app.services.discovery.providers import DiscoveryProvider, ProviderStatus
from app.services.discovery.schema import (
    DiscoveryCandidate,
    DocumentType,
    PeriodKind,
    ReportingPeriod,
    VerificationStatus,
    normalize_reporting_period,
)
from app.services.issuers.registry import load_issuer_registry


def candidate(**overrides):
    values = {
        "issuer_id": "RELIANCE.NS",
        "document_type": "quarterly_results",
        "reporting_period": "Q2 FY 2026-27",
        "title": "Quarterly results",
        "source_page_url": "https://www.ril.com/investors/financial-reporting",
        "source_provider": "ril_ir",
        "verification_status": "verified",
    }
    values.update(overrides)
    return DiscoveryCandidate(**values)


def test_valid_candidate_derives_host_and_keeps_provenance():
    result = candidate()
    assert result.issuer_id == "RELIANCE.NS"
    assert result.document_type == DocumentType.QUARTERLY_RESULTS
    assert result.source_host == "www.ril.com"
    assert result.verification_status == VerificationStatus.VERIFIED
    assert result.reporting_period.normalized_label == "Q2 FY2026-27"


def test_document_url_is_optional():
    result = candidate()
    assert result.document_url is None


@pytest.mark.parametrize("url", [
    "not a URL",
    "https:/missing-host",
    "https://user:password@ril.com/private.pdf",
    "https://ril.com:invalid/file.pdf",
])
def test_malformed_urls_are_rejected(url):
    with pytest.raises(ValidationError):
        candidate(document_url=url)


@pytest.mark.parametrize("url", [
    "http://ril.com/report.pdf",
    "ftp://ril.com/report.pdf",
    "javascript:alert(1)",
])
def test_unsupported_url_schemes_are_rejected(url):
    with pytest.raises(ValidationError):
        candidate(document_url=url)


def test_invalid_issuer_id_is_rejected():
    with pytest.raises(ValidationError, match="issuer_id is not present"):
        candidate(issuer_id="unknown-issuer")


def test_invalid_document_type_is_rejected():
    with pytest.raises(ValidationError):
        candidate(document_type="press_release")


def test_reporting_period_normalization_is_conservative():
    quarter = normalize_reporting_period(" q 2 of FY 2026 / 27 ")
    assert quarter is not None
    assert quarter.normalized_label == "Q2 FY2026-27"
    assert quarter.kind == PeriodKind.FISCAL_QUARTER
    assert quarter.fiscal_year == "2026-27"
    assert quarter.quarter == 2

    annual = ReportingPeriod.from_label("FY 2025-26")
    assert annual.normalized_label == "FY2025-26"
    assert annual.kind == PeriodKind.ANNUAL

    date_label = ReportingPeriod.from_label("Quarter ended September 30, 2026")
    assert date_label.kind == PeriodKind.OTHER
    assert date_label.normalized_label == "Quarter ended September 30, 2026"
    assert normalize_reporting_period(None) is None


def test_candidate_identity_and_deduplication_are_stable():
    first = candidate(source_page_url="https://www.ril.com/results?q=Q2#top")
    same_record = candidate(source_page_url="https://www.ril.com/results?q=Q2#page=2")
    from_other_provider = candidate(source_provider="ril_ir_archive", source_page_url="https://www.ril.com/results?q=Q2")
    same_period_different_label_format = candidate(
        source_page_url="https://www.ril.com/results?q=Q2#period",
        reporting_period="Q 2 of FY2026/27",
    )

    assert first.candidate_id == same_record.candidate_id
    assert first.deduplication_key == same_record.deduplication_key
    assert first.candidate_id == same_period_different_label_format.candidate_id
    assert first.candidate_id != from_other_provider.candidate_id
    assert first.deduplication_key == from_other_provider.deduplication_key
    assert "candidate_id" in first.model_dump()
    assert "deduplication_key" in first.model_dump()


def test_revised_filings_remain_distinct_candidates():
    original = candidate(document_url="https://www.ril.com/files/results.pdf", revision_id="original")
    revised = candidate(document_url="https://www.ril.com/files/results.pdf", revision_id="revision-1", revision_label="Revised filing")
    separately_hosted_revision = candidate(document_url="https://www.ril.com/files/results-revised.pdf", revision_id="revision-1")

    assert original.candidate_id != revised.candidate_id
    assert original.deduplication_key != revised.deduplication_key
    assert revised.candidate_id != separately_hosted_revision.candidate_id


def test_familiar_company_name_does_not_verify_unapproved_url():
    with pytest.raises(ValidationError, match="cannot be marked verified"):
        candidate(source_page_url="https://ril.com.fake-example.org/reliance/annual-report")


def test_inherited_unverified_ticker_cannot_verify_exchange_candidate():
    tcs = next(item for item in load_issuer_registry() if item.canonical_name == "TCS")
    assert tcs.nse_symbol.status == "inherited_unverified"
    with pytest.raises(ValidationError, match="cannot be marked verified"):
        candidate(
            issuer_id=tcs.issuer_id,
            source_provider="nse",
            source_page_url="https://www.nseindia.com/companies-listing/corporate-filings-announcements",
            verification_status="verified",
        )


class FixtureProvider(DiscoveryProvider):
    provider_id = "fixture"

    def __init__(self, outcome="success", candidates=None):
        self.outcome = outcome
        self.fixture_candidates = candidates or []

    def discover(self, issuer, document_type, reporting_period=None):
        if self.outcome == "timeout":
            raise TimeoutError("fixture timeout")
        if self.outcome == "error":
            raise RuntimeError("fixture provider failure")
        return self.fixture_candidates


def run(provider, issuer=None, document_type=DocumentType.QUARTERLY_RESULTS, period=None):
    issuer = issuer or next(item for item in load_issuer_registry() if item.issuer_id == "RELIANCE.NS")
    return provider.search(issuer, document_type, period)


def test_provider_represents_success_and_empty_results():
    valid = candidate(source_provider="fixture", verification_status="unverified")
    success = run(FixtureProvider(candidates=[valid]))
    empty = run(FixtureProvider(outcome="empty"))
    assert success.status == ProviderStatus.SUCCESS
    assert success.candidates == (valid,)
    assert empty.status == ProviderStatus.EMPTY
    assert empty.candidates == ()


def test_provider_represents_timeout_and_failure_independently():
    timeout = run(FixtureProvider(outcome="timeout"))
    failure = run(FixtureProvider(outcome="error"))
    assert timeout.status == ProviderStatus.TIMEOUT
    assert timeout.error_type == "TimeoutError"
    assert failure.status == ProviderStatus.ERROR
    assert failure.error_type == "RuntimeError"


def test_provider_rejects_candidates_outside_requested_scope():
    wrong_type = candidate(source_provider="fixture", verification_status="unverified", document_type="annual_report")
    result = run(FixtureProvider(candidates=[wrong_type]))
    assert result.status == ProviderStatus.ERROR
    assert result.error_type == "ProviderContractError"


def test_provider_result_requires_consistent_status_payload():
    from app.services.discovery.providers import ProviderResult

    with pytest.raises(ValidationError):
        ProviderResult(provider_id="fixture", status=ProviderStatus.SUCCESS)
    with pytest.raises(ValidationError):
        ProviderResult(provider_id="fixture", status=ProviderStatus.TIMEOUT)
