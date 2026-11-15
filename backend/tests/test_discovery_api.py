import pytest
from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError

from app.main import app
from app.services.discovery import api as discovery_api
from app.services.discovery.schema import DocumentType


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


def test_discovery_api_invalid_filters_are_rejected_by_contract():
    with pytest.raises(ValueError):
        DocumentType("transcript")
    with pytest.raises(ValidationError):
        TypeAdapter(DocumentType).validate_python("transcript")
    paths = app.openapi()["paths"]
    assert "/api/research/discovery" in paths
    parameters = {item["name"] for item in paths["/api/research/discovery"]["get"]["parameters"]}
    assert {"company", "document_type", "reporting_period"} <= parameters
