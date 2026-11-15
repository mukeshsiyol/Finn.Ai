import pytest
from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError

from app.main import app
from app.services.discovery import api as discovery_api
from app.services.discovery.providers import DiscoveryProvider
from app.services.discovery.schema import DocumentType
from app.services.discovery.service import DiscoveryService


class FakeDiscovery:
    def discover(self, company, document_type=None, reporting_period=None):
        return {"issuer": {"canonical_name": "Reliance Industries"}, "candidates": [], "providers": [], "discovered_at": "2026-11-15T00:00:00+00:00", "warnings": []}


@pytest.mark.parametrize("doc_type,period", [(DocumentType.QUARTERLY_RESULTS, None), (None, "Q2 FY2026-27")])
def test_discovery_api_response_contract_without_socket_loop(monkeypatch, doc_type, period):
    monkeypatch.setattr(discovery_api, "_service", FakeDiscovery())
    payload = discovery_api.get_public_discovery("RIL", doc_type, period)
    assert payload["issuer"]["canonical_name"] == "Reliance Industries"
    assert {"candidates", "providers", "discovered_at", "warnings"} <= payload.keys()


def test_discovery_api_unknown_issuer_maps_to_404(monkeypatch):
    class Unknown:
        def discover(self, *args):
            from app.services.issuers.registry import UnknownIssuerError
            raise UnknownIssuerError("unknown")
    monkeypatch.setattr(discovery_api, "_service", Unknown())
    with pytest.raises(HTTPException) as error:
        discovery_api.get_public_discovery("unknown-company", None, None)
    assert error.value.status_code == 404


@pytest.mark.parametrize("company,issuer_id,canonical_name,nse_symbol", [
    ("Bajaj Finance Limited", "research:bajajfinance", "Bajaj Finance Limited", "BAJFINANCE"),
    ("Reliance Industries Limited", "RELIANCE.NS", "Reliance Industries", "RELIANCE"),
])
@pytest.mark.parametrize("period_label", [None, "FY2025"])
def test_supported_company_discovery_returns_empty_result_not_unknown_issuer_404(monkeypatch, company, issuer_id, canonical_name, nse_symbol, period_label):
    calls = []

    class EmptyFixtureProvider(DiscoveryProvider):
        provider_id = "fixture"

        def discover(self, issuer, document_type, reporting_period=None):
            calls.append((issuer.issuer_id, document_type, reporting_period.normalized_label if reporting_period else None))
            return ()

    monkeypatch.setattr(discovery_api, "_service", DiscoveryService((EmptyFixtureProvider(),)))
    payload = discovery_api.get_public_discovery(company, None, period_label)

    assert payload["issuer"]["issuer_id"] == issuer_id
    assert payload["issuer"]["canonical_name"] == canonical_name
    assert payload["issuer"]["nse_symbol"] == {"value": nse_symbol, "status": "verified"}
    assert payload["candidates"] == []
    assert payload["warnings"] == []
    assert len(calls) == len(DocumentType)
    assert {call[2] for call in calls} == {period_label}


def test_discovery_api_invalid_filters_are_rejected_by_contract():
    with pytest.raises(ValueError):
        DocumentType("transcript")
    with pytest.raises(ValidationError):
        TypeAdapter(DocumentType).validate_python("transcript")
    paths = app.openapi()["paths"]
    assert "/api/research/discovery" in paths
    parameters = {item["name"] for item in paths["/api/research/discovery"]["get"]["parameters"]}
    assert {"company", "document_type", "reporting_period"} <= parameters
