import json
import hashlib
import math
import os
import re
import unicodedata
from pathlib import Path
import tempfile
from threading import Lock
from uuid import uuid4
from collections import Counter
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[4]
REPORTS_DIR = ROOT / "data" / "reports"
UPLOADS_DIR = REPORTS_DIR / "uploads"
MANIFEST_PATH = REPORTS_DIR / "documents.json"
_manifest_lock = Lock()
_page_cache_lock = Lock()
_page_text_cache: dict[str, tuple[int, int, list[tuple[int, str, str]]]] = {}
MAX_CACHED_DOCUMENTS = 32
MAX_CHUNK_CHARS = 1200
MAX_UPLOAD_BYTES = 45 * 1024 * 1024
WORD_RE = re.compile(r"[a-z0-9][a-z0-9.'%-]*", re.I)
NUMBER_RE = re.compile(r"(?<![a-z])\(?-?\d[\d,]*(?:\.\d+)?%?\)?", re.I)
STOPWORDS = {"about", "after", "again", "against", "also", "and", "are", "been", "before", "being", "between", "both", "but", "can", "company", "could", "does", "from", "have", "into", "its", "more", "most", "other", "our", "over", "same", "should", "that", "the", "their", "there", "these", "this", "those", "through", "under", "was", "were", "what", "when", "where", "which", "while", "with", "would"}


