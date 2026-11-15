# FINN Phase 3 — Validation Report

## Result

Phase 3 backend ingestion is implemented and validated against local fixtures and mocked network responses. A selected, still-current verified candidate can now be imported into FINN's existing document manifest, extracted and indexed by the existing Phase 1 engine, then retrieved with its existing document/page citation.

No live public-source import was made during validation. The downloader was exercised with mocked transport, DNS and redirect cases to avoid making uncontrolled external requests. Phase 2's BSE provider still reports its documented limitation: a permitted anonymous structured feed has not been established. The import security policy supports BSE candidates only when the existing registry has a verified scrip code and the candidate is verified and hosted by BSE.

## Architecture and changed components

- Added `backend/app/services/research/downloader.py`: HTTPS-only, bounded streaming, SHA-256, public-IP DNS checks, pinned-IP connections with hostname-verified TLS, approved redirect enforcement, bounded retries and safe failure categories.
- Added `backend/app/services/discovery/source_policy.py`: verifies candidate status, registered issuer, verified exchange identity or IR domain, allowed provider, listing host and direct PDF host. Supports verified NSE, BSE and IR host policies; Reliance's verified static-asset host is explicit.
- Added `backend/app/services/research/import_repository.py`: atomic JSON lifecycle store and attempt history.
- Added `backend/app/services/research/import_service.py`: server-side candidate re-resolution, deduplication/revision decisions, lifecycle orchestration, persistence into the existing Research library, startup recovery and structured logs.
- Added `backend/app/services/research/document_identity.py`: conservative source/checksum matching that preserves different filing/revision identifiers and separate reporting scopes.
- Added `backend/app/services/research/import_api.py`: additive import/status/list/retry endpoints.
- Updated `backend/app/services/research/documents.py`: shared PDF validation/checksum/path safeguards and reusable file registration/extraction/indexing, while retaining the manual upload route and response contract.
- Updated `backend/app/main.py`: includes the additive router and startup recovery hook.
- Added import security, lifecycle, API and end-to-end retrieval tests. Existing Phase 2 API tests use direct route-contract checks to avoid a known Windows local socket-pair stall; the existing TestClient integration tests remain enabled.

Frontend source files were not changed for Phase 3.

## Lifecycle and API

Lifecycle: `pending → downloading → validating → extracting → indexing → ready`; active failures transition to `failed`. Each attempt, stage, progress value, timestamps, retry eligibility and failure details persist in `data/reports/imports.json`.

- `POST /api/research/discovery/import` — accepts issuer/company, candidate ID and optional `check_for_revision`; rejects extra/client URL fields; resolves the candidate again from server-side discovery and responds HTTP 202.
- `GET /api/research/imports/{import_id}` — retrieve status and document summary.
- `GET /api/research/imports` — list with issuer/state and bounded pagination filters.
- `POST /api/research/imports/{import_id}/retry` — schedule eligible failed jobs only.

Imported documents use the existing `data/reports/documents.json` manifest and UUID PDF directory. The indexer populates the existing page-aware extraction cache and standard Research retrieval/citation path. Manual PDF upload remains on its existing route and uses the shared validator and indexer.

## Security and data-integrity validation

Automated tests cover approved IR/BSE hosts; unverified candidate rejection; unapproved, HTTP, credentialed and nonstandard-port URLs; redirects to unapproved/private hosts; private DNS results; redirect limits; timeouts; 403/404/429/500 handling; bounded retries; oversized/interrupted streams; content-type rejection; pinned IP/TLS hostname use; malformed, empty, truncated, encrypted, scanned and page-limit PDFs; duplicate job requests under concurrency; checksum/source identity and revision behavior; failed validation without READY; retry history; normal Research retrieval with page-1 citation; and additive API/OpenAPI contracts.

Persistence writes use temporary files, fsync and atomic replacement. Imported document records carry candidate/provider/source URLs and host, issuer/ticker, document type/subtype, period, publication date, statement basis/audited status when supplied, source filing and revision identifiers, checksum, import timestamp, alternate provenance, possible duplicate markers and extraction summary. The importer never follows listing-page links or imports without explicit selection.

## Test and build results

Executed in the repository's Python 3.11 virtual environment on Windows:

- Focused ingestion/security/API tests: **22 passed in 3.63s**.
- Full backend suite: **94 passed, 1 warning in 18.56s**; pytest exited successfully. The warning is Starlette's deprecation notice for the installed `httpx` TestClient integration.
- Python compilation: `python -m compileall -q app tests` — passed.
- Frontend production build (no frontend source changes): `npm run build` — passed; Vite built 2,064 modules in 1.72s.
- `git diff --check` — passed. Git printed only existing line-ending conversion notices.

The previously observed Windows TestClient/socketpair stall was reproduced before implementation. It occurs while the sandbox blocks creation of the loopback socket pair in an AnyIO worker, before application code runs. With local network permission granted for validation, TestClient tests and the full suite exited successfully. The unrelated runtime environment also emitted an npm warning that `NODE_TLS_REJECT_UNAUTHORIZED=0`; this is not set by Phase 3 code and the build completed.

## Preservation checks

- Existing Research query/upload/library routes and their response contracts were preserved; import routes are additive.
- The importer writes through the existing manifest and upload directory; no parallel document store or extraction/indexing engine was created.
- Phase 1 extraction, chunking, BM25 retrieval and citation formatting are reused.
- Phase 2 discovery and issuer registry are consumed without changing provider behavior in this phase.
- No portfolio, announcement, alert or frontend implementation was changed for Phase 3.
- No existing documents or PDFs were removed or overwritten. Changed working-tree items outside the Phase 3 additions were already present before Phase 3 work and were left intact.

## Limitations and remaining production work

- This is a single-process implementation using the application's current JSON/local-file persistence and FastAPI `BackgroundTasks`. Multi-worker shared writes, durable distributed jobs and persistence across ephemeral deployment restarts need shared durable infrastructure before multi-instance production deployment.
- Phase 2's permitted BSE discovery source is still unavailable, and only currently verified NSE/IR candidates can be expected to appear from live discovery.
- Only direct PDFs are supported. Scanned PDFs are rejected if no selectable text exists; no OCR or other file formats are included.
- A document without a direct attachment is not automatically followed from its listing page; the user must choose a candidate with a direct PDF URL.
- No live source smoke test was performed in this validation run; providers and the downloader were validated with fixtures/mocks.
