# Research Reliability: baseline and validation

## Baseline before Phase 1 changes

- The existing backend suite contained 11 tests. All 11 passed when run with the Windows `SelectorEventLoopPolicy`.
- With Windows' default Proactor policy, the first Starlette `TestClient` endpoint case stalled while AnyIO created its event loop through `socket.socketpair`; the request had not reached FINN. The test-only `backend/tests/conftest.py` now selects the Windows Selector policy so a normal `pytest` command can run the suite.
- A live Ask FINN call used the configured OpenRouter provider (`openrouter/auto`) against the indexed Reliance Q2 FY2027 concall. Retrieval found the correct transcript and relevant pages. The provider returned a generated response, but FINN returned `evidence_only` because the generated “FINN interpretation” sentence had no citation. The provider request itself succeeded; the exact failure was the post-generation citation verifier.
- Existing data before implementation: 11 document records, 11 matching PDFs, 44 unified evidence records, 43 legacy financial records, and one legacy commitment record.

## Phase 1 implementation

- PDF layout gaps are retained until table columns are identified. Narrative lines with several numbers are no longer automatically labelled as table rows. Issuer-specific Reliance boilerplate filters were removed from the shared extractor.
- Page text is split into bounded overlapping narrative chunks and grouped table-row chunks while keeping the owning document ID and original one-based PDF page.
- Retrieval uses one chunk-level BM25 ranking across all documents in a company search, then selects distinct source pages with a three-page per-document cap. The previous per-document normalization that made every document's best page score 1.0 was removed.
- Ticker aliases accept both `.NS` and `.BO`; ambiguous mappings from one ticker to multiple company names fail closed. Every returned source carries its own company, ticker, document type, reporting period, filename, and page.
- Ask FINN now uses a dedicated Research engine. It supplies only retrieved excerpts and their metadata to the model, verifies citations against the indexed document and actual PDF page count, and retries once with specific verification failures. If the corrected answer still fails, it is withheld. Provider failure returns an error; production does not synthesize a fake AI response.
- Existing Research routes, response fields, manifest and evidence formats, documents, PDFs, financials, and management commitments were preserved. No UI redesign, new database, external vector store, or public-source discovery was added.

## After implementation

- `pytest -q backend/tests`: **19 passed** (one Starlette `python_multipart` pending-deprecation warning).
- `python -m compileall -q backend/app`: passed.
- `npm run build --prefix frontend`: passed.
- `git diff --check`: passed.
- Live OpenRouter Ask FINN check through `POST /api/research/query` on the same Reliance Q2 FY2027 concall: **HTTP 200, `ai_grounded`, verification `verified`, one generation attempt**. The returned answer cited transcript pages 15, 25, and 26; each cited ID mapped to the indexed transcript and a real PDF page.
- The citation gate checks document metadata, source IDs, page bounds, citation presence, explicit numbers, and text overlap. Text-overlap validation is heuristic; it is not a proof of semantic entailment.
- The JSON/PDF data counts above remained unchanged after validation.