def _extract_page_content(page) -> tuple[str, str]:
    try:
        raw_text = page.extract_text(extraction_mode="layout") or page.extract_text() or ""
    except TypeError:
        raw_text = page.extract_text() or ""
    narrative_lines = []
    table_lines = []
    for raw_line in raw_text.splitlines():
        # Keep layout gaps until column boundaries have been detected. Collapsing
        # whitespace first (the old order) destroyed the PDF's table structure.
        layout_line = unicodedata.normalize("NFKC", raw_line).replace("\ufffd", " ").replace("\u00ad", "").rstrip()
        if not layout_line.strip():
            continue
        line = re.sub(r"[\t ]+", " ", layout_line).strip()
        low = line.lower()
        if re.search(r"\bpage\s+\d+\s+of\s+\d+\b", low) or re.search(r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b", low):
            continue
        if any(term in low for term in ("registered office", "corporate communications", "telefax", "investor.relations@", "cin:")):
            continue
        number_count = len(NUMBER_RE.findall(line))
        cells = [re.sub(r"\s+", " ", cell).strip() for cell in re.split(r"(?:\t+|\s{2,})", layout_line.strip())]
        cells = [cell for cell in cells if cell]
        table_terms = ("quarter", "revenue", "profit", "income", "expense", "assets", "liabilities", "ebitda", "tax", "particulars", "year ended")
        is_table_row = len(cells) >= 3 and number_count >= 2
        is_table_header = len(cells) >= 3 and any(term in low for term in table_terms)
        if is_table_row or is_table_header:
            table_lines.append(" | ".join(cells))
        else:
            narrative_lines.append(line)
    narrative = re.sub(r"\n{3,}", "\n\n", "\n".join(narrative_lines)).strip()
    tables = "\n".join(table_lines).strip()
    return narrative, tables


def _split_narrative(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split page prose into overlapping, readable chunks without losing line context."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]
    chunks: list[str] = []
    current = ""
    for line in lines:
        while len(line) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            split_at = line.rfind(" ", 0, max_chars)
            split_at = split_at if split_at >= max_chars // 2 else max_chars
            chunks.append(line[:split_at].strip())
            line = line[split_at:].strip()
        candidate = f"{current}\n{line}".strip() if current else line
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            chunks.append(current)
            overlap = current[-180:]
            overlap = overlap[overlap.find(" ") + 1:] if " " in overlap else overlap
            current = f"{overlap}\n{line}".strip()
        else:
            current = line
    if current:
        chunks.append(current)
    return chunks


def _page_chunks(page_number: int, narrative: str, tables: str) -> list[dict]:
    chunks = [{"page": page_number, "kind": "narrative", "text": text} for text in _split_narrative(narrative)]
    rows = [line.strip() for line in tables.splitlines() if line.strip()]
    if rows:
        header = rows[0] if len(rows) > 1 and not NUMBER_RE.search(rows[0]) else ""
        data_rows = rows[1:] if header else rows
        group: list[str] = []
        for row in data_rows:
            candidate = "\n".join(([header] if header else []) + group + [row])
            if group and len(candidate) > MAX_CHUNK_CHARS:
                chunks.append({"page": page_number, "kind": "table", "text": "\n".join(([header] if header else []) + group)})
                group = []
            group.append(row)
        if group:
            chunks.append({"page": page_number, "kind": "table", "text": "\n".join(([header] if header else []) + group)})
    return chunks


def _load_document_pages(record: dict) -> list[tuple[int, str, str]]:
    stored_name = record.get("stored_name") or f"{record.get('id', '')}.pdf"
    try:
        path = _safe_upload_path(UPLOADS_DIR / stored_name)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Stored PDF is missing. Upload it again.")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored PDF is missing. Upload it again.")
    try:
        stat = path.stat()
        with _page_cache_lock:
            cached = _page_text_cache.get(str(path))
        if cached and cached[0] == stat.st_mtime_ns and cached[1] == stat.st_size:
            return cached[2]
        reader = PdfReader(str(path))
        pages = [(index + 1, *_extract_page_content(page)) for index, page in enumerate(reader.pages)]
        with _page_cache_lock:
            _page_text_cache[str(path)] = (stat.st_mtime_ns, stat.st_size, pages)
            while len(_page_text_cache) > MAX_CACHED_DOCUMENTS:
                _page_text_cache.pop(next(iter(_page_text_cache)))
        return pages
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not extract text from this PDF.") from exc


def _normalize_term(term: str) -> str:
    value = term.lower()
    if len(value) > 4 and value.endswith("ies"):
        return value[:-3] + "y"
    if len(value) > 4 and value.endswith("s") and not value.endswith("ss"):
        return value[:-1]
    return value


def _company_key(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]", "", value.lower())
    for suffix in ("limited", "ltd", "corporation", "corp", "incorporated", "inc"):
        if normalized.endswith(suffix):
            normalized = normalized[:-len(suffix)]
            break
    return normalized


def _base_ticker(value: str) -> str:
    return value.strip().upper().removesuffix(".NS").removesuffix(".BO")


def _retrieve_records(records: list[dict], question: str, limit: int, per_document_limit: int | None = None) -> list[dict]:
    query_terms = [_normalize_term(word) for word in WORD_RE.findall(question) if word.lower() not in STOPWORDS and len(word) > 1]
    query_terms = list(dict.fromkeys(query_terms))
    if not query_terms or limit <= 0:
        return []

    chunks: list[dict] = []
    for record in records:
        for page_number, narrative, tables in _load_document_pages(record):
            for chunk in _page_chunks(page_number, narrative, tables):
                if chunk["text"].strip():
                    chunks.append({**chunk, "record": record})
    if not chunks:
        return []

    token_sets = []
    token_counts = []
    for chunk in chunks:
        tokens = [_normalize_term(word) for word in WORD_RE.findall(chunk["text"])]
        token_counts.append(Counter(tokens))
        token_sets.append(set(tokens))
    document_frequency = {term: sum(term in terms for terms in token_sets) for term in set(query_terms)}
    average_length = max(sum(sum(counts.values()) for counts in token_counts) / len(token_counts), 1)
    total_chunks = len(chunks)
    ranked: list[tuple[float, float, dict]] = []
    for chunk, counts in zip(chunks, token_counts):
        length = sum(counts.values())
        record = chunk["record"]
        metadata_terms = {
            _normalize_term(word)
            for word in WORD_RE.findall(" ".join(str(record.get(field, "")) for field in ("company", "ticker", "document_type", "reporting_period")))
        }
        content_hits = sum(term in counts for term in query_terms)
        metadata_hits = sum(term in metadata_terms for term in query_terms)
        coverage = min(1.0, (content_hits + metadata_hits) / len(query_terms))
        if coverage < 0.20:
            continue
        score = 0.0
        for term in query_terms:
            frequency = counts[term]
            if not frequency:
                continue
            df = document_frequency[term]
            inverse_frequency = math.log(1 + (total_chunks - df + 0.5) / (df + 0.5))
            denominator = frequency + 1.5 * (1 - 0.75 + 0.75 * length / average_length)
            score += inverse_frequency * frequency * 2.5 / denominator
        score += 1.25 * metadata_hits
        if len(query_terms) > 1 and all(term in counts for term in query_terms):
            score += 0.35
        if score:
            ranked.append((score, coverage, chunk))
    if not ranked:
        return []

    # Aggregate the strongest chunks per source page. The citation remains the
    # original PDF page, while unrelated prose elsewhere on that page is omitted.
    by_page: dict[tuple[str, int], list[tuple[float, float, dict]]] = {}
    for item in ranked:
        record = item[2]["record"]
        by_page.setdefault((record["id"], item[2]["page"]), []).append(item)
    page_candidates = []
    for (document_id, page_number), page_items in by_page.items():
        page_items.sort(key=lambda item: (item[0], item[1]), reverse=True)
        selected_chunks = []
        seen_text: set[str] = set()
        for _, _, chunk in page_items:
            normalized_text = re.sub(r"\W+", " ", chunk["text"].lower()).strip()
            if normalized_text in seen_text:
                continue
            seen_text.add(normalized_text)
            selected_chunks.append(chunk)
            if len(selected_chunks) == 2:
                break
        strongest_score = page_items[0][0]
        combined_score = strongest_score + (page_items[1][0] * 0.2 if len(page_items) > 1 else 0)
        page_candidates.append((combined_score, page_items[0][1], selected_chunks, page_items[0][2]["record"], page_number))
    page_candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    if not page_candidates:
        return []
    minimum_score = max(0.2, page_candidates[0][0] * 0.12)

    sources = []
    per_document: Counter[str] = Counter()
    for score, coverage, selected_chunks, record, page_number in page_candidates:
        if score < minimum_score:
            continue
        if per_document_limit is not None and per_document[record["id"]] >= per_document_limit:
            continue
        excerpt_parts = []
        for chunk in selected_chunks:
            heading = "EXTRACTED TABLE ROWS (PDF columns preserved):" if chunk["kind"] == "table" else "PAGE TEXT:"
            excerpt_parts.append(f"{heading}\n{chunk['text']}")
        source = {
            "id": f"S{len(sources) + 1}", "document_id": record["id"],
            "company": record.get("company"), "ticker": record.get("ticker"),
            "filename": record.get("filename", "Source PDF"),
            "document_type": record.get("document_type", "Primary source"),
            "reporting_period": record.get("reporting_period", ""),
            "source_url": record.get("source_url"), "indexed_at": record.get("indexed_at"),
            "page": page_number, "relevance": round(score * coverage, 3),
            "excerpt": "\n\n".join(excerpt_parts)[:2400],
            "has_table_rows": any(chunk["kind"] == "table" for chunk in selected_chunks),
        }
        sources.append(source)
        per_document[record["id"]] += 1
        if len(sources) >= limit:
            break
    return sources


def _manifest() -> list[dict]:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    if not MANIFEST_PATH.exists():
        return []
    try:
        payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        # Do not treat a damaged index as empty: a later upload could overwrite it.
        raise HTTPException(status_code=500, detail="The document index could not be read. Existing files were preserved.") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=500, detail="The document index has an invalid format. Existing files were preserved.")
    return payload


