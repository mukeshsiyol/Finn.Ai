import pytest
from fastapi import BackgroundTasks
from pydantic import ValidationError

from app.main import app
from app.services.research import import_api
from app.services.research.import_api import ImportStartRequest
from app.services.research.import_repository import ImportStatusRepository


def test_import_request_requires_server_resolved_candidate_reference():
    with pytest.raises(ValidationError):
        ImportStartRequest(company="Reliance", candidate_id="anything", document_url="https://evil.example/x.pdf")
    request = ImportStartRequest(company="Reliance", candidate_id="dc_" + "a" * 32)
    assert not hasattr(request, "document_url")


def test_start_and_retry_routes_queue_only_server_side_import_ids(tmp_path, monkeypatch):
    repository = ImportStatusRepository(tmp_path / "imports.json")
    candidate = {
        "candidate_id": "dc_" + "b" * 32, "issuer_id": "RELIANCE.NS", "issuer_name": "Reliance Industries",
        "ticker": "RELIANCE.NS", "document_type": "annual_report", "reporting_period": "FY2025-26",
    }
    job, created = repository.create(candidate)

    class Service:
        def start(self, company, candidate_id, *, check_for_revision=False):
            return repository.create({**candidate, "candidate_id": candidate_id}, check_for_revision=check_for_revision)

        def process(self, import_id):
            pass

    monkeypatch.setattr(import_api, "service", Service())
    monkeypatch.setattr(import_api, "repository", repository)
    tasks = BackgroundTasks()
    response = import_api.start_document_import(ImportStartRequest(company="Reliance", candidate_id=candidate["candidate_id"]), tasks)
    assert response["status"] == "pending" and response["scheduled"] is False
    assert not tasks.tasks
    assert repository.list()[0][0]["import_id"] == job["import_id"]


def test_import_routes_are_additive_and_existing_research_upload_route_remains():
    paths = app.openapi()["paths"]
    assert "post" in paths["/api/research/discovery/import"]
    assert "get" in paths["/api/research/imports"]
    assert "get" in paths["/api/research/imports/{import_id}"]
    assert "post" in paths["/api/research/imports/{import_id}/retry"]
    assert "post" in paths["/api/research/documents"]
