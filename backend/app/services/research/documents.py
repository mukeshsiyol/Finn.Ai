import json
import hashlib
import math
import re
import unicodedata
from io import BytesIO
from pathlib import Path
from threading import Lock
from uuid import uuid4
from collections import Counter

from fastapi import HTTPException, UploadFile
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[4]
REPORTS_DIR = ROOT / "data" / "reports"
UPLOADS_DIR = REPORTS_DIR / "uploads"
MANIFEST_PATH = REPORTS_DIR / "documents.json"
_manifest_lock = Lock()
_page_cache_lock = Lock()
_page_text_cache: dict[str, tuple[int, int, list[tuple[int, str, str]]]] = {}
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
        line = unicodedata.normalize("NFKC", raw_line).replace("\ufffd", " ").replace("\u00ad", "")
        line = re.sub(r"[\t ]+", " ", line).strip()
        if not line:
            continue
        low = line.lower()
        if re.search(r"\bpage\s+\d+\s+of\s+\d+\b", low) or re.search(r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b", low):
            continue
        if any(term in low for term in ("registered office", "maker chambers", "corporate communications", "telefax", "investor.relations@", "www.ril.com", "cin:")):
            continue
        number_count = len(NUMBER_RE.findall(line))
        if number_count >= 3 or (number_count >= 2 and any(term in low for term in ("revenue", "profit", "income", "expense", "assets", "liabilities", "ebitda", "tax"))):
            # Layout extraction preserves column spacing; make columns explicit for both retrieval and display.
            table_lines.append(re.sub(r"\s{2,}", " | ", line))
        else:
            narrative_lines.append(line)
    narrative = re.sub(r"\n{3,}", "\n\n", "\n".join(narrative_lines)).strip()
    tables = "\n".join(table_lines).strip()
    return narrative, tables


def _manifest() -> list[dict]:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    if not MANIFEST_PATH.exists():
        return []
    try:
        payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def list_documents() -> list[dict]:
    return [{key: doc[key] for key in ("id", "company", "ticker", "filename", "document_type", "reporting_period", "pages", "source_url", "superseded_by") if key in doc} for doc in _manifest()]


async def add_pdf(company: str, ticker: str, document_type: str, reporting_period: str, upload: UploadFile) -> dict:
    filename = Path(upload.filename or "source.pdf").name[:160]
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a PDF primary source.")
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 45 MB upload limit.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid PDF.")
    try:
        reader = PdfReader(BytesIO(content))
        if reader.is_encrypted:
            raise HTTPException(status_code=400, detail="Encrypted PDFs are not supported.")
        page_count = len(reader.pages)
        if page_count == 0 or page_count > 1500:
            raise HTTPException(status_code=400, detail="PDF must contain between 1 and 1,500 pages.")
        if not any(any(_extract_page_content(page)) for page in reader.pages[:min(page_count, 20)]):
            raise HTTPException(status_code=400, detail="No selectable text was found in the first 20 pages.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not read this PDF.") from exc

    doc_id = str(uuid4())
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    path = UPLOADS_DIR / f"{doc_id}.pdf"
    record = {"id": doc_id, "company": company[:120], "ticker": ticker[:32].upper(), "filename": filename, "document_type": document_type[:60], "reporting_period": reporting_period[:80], "pages": page_count, "stored_name": path.name}
    with _manifest_lock:
        docs = _manifest()
        digest = hashlib.sha256(content).hexdigest()
        for existing in docs:
            if existing.get("sha256"):
                continue
            old_path = UPLOADS_DIR / existing.get("stored_name", "")
            if old_path.parent == UPLOADS_DIR and old_path.is_file():
                existing["sha256"] = hashlib.sha256(old_path.read_bytes()).hexdigest()
        duplicate = next((item for item in docs if item.get("sha256") == digest), None)
        if duplicate:
            raise HTTPException(status_code=409, detail=f"This PDF is already indexed as {duplicate.get('company')} · {duplicate.get('filename')}.")
        record["sha256"] = digest
        docs.append(record)
        path.write_bytes(content)
        MANIFEST_PATH.write_text(json.dumps(docs, ensure_ascii=False, indent=2), encoding="utf-8")
    return {key: record[key] for key in ("id", "company", "ticker", "filename", "document_type", "reporting_period", "pages", "source_url") if key in record}


def remove_document(doc_id: str) -> dict:
    with _manifest_lock:
        docs = _manifest()
        record = next((doc for doc in docs if doc.get("id") == doc_id), None)
        if not record:
            raise HTTPException(status_code=404, detail="Source document not found.")
        remaining = [doc for doc in docs if doc.get("id") != doc_id]
        MANIFEST_PATH.write_text(json.dumps(remaining, ensure_ascii=False, indent=2), encoding="utf-8")
        path = UPLOADS_DIR / record.get("stored_name", "")
        if path.parent == UPLOADS_DIR and path.is_file():
            path.unlink()
        with _page_cache_lock:
            _page_text_cache.pop(str(path), None)
    return record


def reindex_document(doc_id: str) -> dict:
    record = next((doc for doc in _manifest() if doc.get("id") == doc_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Source document not found.")
    path = UPLOADS_DIR / record.get("stored_name", "")
    if not path.is_file() or path.parent != UPLOADS_DIR:
        raise HTTPException(status_code=404, detail="Stored PDF is missing. Replace or upload it again.")
    with _page_cache_lock:
        _page_text_cache.pop(str(path), None)
    try:
        reader = PdfReader(str(path))
        pages = [(index + 1, *_extract_page_content(page)) for index, page in enumerate(reader.pages)]
        if not any(text or tables for _, text, tables in pages):
            raise HTTPException(status_code=422, detail="No selectable text was found. OCR this PDF before re-indexing.")
        stat = path.stat()
        with _page_cache_lock:
            _page_text_cache[str(path)] = (stat.st_mtime_ns, stat.st_size, pages)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not re-index this PDF.") from exc
    return {key: record[key] for key in ("id", "company", "ticker", "filename", "document_type", "reporting_period", "pages", "source_url") if key in record}


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
    path = UPLOADS_DIR / record.get("stored_name", "")
    if not path.is_file() or path.parent != UPLOADS_DIR:
        raise HTTPException(status_code=404, detail="Stored PDF is missing. Upload it again.")
    try:
        stat = path.stat()
        with _page_cache_lock:
            cached = _page_text_cache.get(str(path))
        if cached and cached[0] == stat.st_mtime_ns and cached[1] == stat.st_size:
            pages = cached[2]
        else:
            reader = PdfReader(str(path))
            pages = [(index + 1, *_extract_page_content(page)) for index, page in enumerate(reader.pages)]
            with _page_cache_lock:
                _page_text_cache[str(path)] = (stat.st_mtime_ns, stat.st_size, pages)
                while len(_page_text_cache) > 8:
                    _page_text_cache.pop(next(iter(_page_text_cache)))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not extract text from this PDF.") from exc

    query_terms = [word.lower() for word in WORD_RE.findall(question) if word.lower() not in STOPWORDS and len(word) > 1]
    if not query_terms:
        return record, []
    tokenized = [[word.lower() for word in WORD_RE.findall(f"{text}\n{tables}")] for _, text, tables in pages]
    document_frequency = Counter(term for term in set(query_terms) for tokens in tokenized if term in set(tokens))
    total_pages = max(len(pages), 1)
    ranked = []
    for (page_number, text, tables), tokens in zip(pages, tokenized):
        counts = Counter(tokens)
        score = sum((1 + math.log(counts[term])) * math.log(1 + (total_pages - document_frequency[term] + 0.5) / (document_frequency[term] + 0.5)) for term in query_terms if counts[term])
        if score > 0:
            ranked.append((score, page_number, text, tables))
    ranked.sort(key=lambda item: item[0], reverse=True)
    if not ranked or ranked[0][0] < 1.0:
        return record, []
    minimum_score = max(1.0, ranked[0][0] * 0.12)
    sources = []
    selected = [item for item in ranked if item[0] >= minimum_score][:limit]
    for rank, (score, page_number, text, tables) in enumerate(selected, start=1):
        excerpt_parts = []
        if tables:
            excerpt_parts.append("EXTRACTED TABLE ROWS (columns preserved):\n" + tables[:1500])
        if text:
            excerpt_parts.append("PAGE TEXT:\n" + text[:900])
        excerpt = "\n\n".join(excerpt_parts).strip()
        sources.append({"id": f"S{rank}", "document_id": record["id"], "source_url": record.get("source_url"), "filename": record["filename"], "document_type": record["document_type"], "reporting_period": record["reporting_period"], "page": page_number, "relevance": round(score, 3), "excerpt": excerpt[:2400], "has_table_rows": bool(tables)})
    return record, sources