def list_documents() -> list[dict]:
    result = []
    for doc in _manifest():
        item = {key: doc[key] for key in ("id", "company", "ticker", "filename", "document_type", "reporting_period", "pages", "source_url", "superseded_by", "replaces", "version_number", "indexed_at", "indexing_status", "index_error") if key in doc}
        item.setdefault("version_number", 1)
        item.setdefault("indexing_status", "indexed")
        result.append(item)
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_upload_path(path: Path) -> Path:
    resolved = path.resolve()
    root = UPLOADS_DIR.resolve()
    if resolved.parent != root:
        raise HTTPException(status_code=400, detail="PDF path is outside the Research document store.")
    return resolved


def validate_pdf_file(path: Path, *, max_bytes: int = MAX_UPLOAD_BYTES, max_pages: int = 1500) -> dict:
    """Shared manual/import PDF validation. The caller keeps ownership of the file."""
    safe_path = _safe_upload_path(path)
    try:
        size = safe_path.stat().st_size
        if size <= 0:
            raise HTTPException(status_code=400, detail="The PDF is empty.")
        if size > max_bytes:
            raise HTTPException(status_code=413, detail="PDF exceeds the configured size limit.")
        with safe_path.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                raise HTTPException(status_code=400, detail="The file is not a valid PDF.")
            stream.seek(max(0, size - 2048))
            if b"%%EOF" not in stream.read():
                raise HTTPException(status_code=400, detail="The PDF appears truncated or incomplete.")
        reader = PdfReader(str(safe_path), strict=False)
        if reader.is_encrypted:
            raise HTTPException(status_code=400, detail="Encrypted PDFs are not supported.")
        page_count = len(reader.pages)
        if page_count < 1 or page_count > max_pages:
            raise HTTPException(status_code=400, detail=f"PDF must contain between 1 and {max_pages:,} pages.")
        first_pages_with_text = sum(
            1 for page in reader.pages[: min(page_count, 20)]
            if any(_extract_page_content(page))
        )
        if first_pages_with_text == 0:
            raise HTTPException(status_code=400, detail="No selectable text was found in the first 20 pages. OCR this PDF before importing it.")
        return {"size_bytes": size, "pages": page_count}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The PDF is malformed or could not be opened.") from exc


