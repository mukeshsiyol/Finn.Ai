# FINN.AI Phase 3 — Implementation Plan

## Current architecture

- **Application/API:** One FastAPI application in `backend/app/main.py` serves the existing portfolio, alerts, announcements and Research endpoints. There is no authentication layer or background-job framework.
- **Discovery:** Phase 2 providers return normalized `DiscoveryCandidate` records. The discovery API can query the registry and live providers, but it does not retain a candidate catalog. The server must rediscover and match a candidate ID when an import is requested; it must never accept a client URL as authority.
- **Document records and bytes:** `research.documents` stores metadata in `data/reports/documents.json` and UUID-named PDFs under `data/reports/uploads/`. It calculates SHA-256 and rejects same-content manual uploads. Existing document IDs are referenced by financial evidence and citations.
- **Extraction and retrieval:** `research.documents` extracts page text with pypdf, uses the existing table-aware chunk builder and BM25 retrieval, and records original PDF page numbers. `reindex_document` extracts all pages into an in-process bounded cache; page chunks are assembled by the existing retrieval path. The extracted index is not a separate persistent database.
- **Research/citations:** `research.engine` grounds answers in retrieved excerpts and validates source IDs, document metadata and page bounds against the existing manifest/PDF. Financial comparisons and commitments refer to existing document IDs.
- **Manual upload:** `POST /api/research/documents` validates a PDF and calls `add_pdf`; existing upload, replacement, reindex, delete, file and document-library contracts must remain usable.
- **Persistence/deployment:** Research records are JSON and local files. `DATABASE_URL` is present as an example setting but no SQL database/ORM is used by these paths. Render free storage is ephemeral. This phase will follow the existing local-file model and will document that job records/PDFs share its durability limits.
- **Frontend contract:** `frontend/src/services/aiApi.ts` expects the current document list fields and existing routes. Phase 3 will not modify frontend files or those response formats.

## Reusable components

1. Issuer registry and exact resolver for canonical issuer/ticker identity.
2. Phase 2 discovery service and normalized candidate identity/provenance.
3. `documents.add_pdf`, manifest/storage conventions, pypdf validation, `_extract_page_content`, `_page_chunks`, `reindex_document`, retrieval and citation validation.
4. Existing Research document routes and manual upload API.
5. Existing SHA-256 fields and `replaces` / `superseded_by` / `version_number` document-version conventions.

No parallel Research engine, document library, extraction pipeline, database, Redis or Celery dependency is planned.

## Required changes

- Add a local JSON import-job repository with atomic writes, lifecycle/attempt history, pagination/filtering and interrupted-job recovery.
- Add a provider/issuer host policy that independently validates server-resolved candidates and the document URL before any download.
- Add a bounded streaming downloader that pins the TLS connection to a validated public DNS result; validates every redirect; streams to a temporary PDF; hashes while writing; and handles source status/size/timeouts safely.
- Add reusable file-level PDF validation and an extraction/index adapter that uses the existing pypdf extraction and chunk/retrieval code. Manual uploads continue using the same validation and indexing boundary.
- Add identity/revision matching based on issuer, provider/source filing ID or canonical URL, document type, period, statement basis, publication date and checksum. Ambiguous matches remain separate and carry a possible-duplicate marker.
- Add additive import-start, import-status, import-list and retry endpoints. The start request contains only a candidate ID and issuer query; the server reruns discovery and finds the candidate. It does not accept a caller-supplied URL.
- Add backend tests using local PDF/HTML fixtures and mocked DNS/socket responses; no live document fetch is part of automated tests.

## Data model and lifecycle

