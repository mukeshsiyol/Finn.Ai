"""Selected-candidate import orchestration into FINN's existing Research store."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from threading import Lock
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from fastapi import HTTPException

from app.services.discovery.schema import DiscoveryCandidate
from app.services.discovery.service import DiscoveryService
from app.services.discovery.source_policy import SourcePolicyError, approved_document_domains
from app.services.issuers.registry import AmbiguousIssuerError, UnknownIssuerError, load_issuer_registry
from app.services.research.document_identity import DocumentIdentityService
from app.services.research.documents import (
    REPORTS_DIR, UPLOADS_DIR, _manifest, add_pdf_file, extract_document_pages,
    document_file_sha256, get_document_record, link_document_revision, set_document_index_status,
    update_document_record, validate_pdf_file,
)
from app.services.research.downloader import DownloadFailure, SecureDocumentDownloader
from app.services.research.import_repository import ImportStatusRepository


logger = logging.getLogger("finn.research.imports")
_document_commit_lock = Lock()


class ImportService:
    def __init__(
        self,
        *,
        repository: ImportStatusRepository | None = None,
        discovery: DiscoveryService | None = None,
        downloader: SecureDocumentDownloader | None = None,
        identity: DocumentIdentityService | None = None,
    ):
        self.repository = repository or ImportStatusRepository()
        self.discovery = discovery or DiscoveryService()
        self.downloader = downloader or SecureDocumentDownloader()
        self.identity = identity or DocumentIdentityService()

    def start(self, company: str, candidate_id: str, *, check_for_revision: bool = False) -> tuple[dict, bool]:
        try:
            discovered = self.discovery.discover(company)
        except UnknownIssuerError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except AmbiguousIssuerError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raw = next((candidate for candidate in discovered["candidates"] if candidate.get("candidate_id") == candidate_id), None)
        if raw is None:
            raise HTTPException(status_code=404, detail="That candidate is no longer available from the selected issuer's official sources. Refresh discovery and select it again.")
        candidate = DiscoveryCandidate.model_validate(raw)
        try:
            domains = approved_document_domains(candidate)
        except SourcePolicyError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not candidate.document_url:
            raise HTTPException(status_code=422, detail="This filing has no direct PDF attachment and cannot be imported.")
        issuer = next((item for item in load_issuer_registry() if item.issuer_id == candidate.issuer_id), None)
        if not issuer:
            raise HTTPException(status_code=404, detail="Candidate issuer is no longer registered.")
        ticker = issuer.portfolio_ticker
        if not ticker and issuer.nse_symbol.status == "verified" and issuer.nse_symbol.value:
            ticker = f"{issuer.nse_symbol.value}.NS"
        if not ticker:
            raise HTTPException(status_code=422, detail="This issuer has no verified Research ticker mapping.")
        snapshot = candidate.model_dump(mode="json")
        snapshot.update({"issuer_name": issuer.canonical_name, "ticker": ticker})
        # Policy is run once before enqueue and again immediately before network I/O.
        if not domains:
            raise HTTPException(status_code=422, detail="No approved document host is configured for this candidate.")
        return self.repository.create(snapshot, check_for_revision=check_for_revision)

    def process(self, import_id: str) -> None:
        job = self.repository.begin_attempt(import_id)
        if not job:
            return
        candidate: DiscoveryCandidate | None = None
        temporary: Path | None = None
        document_id: str | None = job.get("document_id")
        try:
            candidate = DiscoveryCandidate.model_validate(job["candidate"])
            allowed_domains = approved_document_domains(candidate)
            if not candidate.document_url:
                raise SourcePolicyError("The selected candidate has no direct document URL.")
            if document_id and get_document_record(document_id) and document_file_sha256(document_id):
                self._process_existing_document(job, candidate, document_id)
                return
            if document_id:
                # A crash may have persisted import metadata before the staged
                # PDF reached its final path. Retry by downloading it again.
                document_id = None

            UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
            temporary = UPLOADS_DIR / f".finn-import-{import_id}.part"
            download = self.downloader.download(candidate.document_url, temporary, allowed_domains=allowed_domains)
            self.repository.transition(import_id, "validating")
            validation = validate_pdf_file(download.path)
            if validation["size_bytes"] != download.size_bytes:
                raise HTTPException(status_code=422, detail="Downloaded PDF size changed during validation.")

            issuer = next(item for item in load_issuer_registry() if item.issuer_id == candidate.issuer_id)
            reporting_period = candidate.reporting_period.normalized_label if candidate.reporting_period else ""
            filename = self._filename(candidate.document_url, candidate.title)
            source_metadata = self._source_metadata(candidate)
            alternate_source = self._alternate_source(candidate)
            previous_revision = None
            identical_document = None
            possible_duplicates: tuple[str, ...] = ()

            with _document_commit_lock:
                manifest = _manifest()
                match = self.identity.match(manifest, candidate, download.sha256)
                identical_document = match.identical
                previous_revision = match.previous_revision
                possible_duplicates = match.possible_duplicate_ids
                if identical_document:
                    record = get_document_record(str(identical_document["id"]))
                    if not record or document_file_sha256(str(identical_document["id"])) != download.sha256:
                        if identical_document.get("id"):
                            possible_duplicates = tuple(dict.fromkeys((*possible_duplicates, str(identical_document["id"]))))
                        identical_document = None
                    else:
                        self._merge_alternate_source(record, alternate_source)
                        document_id = record["id"]
                        self.repository.attach_document(import_id, document_id, self._public_document_metadata(record))
                if not identical_document:
                    extra = {
                        "import_id": import_id,
                        "issuer_id": candidate.issuer_id,
                        "discovery_candidate_id": candidate.candidate_id,
                        "source_provider": candidate.source_provider,
                        "source_page_url": candidate.source_page_url,
                        "document_url": candidate.document_url,
                        "source_host": candidate.source_host,
                        "document_subtype": candidate.metadata.get("filing_subtype"),
                        "publication_date": candidate.publication_date.isoformat() if candidate.publication_date else None,
                        "statement_basis": source_metadata.get("statement_basis"),
                        "audited_status": source_metadata.get("audited_status"),
                        "source_document_id": source_metadata.get("filing_id"),
                        "revision_id": candidate.revision_id,
                        "revision_label": candidate.revision_label,
                        "source_metadata": source_metadata,
                        "alternate_sources": [alternate_source],
                        "possible_duplicate_of": list(possible_duplicates),
                        "imported_at": datetime.now(timezone.utc).isoformat(),
                        "final_document_url": download.final_url,
                    }
                    created = add_pdf_file(
                        issuer.canonical_name, str(job["ticker"]), candidate.document_type,
                        reporting_period, download.path, filename,
                        source_url=candidate.document_url, extra_metadata=extra,
                        initial_indexing_status="processing", allow_duplicate_checksum=True,
                        expected_sha256=download.sha256, index_immediately=False,
                    )
                    document_id = created["id"]
                    self.repository.attach_document(import_id, document_id, self._public_document_metadata(get_document_record(document_id) or created))

            self.repository.transition(import_id, "extracting", document_id=document_id)
            if identical_document:
                current = get_document_record(document_id)
                if not current:
                    raise HTTPException(status_code=404, detail="The identical indexed document disappeared during import.")
                if current.get("indexing_status") != "indexed":
                    summary = extract_document_pages(document_id)
                    self.repository.transition(import_id, "indexing", document_id=document_id)
                    set_document_index_status(document_id, "indexed", None, extraction_summary=summary)
                else:
                    self.repository.transition(import_id, "indexing", document_id=document_id)
                    summary = current.get("extraction_summary") or {"page_count": current.get("pages"), "text_pages": None, "chunk_count": None, "limitations": []}
            else:
                summary = extract_document_pages(document_id)
                self.repository.transition(import_id, "indexing", document_id=document_id)
                set_document_index_status(document_id, "indexed", None, extraction_summary=summary)

            if previous_revision and previous_revision.get("id") != document_id:
                link_document_revision(str(previous_revision["id"]), document_id)
            completed_record = get_document_record(document_id) or {}
            self.repository.transition(
                import_id,
                "ready",
                document_id=document_id,
                document_metadata=self._public_document_metadata(completed_record),
                extraction_summary=summary,
            )
            logger.info(
                "research_import_ready import_id=%s issuer_id=%s provider=%s document_id=%s pages=%s chunks=%s",
                import_id, candidate.issuer_id, candidate.source_provider, document_id,
                summary.get("page_count"), summary.get("chunk_count"),
            )
        except DownloadFailure as exc:
            self._fail(import_id, document_id, exc.category, str(exc), exc.retryable)
        except SourcePolicyError as exc:
            self._fail(import_id, document_id, "source_policy", str(exc), False)
        except HTTPException as exc:
            self._fail(import_id, document_id, "document_processing", str(exc.detail), exc.status_code >= 500)
        except Exception as exc:
            logger.error("research_import_failed import_id=%s error_type=%s", import_id, type(exc).__name__)
            self._fail(import_id, document_id, "internal", "The document import could not be completed. Review the source and retry if the failure may be temporary.", True)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    def _process_existing_document(self, job: dict, candidate: DiscoveryCandidate, document_id: str) -> None:
        record = get_document_record(document_id)
        if not record:
            raise HTTPException(status_code=404, detail="Stored document is missing.")
        self.repository.transition(job["import_id"], "validating")
        self.repository.transition(job["import_id"], "extracting", document_id=document_id)
        if record.get("indexing_status") != "indexed":
            summary = extract_document_pages(document_id)
            self.repository.transition(job["import_id"], "indexing", document_id=document_id)
            set_document_index_status(document_id, "indexed", None, extraction_summary=summary)
        else:
            self.repository.transition(job["import_id"], "indexing", document_id=document_id)
            summary = record.get("extraction_summary") or {"page_count": record.get("pages"), "text_pages": None, "chunk_count": None, "limitations": []}
        self.repository.transition(job["import_id"], "ready", document_id=document_id, document_metadata=self._public_document_metadata(record), extraction_summary=summary)

    def _fail(self, import_id: str, document_id: str | None, category: str, reason: str, retryable: bool) -> None:
        if document_id:
            record = get_document_record(document_id)
            if record and record.get("indexing_status") == "processing":
                try:
                    set_document_index_status(document_id, "failed", reason[:500])
                except Exception:
                    pass
        failed = self.repository.fail(import_id, category=category, reason=reason, retryable=retryable)
        if failed:
            logger.warning(
                "research_import_failed import_id=%s issuer_id=%s status=failed category=%s retryable=%s",
                import_id, failed.get("issuer_id"), category, retryable,
            )

    @staticmethod
    def _filename(document_url: str, title: str) -> str:
        path_name = unquote(PurePosixPath(urlsplit(document_url).path).name)
        cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", path_name).strip(" .")
        if not cleaned or not cleaned.lower().endswith(".pdf"):
            cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", title).strip(" .")[:130] + ".pdf"
        return cleaned[:160]

    @staticmethod
    def _source_metadata(candidate: DiscoveryCandidate) -> dict:
        allowed = {"filing_id", "filing_source", "filing_subtype", "statement_basis", "audited_status", "revision_status", "link_text"}
        result = {}
        for key in allowed:
            value = candidate.metadata.get(key)
            if isinstance(value, (str, int, float, bool)) or value is None:
                if value is not None:
                    result[key] = str(value)[:300] if isinstance(value, str) else value
        return result

    @staticmethod
    def _alternate_source(candidate: DiscoveryCandidate) -> dict:
        return {
            "provider": candidate.source_provider,
            "candidate_id": candidate.candidate_id,
            "source_page_url": candidate.source_page_url,
            "document_url": candidate.document_url,
            "source_host": candidate.source_host,
        }

    @staticmethod
    def _merge_alternate_source(record: dict, source: dict) -> None:
        existing = list(record.get("alternate_sources", []))
        if source not in existing:
            existing.append(source)
            update_document_record(record["id"], {"alternate_sources": existing})

    @staticmethod
    def _public_document_metadata(record: dict) -> dict:
        keys = (
            "id", "company", "ticker", "filename", "document_type", "reporting_period", "pages",
            "sha256", "source_provider", "source_page_url", "document_url", "source_host",
            "discovery_candidate_id", "publication_date", "statement_basis", "audited_status",
            "revision_id", "revision_label", "indexing_status", "extraction_summary",
        )
        return {key: record[key] for key in keys if key in record}

    def recover_after_restart(self) -> dict:
        interrupted = self.repository.recover_interrupted()
        failed_documents = 0
        manifest_by_import = {
            str(record.get("import_id")): record
            for record in _manifest()
            if record.get("import_id")
        }
        for job in interrupted:
            document_id = job.get("document_id")
            if not document_id:
                recovered_record = manifest_by_import.get(str(job.get("import_id")))
                if recovered_record:
                    document_id = str(recovered_record.get("id"))
                    self.repository.attach_recovered_document(str(job["import_id"]), document_id)
            if not document_id:
                continue
            record = get_document_record(document_id)
            if record and record.get("indexing_status") == "processing":
                set_document_index_status(document_id, "failed", "Import was interrupted by a server restart; retry to finish indexing.")
                failed_documents += 1
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        removed_temporary = 0
        for path in UPLOADS_DIR.glob(".finn-import-*.part"):
            if path.parent.resolve() == UPLOADS_DIR.resolve():
                path.unlink(missing_ok=True)
                removed_temporary += 1
        return {"interrupted_imports": len(interrupted), "failed_documents": failed_documents, "removed_temporary_files": removed_temporary}


import_service = ImportService()