def _write_manifest(docs: list[dict]) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    temporary = REPORTS_DIR / f".documents-{uuid4().hex}.tmp"
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(docs, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, MANIFEST_PATH)
    finally:
        temporary.unlink(missing_ok=True)


def _document_response(record: dict) -> dict:
    return {key: record[key] for key in ("id", "company", "ticker", "filename", "document_type", "reporting_period", "pages", "source_url", "indexing_status") if key in record}


def add_pdf_file(
    company: str,
    ticker: str,
    document_type: str,
    reporting_period: str,
    source_file: Path,
    filename: str,
    *,
    source_url: str | None = None,
    extra_metadata: dict | None = None,
    initial_indexing_status: str = "processing",
    allow_duplicate_checksum: bool = False,
    expected_sha256: str | None = None,
    index_immediately: bool = True,
) -> dict:
    """Register a validated PDF file using the existing manifest and UUID storage."""
    filename = Path(filename or "source.pdf").name[:160]
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a PDF primary source.")
    safe_source = _safe_upload_path(source_file)
    validation = validate_pdf_file(safe_source)
    digest = sha256_file(safe_source)
    if expected_sha256 and digest.lower() != expected_sha256.lower():
        raise HTTPException(status_code=422, detail="The downloaded file checksum changed before storage.")

    doc_id = str(uuid4())
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    destination = UPLOADS_DIR / f"{doc_id}.pdf"
    record = {
        "id": doc_id, "company": company[:120], "ticker": ticker[:32].upper(),
        "filename": filename, "document_type": document_type[:60],
        "reporting_period": reporting_period[:80], "pages": validation["pages"],
        "stored_name": destination.name, "indexing_status": initial_indexing_status,
        "index_error": None, "indexed_at": None, "version_number": 1,
        "sha256": digest,
    }
    if source_url:
        record["source_url"] = source_url
    if extra_metadata:
        if set(extra_metadata) & set(record):
            raise ValueError("Import metadata cannot replace reserved document fields.")
        record.update(extra_metadata)

    with _manifest_lock:
        docs = _manifest()
        for existing in docs:
            if existing.get("sha256"):
                continue
            try:
                old_path = _safe_upload_path(UPLOADS_DIR / existing.get("stored_name", ""))
                if old_path.is_file():
                    existing["sha256"] = sha256_file(old_path)
            except (OSError, HTTPException):
                continue
        duplicate = next((item for item in docs if item.get("sha256") == digest), None)
        if duplicate and not allow_duplicate_checksum:
            raise HTTPException(status_code=409, detail=f"This PDF is already indexed as {duplicate.get('company')} · {duplicate.get('filename')}.")
        docs.append(record)
        # Persist the processing record before moving the staged bytes into
        # their final UUID path. A crash between these operations leaves a
        # recoverable manifest row, never an untracked final PDF.
        _write_manifest(docs)
        try:
            os.replace(safe_source, destination)
        except Exception:
            _write_manifest([item for item in docs if item.get("id") != doc_id])
            destination.unlink(missing_ok=True)
            raise

    if index_immediately:
        try:
            summary = extract_document_pages(doc_id)
            _set_index_status(doc_id, "indexed", None, extraction_summary=summary)
            record.update({"indexing_status": "indexed", "indexed_at": datetime.now(timezone.utc).isoformat(), "extraction_summary": summary})
        except Exception as exc:
            _set_index_status(doc_id, "failed", "PDF extraction/indexing did not complete.")
            if isinstance(exc, HTTPException):
                raise
            raise HTTPException(status_code=422, detail="The PDF could not be extracted and indexed.") from exc
    return _document_response(record)