- **Import job:** UUID, candidate ID, issuer ID, current state/progress/stage, created/updated timestamps, document ID when committed, retryability/failure category/reason, and ordered attempt history.
- **Document manifest record:** Existing fields and ID plus imported source provenance (provider, original candidate ID, listing page, direct URL, host, document subtype, period, publication date, statement basis/audited status, revision fields), checksum/import time, and extraction summary. Existing records are not rewritten as a migration.
- **Lifecycle:** `pending → downloading → validating → extracting → indexing → ready`; any stage may end in `failed`. `ready` is written only after validated bytes are safely registered and the existing full-document extraction/cache/index path completes. Failed attempts retain their history and can be retried without deleting earlier documents.
- **Duplicate/revision policy:** Identical checksum plus compatible document identity reuses the existing document and records alternate provenance. Same source identity with changed checksum creates a new document version and links the prior version without overwriting it. Different period or statement basis never merges. Equal bytes with incompatible/uncertain identity remain separate and are flagged.

## Security boundaries

- Import selection is explicit. A candidate is rediscovered on the server and matched by candidate ID and registered issuer.
- Only Phase 2 provider/issuer host mappings are eligible. Exchange imports require a verified issuer exchange ID; IR imports require a verified IR domain; the reviewed Reliance document CDN is separately allowlisted.
- The downloader permits HTTPS on port 443 only, rejects credentials, resolves and validates every address, pins the TLS connection to that public IP while validating the certificate against the original hostname, and revalidates redirect hosts independently.
- Only bounded PDF responses are written. No script execution, generic crawling, HTML ingestion, or discovery-wide automatic download is added.
- Downloads use size/time/page limits, streaming SHA-256, temporary files and cleanup. Failure logs contain IDs/stages/categories, not document contents, credentials or full signed URLs.
- Manual uploads remain a separate trust boundary: they do not need public-source host validation, but share PDF validation, checksum and extraction/indexing.

## API contracts

- `POST /api/research/discovery/import` — JSON `{ "company": "RELIANCE", "candidate_id": "..." }`; response includes import ID, current status/progress and document ID if already known. No URL is accepted.
- `GET /api/research/imports/{import_id}` — state, stage/progress, issuer/document metadata, timestamps, attempts and a safe failure reason.
- `GET /api/research/imports` — paginated import summaries with optional issuer/status filters.
- `POST /api/research/imports/{import_id}/retry` — starts a new attempt only for a failed job marked retryable; active jobs are returned unchanged.
- Existing Research routes and the Phase 2 discovery response remain unchanged. Manual upload request/response fields remain unchanged.

## Migration and operational considerations

- No migration is required for existing manifest rows or PDFs. New imports append records using existing UUID PDF storage and manifest conventions; the import-job ledger is a separate JSON file under `data/reports/`.
- Existing PDFs, financial evidence and commitments keep their IDs and paths. Imported PDFs become ordinary Research documents and can be cited by the existing engine.
- On startup, abandoned active import states are marked failed/retryable and stale import temporary files are removed. The implementation is suitable for the current single-process prototype; JSON plus process locks is not a multi-worker transactional queue. Render ephemeral storage can lose import history and imported files.
- Failed revisions never supersede or delete a READY document. Replacement pointers are written only after the new document has completed indexing.

## Testing strategy

- Baseline and final full backend suite, plus registry, Phase 2 provider/schema/API regression tests.
- Downloader tests for HTTPS/host/port/credentials, DNS pinning, private IPs, redirects, response codes, retries, size bounds, interrupted writes and checksum.
- PDF fixtures for valid, malformed, truncated, encrypted, scanned, empty and over-limit documents.
- Identity/revision and concurrent-active-job tests with isolated temporary manifests/jobs.
- Pipeline-stage and retry/failure recovery tests, manual upload regression, and retrieval/citation from an imported fixture document.
- Python compilation, `git diff --check`, and frontend production build without frontend changes.
- Live validation, if run, is limited to retrieving listing metadata and importing only an explicitly selected official test document. Automated tests never fetch public documents.

## Baseline test note

The Phase 2 report records a prior full-suite result of 72 passed. During the Phase 3 pre-change baseline attempt, pytest stalled while `asyncio.run` in `test_discovery_api.py` initialized a Windows selector loop; faulthandler showed `socket.socketpair → SelectorEventLoop._make_self_pipe` before the request ran. This is a test-harness issue, not a discovery assertion. The test will be adjusted to exercise the route without creating a socket-backed asyncio loop, while existing TestClient regression tests remain intact.
