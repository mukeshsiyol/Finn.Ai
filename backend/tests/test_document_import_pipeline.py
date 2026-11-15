import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.discovery.schema import DiscoveryCandidate, DocumentType, VerificationStatus
from app.services.research import documents
from app.services.research import import_service as import_service_module
from app.services.research.document_identity import DocumentIdentityService
from app.services.research.downloader import DownloadedFile
from app.services.research.import_repository import ImportStatusRepository
from app.services.research.import_service import ImportService


def pdf_bytes(text="Revenue was 100 crore"):
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(result)
    result.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        result.extend(f"{offset:010} 00000 n \n".encode())
    result.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(result)


def make_candidate(period="FY2025-26", url="https://rilstaticasset.akamaized.net/annual-report.pdf"):
    return DiscoveryCandidate(
        issuer_id="RELIANCE.NS", document_type=DocumentType.ANNUAL_REPORT,
        reporting_period=period, title="Reliance Annual Report", source_page_url="https://www.ril.com/investors/financial-reporting",
        document_url=url, source_provider="ir", verification_status=VerificationStatus.VERIFIED,
    )


class FakeDiscovery:
    def __init__(self, candidates):
        self.candidates = candidates

    def discover(self, company):
        return {"candidates": [item.model_dump(mode="json") for item in self.candidates]}


class FakeDownloader:
    def __init__(self, body):
        self.body = body
        self.calls = 0

    def download(self, url, destination, *, allowed_domains):
        self.calls += 1
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(self.body)
        return DownloadedFile(destination, len(self.body), hashlib.sha256(self.body).hexdigest(), "application/pdf", url)


@pytest.fixture
def isolated_store(tmp_path, monkeypatch):
    reports = tmp_path / "reports"
    uploads = reports / "uploads"
    reports.mkdir()
    uploads.mkdir()
    monkeypatch.setattr(documents, "REPORTS_DIR", reports)
    monkeypatch.setattr(documents, "UPLOADS_DIR", uploads)
    monkeypatch.setattr(documents, "MANIFEST_PATH", reports / "documents.json")
    monkeypatch.setattr(import_service_module, "UPLOADS_DIR", uploads)
    monkeypatch.setattr(import_service_module, "REPORTS_DIR", reports)
    documents._page_text_cache.clear()
    return reports, uploads


def test_import_indexes_into_existing_research_library_and_cites_source(isolated_store):
    reports, uploads = isolated_store
    candidate = make_candidate()
    downloader = FakeDownloader(pdf_bytes())
    service = ImportService(
        repository=ImportStatusRepository(reports / "imports.json"),
        discovery=FakeDiscovery([candidate]), downloader=downloader,
    )
    job, created = service.start("Reliance Industries", candidate.candidate_id)
    assert created and job["status"] == "pending"
    service.process(job["import_id"])
    ready = service.repository.get(job["import_id"])
    assert ready["status"] == "ready"
    assert ready["document_metadata"]["source_page_url"].startswith("https://www.ril.com/")
    record, evidence = documents.retrieve_pages(ready["document_id"], "revenue 100 crore")
    assert record["id"] == ready["document_id"]
    assert evidence and evidence[0]["page"] == 1
    assert "Revenue was 100 crore" in evidence[0]["excerpt"]
    assert len(list(uploads.glob("*.pdf"))) == 1
    assert ready["extraction_summary"]["page_count"] == 1


def test_duplicate_import_is_idempotent_and_changed_content_is_revision(isolated_store):
    reports, _ = isolated_store
    first = make_candidate()
    downloader = FakeDownloader(pdf_bytes())
    service = ImportService(repository=ImportStatusRepository(reports / "imports.json"), discovery=FakeDiscovery([first]), downloader=downloader)
    first_job, _ = service.start("Reliance Industries", first.candidate_id)
    service.process(first_job["import_id"])
    same_job, created = service.start("Reliance Industries", first.candidate_id)
    assert not created and same_job["import_id"] == first_job["import_id"]
    assert downloader.calls == 1

    second_job, created = service.start("Reliance Industries", first.candidate_id, check_for_revision=True)
    assert created
    downloader.body = pdf_bytes("Revenue was 110 crore")
    service.process(second_job["import_id"])
    updated = documents.get_document_record(service.repository.get(second_job["import_id"])["document_id"])
    previous = documents.get_document_record(service.repository.get(first_job["import_id"])["document_id"])
    assert service.repository.get(second_job["import_id"])["status"] == "ready"
    assert updated["replaces"] == previous["id"]
    assert previous["superseded_by"] == updated["id"]


