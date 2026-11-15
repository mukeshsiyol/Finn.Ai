"""Evidence retrieval answer generation and source verification for Research."""

import re
from pathlib import Path

from fastapi import HTTPException
from pypdf import PdfReader

from app.services.intelligence.openai_service import generate_text
from app.services.research.documents import STOPWORDS, UPLOADS_DIR, WORD_RE, _manifest


_HEADINGS = {
    "bull case", "bear case", "final assessment", "key assumptions",
    "valuation considerations", "potential catalysts", "unresolved questions",
    "evidence quality and confidence",
}


def _normalized_words(text: str) -> set[str]:
    return {term.lower().rstrip("s") for term in WORD_RE.findall(text) if term.lower() not in STOPWORDS and len(term) > 2}


def verify_generated_claims(answer: str, sources: list[dict], prefix: str = "S") -> dict:
    """Fail closed on bad citations, page mappings, source metadata, and weak claims."""
    citation_pattern = rf"\[({re.escape(prefix)}\d+)\]"
    source_map: dict[str, dict] = {}
    failures: list[dict] = []
    for source in sources:
        source_id = source.get("id")
        if not isinstance(source_id, str) or source_id in source_map:
            failures.append({"type": "source_mapping", "citation_id": source_id, "reason": "Retrieved evidence has a missing or duplicate source ID."})
            continue
        source_map[source_id] = source

    records = {item.get("id"): item for item in _manifest()}
    checked_pages: dict[str, int | None] = {}
    for source_id, source in source_map.items():
        document_id = source.get("document_id")
        page = source.get("page")
        if not document_id:
            failures.append({"type": "source_mapping", "citation_id": source_id, "reason": "Retrieved evidence is not linked to an indexed document."})
            continue
        record = records.get(document_id)
        if not record:
            failures.append({"type": "missing_source", "citation_id": source_id, "reason": "The cited source document is no longer in the document library."})
            continue
        filename = record.get("filename")
        for field in ("company", "ticker", "filename", "document_type", "reporting_period"):
            source_value = source.get(field)
            record_value = record.get(field)
            if source_value is not None and record_value is not None and str(source_value).strip().casefold() != str(record_value).strip().casefold():
                failures.append({"type": "source_mapping", "citation_id": source_id, "reason": f"The retrieved {field} does not match the selected PDF record."})
        if not filename or source.get("filename") != filename or not isinstance(page, int):
            failures.append({"type": "source_mapping", "citation_id": source_id, "reason": "The source filename or one-based PDF page is missing or does not match the indexed document."})
            continue
        if document_id not in checked_pages:
            stored_name = record.get("stored_name") or f"{document_id}.pdf"
            source_path = UPLOADS_DIR / stored_name
            try:
                safe_path = source_path.resolve()
                safe_root = UPLOADS_DIR.resolve()
                if safe_path.parent != safe_root:
                    raise ValueError("PDF path is outside the document library.")
                checked_pages[document_id] = len(PdfReader(str(safe_path)).pages)
            except Exception:
                checked_pages[document_id] = None
        actual_pages = checked_pages[document_id]
        if actual_pages is None:
            failures.append({"type": "missing_source", "citation_id": source_id, "reason": "The stored PDF is missing or could not be opened."})
        elif page < 1 or page > actual_pages:
            failures.append({"type": "page_mapping", "citation_id": source_id, "page": page, "expected_page": actual_pages, "reason": "The cited page is outside the stored PDF page range."})

    cited_ids = set(re.findall(citation_pattern, answer))
    if not cited_ids:
        failures.append({"type": "missing_source", "reason": "The generated answer did not cite any retrieved source."})
    for citation_id in sorted(cited_ids - set(source_map)):
        failures.append({"type": "missing_source", "citation_id": citation_id, "reason": "The answer cites an evidence ID that was not supplied."})

    for citation_id in sorted(cited_ids & set(source_map)):
        source = source_map[citation_id]
        for line in answer.splitlines():
            if citation_id not in re.findall(citation_pattern, line):
                continue
            cited_page = re.search(rf"(?:\bp(?:age)?\.?\s*(\d+)\s*\[{re.escape(citation_id)}\]|\[{re.escape(citation_id)}\]\s*\bp(?:age)?\.?\s*(\d+))", line, re.I)
            if cited_page:
                stated_page = int(cited_page.group(1) or cited_page.group(2))
                if stated_page != source.get("page"):
                    failures.append({"type": "page_mapping", "citation_id": citation_id, "page": stated_page, "expected_page": source.get("page"), "reason": f"The answer says page {stated_page}, but this source ID maps to page {source.get('page')}."})

    # Treat one answer line/bullet as a claim group: citations at the end of the
    # line support its sentences. A new uncited line remains a hard failure.
    for line in answer.splitlines():
        stripped = line.strip()
        heading = re.sub(r"^[#*\s\d.)-]+", "", stripped).strip(" *_:-").lower()
        if not stripped or heading in _HEADINGS:
            continue
        line_citations = re.findall(citation_pattern, stripped)
        sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z*\[])", stripped)
        for sentence in sentences:
            if not line_citations:
                failures.append({"type": "unsupported_claim", "claim": sentence[:300], "reason": "This response sentence has no citation to supporting evidence."})
                continue
            evidence_text = " ".join(source_map[source_id].get("excerpt", "") for source_id in line_citations if source_id in source_map)
            claim_text = re.sub(citation_pattern, "", sentence)
            claim_text = re.sub(r"^\s*(?:[-*•]\s*)?(?:Management stated|FINN interpretation)\s*:?\s*", "", claim_text, flags=re.I)
            claim_words = _normalized_words(claim_text)
            evidence_words = _normalized_words(evidence_text)
            numbers = {number.replace(",", "").rstrip("%") for number in re.findall(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?%?", claim_text)}
            evidence_numbers = {number.replace(",", "").rstrip("%") for number in re.findall(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?%?", evidence_text)}
            unsupported_numbers = sorted(numbers - evidence_numbers)
            overlap = len(claim_words & evidence_words)
            if unsupported_numbers:
                failures.append({"type": "unsupported_claim", "claim": sentence[:300], "citation_ids": line_citations, "reason": f"The cited excerpts do not contain these stated figures: {', '.join(unsupported_numbers[:5])}."})
            elif len(claim_words) >= 6 and overlap < 2:
                failures.append({"type": "unsupported_claim", "claim": sentence[:300], "citation_ids": line_citations, "reason": "The claim has little matching wording in its cited excerpts; review it as a possible unsupported inference."})

    unique = {(item["type"], item.get("citation_id"), item.get("claim"), item["reason"]): item for item in failures}
    diagnostics = list(unique.values())
    return {
        "status": "withheld" if diagnostics else "verified",
        "failures": diagnostics,
        "note": "Source IDs, indexed document metadata, actual PDF page ranges, uncited sentences, and explicit figures are checked. Text-overlap checks remain heuristic and cannot prove semantic correctness.",
    }


def _evidence_context(question: str, sources: list[dict]) -> str:
    return "\n\n".join(
        f"[{source['id']}] {source['company']} ({source['ticker']}) · {source['filename']} · {source['document_type']} · {source['reporting_period']} · PDF page {source['page']}\n{source['excerpt']}"
        for source in sources
    )


def synthesize_research_answer(question: str, sources: list[dict]) -> tuple[str, dict]:
    """Generate only from retrieved PDF evidence; retry one invalid draft, then withhold."""
    evidence = _evidence_context(question, sources)
    instructions = (
        "You are FINN's primary-source research engine. Answer only from the supplied PDF passages. "
        "Do not use prior knowledge, the internet, or assumptions to fill gaps. Every factual line or bullet, including one labelled FINN interpretation, must end with one or more supplied citation IDs such as [S1]. Keep claims supported by the same passage together on one line. "
        "Use only claims and figures that appear in the cited passage. Distinguish exact management statements from FINN interpretation. "
        "If evidence is insufficient, say what is missing and cite the closest relevant passage. Keep the answer concise."
    )
    first_prompt = f"Question: {question}\n\nRetrieved primary-source evidence (use only these passages):\n{evidence}"
    try:
        answer = generate_text(instructions, first_prompt, 600).strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Retrieved source pages are available, but the configured AI provider could not complete the research request.") from exc
    verification = verify_generated_claims(answer, sources, "S")
    attempts = 1
    if verification["status"] == "withheld":
        attempts = 2
        issues = "\n".join(f"- {failure['reason']} {failure.get('claim', '')}" for failure in verification["failures"][:8])
        retry_instructions = instructions + " Revise the answer to fix every listed verification failure. Do not repeat an uncited or unsupported sentence."
        retry_prompt = (
            f"Question: {question}\n\nRetrieved primary-source evidence (the only permitted factual basis):\n{evidence}\n\n"
            f"Rejected draft (untrusted; do not rely on it):\n{answer[:5000]}\n\n"
            f"Verification failures to correct:\n{issues}\n\nReturn a concise corrected answer with a valid citation on every factual sentence."
        )
        try:
            answer = generate_text(retry_instructions, retry_prompt, 600).strip()
            verification = verify_generated_claims(answer, sources, "S")
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Retrieved source pages are available, but the AI correction attempt failed.") from exc
    verification["attempts"] = attempts
    if verification["status"] == "withheld":
        withheld = "FINN could not verify the generated citations after one correction attempt. Review the retrieved primary-source passages below."
        return withheld, verification
    return answer, verification
