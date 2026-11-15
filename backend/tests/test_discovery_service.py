from app.services.discovery.providers import DiscoveryProvider
from app.services.discovery.schema import DiscoveryCandidate, DocumentType, VerificationStatus
from app.services.discovery.service import DiscoveryService


def candidate(provider, url, *, revision=None, title="Q2 FY2026-27 Quarterly Financial Results"):
    return DiscoveryCandidate(
        issuer_id="RELIANCE.NS", document_type=DocumentType.QUARTERLY_RESULTS,
        reporting_period="Q2 FY2026-27", title=title,
        source_page_url="https://www.ril.com/investors/financial-reporting",
        document_url=url, source_provider=provider, verification_status=VerificationStatus.VERIFIED,
        revision_id=revision,
    )


class FixtureProvider(DiscoveryProvider):
    def __init__(self, provider_id, items=(), error=None):
        self.provider_id, self.items, self.error = provider_id, items, error

    def discover(self, issuer, document_type, reporting_period=None):
        if self.error:
            raise RuntimeError(self.error)
        return self.items


def test_partial_provider_success_keeps_candidates_and_errors():
    providers = (
        FixtureProvider("one", [candidate("one", "https://www.ril.com/report.pdf")]),
        FixtureProvider("two", error="fixture failed"),
    )
    result = DiscoveryService(providers).discover("RIL", DocumentType.QUARTERLY_RESULTS)
    assert len(result["candidates"]) == 1
    assert any(item["status"] == "error" for item in result["providers"])
    assert result["warnings"]


def test_cross_source_duplicate_keeps_alternate_provenance_and_revisions():
    providers = (
        FixtureProvider("one", [candidate("one", "https://www.ril.com/a.pdf"), candidate("one", "https://www.ril.com/rev.pdf", revision="rev-2")]),
        FixtureProvider("two", [candidate("two", "https://www.ril.com/a.pdf", title="Quarterly financial results")]),
    )
    result = DiscoveryService(providers).discover("RELIANCE", DocumentType.QUARTERLY_RESULTS)
    assert len(result["candidates"]) == 2
    original = next(item for item in result["candidates"] if item["revision_id"] is None)
    assert original["metadata"]["alternate_sources"][0]["provider"] == "two"
