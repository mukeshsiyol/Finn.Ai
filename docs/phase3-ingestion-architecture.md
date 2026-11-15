# FINN Phase 3 — Document Ingestion Architecture

## Overview

Phase 3 connects explicit Phase 2 candidate selection to the existing Phase 1 Research library. The backend rediscovers the issuer's current candidates, resolves the selected candidate ID from that trusted result, validates its provenance, downloads one PDF, validates it, and hands the staged file to the existing manifest and page-aware indexing pipeline. Discovery remains read-only; nothing is downloaded until a user calls the import endpoint.

## Reused components

- `discovery.schema.DiscoveryCandidate`, issuer registry resolution and Phase 2 providers remain the source of candidate identity and provenance.
- `discovery.source_policy` enforces verified issuer/provider/host relationships before download and at every redirect.
- `research.documents` remains the sole document store and extraction/indexing implementation. Imported PDFs become ordinary manifest documents and use the existing page-aware extraction, chunking, BM25 retrieval and citation path.
- Existing manual `POST /api/research/documents` is retained and now shares file validation, SHA-256, safe storage paths, extraction and indexing with the import flow.
- Research response formats, document-library response fields and frontend contracts are unchanged.

## Components

- `research.import_api`: additive request, list, status and retry routes.
- `research.import_service`: candidate re-resolution, lifecycle orchestration, metadata preservation and failure handling.
- `research.import_repository`: atomic JSON state/attempt ledger using the application's existing file-store pattern.
- `research.downloader`: bounded streaming HTTPS downloader with per-hop hostname checks, public DNS validation and IP-pinned TLS connections.
- `research.document_identity`: conservative checksum, source identity and revision matching.
- `discovery.source_policy`: approved-source decision for verified NSE, BSE and issuer IR domains. RIL's verified static-asset CDN is an explicit additional document host.
- `research.documents`: common manual/import PDF validation, storage, SHA, extraction, indexing and citation retrieval.

## Import lifecycle

`pending → downloading → validating → extracting → indexing → ready`; any active stage can become `failed`. The JSON job ledger records status, stage, coarse progress, timestamps, attempt history, failure category/reason, document metadata and the server-resolved candidate snapshot. Failed transient imports can be retried. Each stage transition is persisted; `ready` follows successful extraction/indexing and manifest persistence only.

FastAPI `BackgroundTasks` runs the bounded job after the response. On startup, abandoned active jobs become retryable `failed` jobs, processing documents are marked failed, and stale `.finn-import-*.part` files are removed. The manifest is persisted before a staged PDF is moved into its UUID filename, so startup can repair the narrow crash window by matching the import ID in manifest metadata. If a prior row references missing bytes, retry downloads again rather than declaring it ready.

## API contracts

### Start selected candidate

`POST /api/research/discovery/import`

```json
{
  "company": "Reliance Industries",
  "candidate_id": "dc_<32 lowercase hex characters>",
  "check_for_revision": false
}
```

The request rejects extra fields (including a client-supplied URL). Server-side discovery is repeated and the ID must still belong to the resolved issuer. Returns HTTP 202 and a job view with `import_id`, status, issuer/document summary, progress, timestamps, retry state and whether an existing job was reused.

### Status and list

- `GET /api/research/imports/{import_id}`
- `GET /api/research/imports?issuer_id=RELIANCE.NS&state=ready&limit=50&offset=0`

List accepts `pending`, `downloading`, `validating`, `extracting`, `indexing`, `ready`, or `failed` state filters.

### Retry

`POST /api/research/imports/{import_id}/retry` returns HTTP 202 and schedules only a failed job marked retryable. Permanent failures return HTTP 409.

## Source and network security

- The imported candidate must be verified and resolve to a known issuer. NSE requires a verified NSE symbol; BSE requires a verified BSE scrip code; IR requires a verified IR domain.
- Listing and direct-document hosts are separately checked against provider/issuer allowlists. Only direct `.pdf` URLs are accepted. Listing pages are never crawled by the importer.
- URLs must use HTTPS on port 443 and contain no credentials. Redirects are limited and each destination is revalidated against approved document hosts.
- DNS is checked for globally routable addresses. Every request connects to the validated IP directly while TLS verifies the original hostname, mitigating DNS rebinding and validation/connection races.
- TLS verification is enabled. Requests use bounded connect/read timeouts, one bounded retry for transient failures, an explicit maximum size, streaming SHA-256, and PDF/octet-stream content types. 403/404 are permanent; 429 is retryable only by a later user retry; 5xx/network errors have bounded retry behavior.
- The existing PDF validator checks size, `%PDF-`, EOF marker, pypdf parsing, encryption, page count and selectable text. Image-only documents fail with an OCR limitation rather than being reported indexed. Partially scanned documents are indexed with a page-count limitation recorded.
- Logs include opaque import/document identifiers and failure category, not document bodies, credentials or URLs.

## Persistence and revisions

Jobs use `data/reports/imports.json`; documents and original bytes use the existing `data/reports/documents.json` manifest and UUID PDF upload directory. There is no new database, queue, Redis or storage service. Writes use temporary files, fsync and atomic replacement. A process-local lock protects concurrent requests in one application process; multi-process shared JSON writes are not supported.

Each imported record preserves issuer/ticker, candidate ID, provider, source listing URL, original document URL, final URL, source host, type/subtype, period, publication date, statement basis, audited status, source filing ID, revision fields, SHA-256, import ID/time, alternate provenance and extraction summary. Existing manifest rows and PDFs are not migrated or removed.

Identity matching scopes by issuer, document type, normalized reporting period and statement basis, then considers provider/source ID/canonical URL and checksum. Same bytes in the same scope reuse the indexed document and add alternate provenance. A changed document at the same source identity is retained as a new revision and linked only after its index succeeds. Explicitly different filing IDs or revision IDs are retained separately even when their bytes match. Identical bytes across different scopes remain separate and are flagged as possible duplicates. Ambiguous identity is not aggressively merged.

## Limitations

- BSE Phase 2 discovery currently reports that a permitted anonymous structured source has not been confirmed. The import policy supports verified BSE candidates if that provider supplies them, but this phase does not bypass BSE access restrictions.
- NSE/IR provider coverage remains limited to the sources Phase 2 can currently discover. Some results expose listing pages without direct PDFs; these cannot be imported and are reported as a clear error.
- The initial importer supports PDF only. It does not OCR scanned files, extract office/spreadsheet formats, discover new URLs, or import without user selection.
- BackgroundTasks is appropriate for this single-process prototype but is not a durable distributed queue. JSON state and local PDF storage inherit the existing deployment's persistence limits; production multi-instance deployments require a durable shared database/filesystem or object store and a job runner.
- Import endpoints follow the existing application's authentication model; no new authentication layer was introduced.