async def add_pdf(
    company: str,
    ticker: str,
    document_type: str,
    reporting_period: str,
    upload: UploadFile,
) -> dict:
    filename = Path(upload.filename or "source.pdf").name[:160]
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a PDF primary source.")
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 45 MB upload limit.")
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    temporary = UPLOADS_DIR / f".manual-upload-{uuid4().hex}.part"
    try:
        with temporary.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        return add_pdf_file(company, ticker, document_type, reporting_period, temporary, filename)
    finally:
        temporary.unlink(missing_ok=True)


def remove_document(doc_id: str) -> dict:
    with _manifest_lock:
        docs = _manifest()
        record = next((doc for doc in docs if doc.get("id") == doc_id), None)
        if not record:
            raise HTTPException(status_code=404, detail="Source document not found.")
        remaining = [doc for doc in docs if doc.get("id") != doc_id]
        _write_manifest(remaining)
        path = _safe_upload_path(UPLOADS_DIR / record.get("stored_name", ""))
        if path.is_file():
            path.unlink()
        with _page_cache_lock:
            _page_text_cache.pop(str(path), None)
    return record


def reindex_document(doc_id: str) -> dict:
    record = next((doc for doc in _manifest() if doc.get("id") == doc_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Source document not found.")
    with _manifest_lock:
        docs = _manifest()
        for item in docs:
            if item.get("id") == doc_id:
                item.update({"indexing_status": "processing", "index_error": None})
        _write_manifest(docs)
    try:
        path = _safe_upload_path(UPLOADS_DIR / record.get("stored_name", ""))
    except HTTPException:
        path = UPLOADS_DIR / "__invalid__"
    if not path.is_file():
        _set_index_status(doc_id, "failed", "Stored PDF is missing.")
        raise HTTPException(status_code=404, detail="Stored PDF is missing. Replace or upload it again.")
    try:
        summary = extract_document_pages(doc_id)
    except HTTPException:
        _set_index_status(doc_id, "failed", "PDF extraction/indexing did not complete.")
        raise
    except Exception as exc:
        _set_index_status(doc_id, "failed", "Could not re-index this PDF.")
        raise HTTPException(status_code=422, detail="Could not re-index this PDF.") from exc
    _set_index_status(doc_id, "indexed", None, extraction_summary=summary)
    return {key: record[key] for key in ("id", "company", "ticker", "filename", "document_type", "reporting_period", "pages", "source_url") if key in record} | {"indexing_status": "indexed"}


def _safe_document_path(record: dict) -> Path:
    return _safe_upload_path(UPLOADS_DIR / (record.get("stored_name") or f"{record.get('id', '')}.pdf"))


def extract_document_pages(doc_id: str) -> dict:
    """Run the existing page extractor/chunker and populate its bounded cache."""
    record = next((doc for doc in _manifest() if doc.get("id") == doc_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Source document not found.")
    path = _safe_document_path(record)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored PDF is missing.")
    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            raise HTTPException(status_code=422, detail="Encrypted PDFs are not supported.")
        pages = [(index + 1, *_extract_page_content(page)) for index, page in enumerate(reader.pages)]
        readable_pages = sum(bool(text or tables) for _, text, tables in pages)
        if not readable_pages:
            raise HTTPException(status_code=422, detail="No selectable text was found. OCR this PDF before indexing.")
        chunks = sum(len(_page_chunks(number, text, tables)) for number, text, tables in pages)
        stat = path.stat()
        with _page_cache_lock:
            _page_text_cache[str(path)] = (stat.st_mtime_ns, stat.st_size, pages)
            while len(_page_text_cache) > MAX_CACHED_DOCUMENTS:
                _page_text_cache.pop(next(iter(_page_text_cache)))
        limitations = []
        if readable_pages < len(pages):
            limitations.append(f"{len(pages) - readable_pages} of {len(pages)} pages have no selectable text; scanned/image-only pages may need OCR.")
        return {"page_count": len(pages), "text_pages": readable_pages, "chunk_count": chunks, "limitations": limitations}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not extract the PDF; it may be malformed or truncated.") from exc


def set_document_index_status(doc_id: str, status: str, error: str | None = None, *, extraction_summary: dict | None = None) -> None:
    _set_index_status(doc_id, status, error, extraction_summary=extraction_summary)


def get_document_record(doc_id: str) -> dict | None:
    record = next((doc for doc in _manifest() if doc.get("id") == doc_id), None)
    return dict(record) if record else None


def document_file_sha256(doc_id: str) -> str | None:
    record = get_document_record(doc_id)
    if not record:
        return None
    try:
        path = _safe_document_path(record)
    except HTTPException:
        return None
    return sha256_file(path) if path.is_file() else None


def update_document_record(doc_id: str, updates: dict) -> dict:
    with _manifest_lock:
        docs = _manifest()
        record = next((doc for doc in docs if doc.get("id") == doc_id), None)
        if not record:
            raise HTTPException(status_code=404, detail="Source document not found.")
        record.update(updates)
        _write_manifest(docs)
        return dict(record)


def link_document_revision(previous_id: str, new_id: str) -> None:
    """Link a completed revision only after its new index is READY."""
    with _manifest_lock:
        docs = _manifest()
        previous = next((doc for doc in docs if doc.get("id") == previous_id), None)
        current = next((doc for doc in docs if doc.get("id") == new_id), None)
        if not previous or not current:
            raise HTTPException(status_code=404, detail="A document version was not found.")
        if current.get("indexing_status") != "indexed":
            raise HTTPException(status_code=409, detail="A document cannot supersede a version before indexing completes.")
        versions = [
            int(doc.get("version_number", 1)) for doc in docs
            if doc.get("issuer_id") == current.get("issuer_id")
            and doc.get("document_type") == current.get("document_type")
            and doc.get("reporting_period") == current.get("reporting_period")
            and (doc.get("statement_basis") or None) == (current.get("statement_basis") or None)
        ]
        current["replaces"] = previous_id
        current["version_number"] = max(versions, default=1) + 1
        previous["superseded_by"] = new_id
        _write_manifest(docs)


def _set_index_status(doc_id: str, status: str, error: str | None = None, *, extraction_summary: dict | None = None) -> None:
    with _manifest_lock:
        docs = _manifest()
        for item in docs:
            if item.get("id") == doc_id:
                item["indexing_status"] = status
                item["indexed_at"] = datetime.now(timezone.utc).isoformat() if status == "indexed" else item.get("indexed_at")
                item["index_error"] = error
                if extraction_summary is not None:
                    item["extraction_summary"] = extraction_summary
                break
        _write_manifest(docs)


def validate_page_excerpt(document_id: str, page_number: int, excerpt: str) -> float:
    record = next((doc for doc in _manifest() if doc.get("id") == document_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Source document not found.")
    path = UPLOADS_DIR / record.get("stored_name", "")
    try:
        reader = PdfReader(str(path))
        if page_number < 1 or page_number > len(reader.pages):
            raise HTTPException(status_code=422, detail="Source page is outside the PDF page range.")
        page_text = " ".join(_extract_page_content(reader.pages[page_number - 1]))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not verify the selected page against the uploaded PDF.") from exc
    source_terms = {term.lower().rstrip("s") for term in WORD_RE.findall(page_text) if len(term) > 2}
    excerpt_terms = {term.lower().rstrip("s") for term in WORD_RE.findall(excerpt) if len(term) > 2}
    if not excerpt_terms:
        raise HTTPException(status_code=422, detail="Enter a supporting passage that can be matched to the selected source page.")
    matched = len(source_terms & excerpt_terms) / len(excerpt_terms)
    if len(source_terms & excerpt_terms) < min(3, len(excerpt_terms)) or matched < 0.25:
        raise HTTPException(status_code=422, detail="The supporting passage does not match the selected PDF page. Check the page number and excerpt before saving.")
    return round(matched, 3)


def retrieve_pages(doc_id: str, question: str, limit: int = 5) -> tuple[dict, list[dict]]:
    record = next((doc for doc in _manifest() if doc.get("id") == doc_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Source document not found. Upload it again.")
    if record.get("indexing_status", "indexed") != "indexed":
        raise HTTPException(status_code=409, detail="This source is not indexed yet. Wait for indexing to finish, then retry.")
    return record, _retrieve_records([record], question, limit)


def retrieve_ticker_pages(ticker: str, question: str, limit: int = 8) -> tuple[dict, list[dict]]:
    """Retrieve a bounded, document-diverse evidence set across one company's indexed PDFs."""
    normalized = _base_ticker(ticker)
    records = [
        item for item in _manifest()
        if _base_ticker(item.get("ticker", "")) == normalized
        and item.get("indexing_status", "indexed") == "indexed"
        and not item.get("superseded_by")
    ]
    if not records:
        raise HTTPException(status_code=404, detail="No indexed source documents were found for this company.")
    company_keys = {_company_key(item.get("company", "")) for item in records if item.get("company")}
    if len(company_keys) > 1:
        raise HTTPException(status_code=409, detail="This ticker maps to multiple company names in the source library. Review the document metadata before searching across sources.")
    company_key = next(iter(company_keys), "")
    records = [item for item in records if not company_key or _company_key(item.get("company", "")) == company_key]
    sources = _retrieve_records(records, question, limit, per_document_limit=3)
    representative = records[0]
    return {"company": representative.get("company", normalized), "ticker": normalized, "filename": f"{len(records)} indexed source documents", "document_count": len(records)}, sources