def test_pdf_validator_rejects_html_truncated_empty_and_scanned_files(isolated_store):
    _, uploads = isolated_store
    valid = uploads / "valid.pdf"
    valid.write_bytes(pdf_bytes())
    assert documents.validate_pdf_file(valid)["pages"] == 1
    for name, body in (("html.pdf", b"<html>error</html>"), ("truncated.pdf", b"%PDF-1.4 no eof"), ("empty.pdf", b"")):
        path = uploads / name
        path.write_bytes(body)
        with pytest.raises(HTTPException):
            documents.validate_pdf_file(path)
    scanned = uploads / "scanned.pdf"
    # A valid PDF page with no text operators behaves like an image-only page.
    scanned.write_bytes(pdf_bytes(""))
    with pytest.raises(HTTPException, match="selectable text"):
        documents.validate_pdf_file(scanned)
    with pytest.raises(HTTPException, match="between 1 and 0"):
        documents.validate_pdf_file(valid, max_pages=0)


def test_encrypted_pdf_is_rejected(isolated_store):
    _, uploads = isolated_store
    from pypdf import PdfReader, PdfWriter

    unencrypted = uploads / "source.pdf"
    unencrypted.write_bytes(pdf_bytes())
    reader = PdfReader(str(unencrypted))
    writer = PdfWriter()
    writer.append_pages_from_reader(reader)
    writer.encrypt("fixture-password")
    encrypted = uploads / "encrypted.pdf"
    with encrypted.open("wb") as stream:
        writer.write(stream)
    with pytest.raises(HTTPException, match="Encrypted PDFs"):
        documents.validate_pdf_file(encrypted)


def test_concurrent_duplicate_requests_create_one_active_import(tmp_path):
    candidate = make_candidate().model_dump(mode="json")
    repository = ImportStatusRepository(tmp_path / "imports.json")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: repository.create(candidate), range(16)))
    assert sum(created for _, created in results) == 1
    assert len({job["import_id"] for job, _ in results}) == 1


def test_invalid_pdf_import_fails_without_ready_state_or_indexed_record(isolated_store):
    reports, _ = isolated_store
    candidate = make_candidate()
    service = ImportService(
        repository=ImportStatusRepository(reports / "imports.json"),
        discovery=FakeDiscovery([candidate]), downloader=FakeDownloader(b"<html>not a PDF</html>"),
    )
    job, _ = service.start("Reliance Industries", candidate.candidate_id)
    service.process(job["import_id"])
    failed = service.repository.get(job["import_id"])
    assert failed["status"] == "failed"
    assert failed["failure_category"] == "document_processing"
    assert not documents.list_documents()


def test_retryable_failure_reuses_import_job_and_preserves_attempts(isolated_store):
    reports, _ = isolated_store
    candidate = make_candidate()
    service = ImportService(repository=ImportStatusRepository(reports / "imports.json"), discovery=FakeDiscovery([candidate]), downloader=FakeDownloader(pdf_bytes()))
    job, _ = service.start("Reliance Industries", candidate.candidate_id)
    service.repository.begin_attempt(job["import_id"])
    service.repository.fail(job["import_id"], category="network", reason="temporary failure", retryable=True)
    retried, scheduled = service.repository.retry(job["import_id"])
    assert scheduled and retried["status"] == "pending"
    service.process(job["import_id"])
    final = service.repository.get(job["import_id"])
    assert final["status"] == "ready"
    assert len(service.repository.get_internal(job["import_id"])["attempts"]) == 2


def test_distinct_source_document_ids_and_revisions_are_not_checksum_deduplicated():
    identity = DocumentIdentityService()
    first = make_candidate().model_copy(update={"metadata": {"filing_id": "filing-1"}, "revision_id": "original"})
    second = make_candidate().model_copy(update={"metadata": {"filing_id": "filing-2"}, "revision_id": "revised"})
    existing = {
        "id": "first", "issuer_id": first.issuer_id, "document_type": first.document_type,
        "reporting_period": first.reporting_period.normalized_label, "statement_basis": None,
        "source_provider": first.source_provider, "document_url": first.document_url,
        "source_document_id": "filing-1", "revision_id": "original", "sha256": "same-bytes",
    }
    matched = identity.match([existing], second, "same-bytes")
    assert matched.identical is None
    assert matched.previous_revision is existing
