"""Conservative document identity, checksum and revision matching."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.services.discovery.schema import DiscoveryCandidate, ReportingPeriod
from app.services.issuers.registry import AmbiguousIssuerError, UnknownIssuerError, resolve_issuer


@dataclass(frozen=True)
class IdentityMatch:
    identical: dict | None = None
    previous_revision: dict | None = None
    possible_duplicate_ids: tuple[str, ...] = ()


def canonical_document_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlsplit(url)
    excluded = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"}
    query = urlencode(sorted((key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key.casefold() not in excluded))
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, query, ""))


def _normal_type(value: str | None) -> str:
    normalized = "".join(char for char in str(value or "").casefold() if char.isalnum())
    aliases = {
        "annualreport": "annualreport", "annualreports": "annualreport",
        "quarterlyresults": "quarterlyresults", "quarterlyfinancialresults": "quarterlyresults",
        "earningscalltranscript": "earningscalltranscript", "concalltranscript": "earningscalltranscript",
        "investorpresentation": "investorpresentation",
    }
    return aliases.get(normalized, normalized)


def _record_issuer_id(record: dict) -> str | None:
    if record.get("issuer_id"):
        return str(record["issuer_id"])
    try:
        query = record.get("ticker") or record.get("company") or ""
        return resolve_issuer(query).issuer_id if query else None
    except (UnknownIssuerError, AmbiguousIssuerError):
        return None


def _period(value: str | None) -> str:
    if not value:
        return ""
    try:
        return ReportingPeriod.from_label(value).normalized_label.casefold()
    except ValueError:
        return str(value).strip().casefold()


def _basis(record: dict) -> str | None:
    value = record.get("statement_basis")
    if value is None:
        value = (record.get("source_metadata") or {}).get("statement_basis")
    return str(value).strip().casefold() if value not in (None, "") else None


def _provider(record: dict) -> str | None:
    return record.get("source_provider") or (record.get("source_metadata") or {}).get("provider")


def _source_id(record: dict) -> str | None:
    metadata = record.get("source_metadata") or {}
    value = record.get("source_document_id") or metadata.get("filing_id") or metadata.get("source_document_id")
    return str(value) if value not in (None, "") else None


def _same_scope(record: dict, candidate: DiscoveryCandidate) -> bool:
    return (
        _record_issuer_id(record) == candidate.issuer_id
        and _normal_type(record.get("document_type")) == _normal_type(candidate.document_type)
        and _period(record.get("reporting_period")) == _period(candidate.reporting_period.normalized_label if candidate.reporting_period else None)
        and _basis(record) == _basis({"statement_basis": candidate.metadata.get("statement_basis")})
    )


def _same_source_identity(record: dict, candidate: DiscoveryCandidate) -> bool:
    if not _same_scope(record, candidate) or _provider(record) != candidate.source_provider:
        return False
    record_source_id = _source_id(record)
    candidate_source_id = candidate.metadata.get("filing_id") or candidate.metadata.get("source_document_id")
    if record_source_id and candidate_source_id and str(record_source_id) == str(candidate_source_id):
        return True
    record_url = canonical_document_url(record.get("document_url") or record.get("source_url"))
    candidate_url = canonical_document_url(candidate.document_url)
    return bool(record_url and candidate_url and record_url == candidate_url)


class DocumentIdentityService:
    def match(self, records: list[dict], candidate: DiscoveryCandidate, sha256: str) -> IdentityMatch:
        identical = [
            record for record in records
            if record.get("sha256") == sha256 and _same_scope(record, candidate)
            and self._same_version_identity(record, candidate)
        ]
        identical.sort(key=lambda record: (int(record.get("version_number", 1)), str(record.get("indexed_at", ""))), reverse=True)
        if identical:
            return IdentityMatch(identical=identical[0])

        revisions = [record for record in records if _same_source_identity(record, candidate)]
        revisions.sort(key=lambda record: (int(record.get("version_number", 1)), str(record.get("indexed_at", ""))), reverse=True)

        ambiguous_duplicates = tuple(
            str(record.get("id")) for record in records
            if record.get("sha256") == sha256
            and _record_issuer_id(record) == candidate.issuer_id
            and _normal_type(record.get("document_type")) == _normal_type(candidate.document_type)
            and not _same_scope(record, candidate)
            and record.get("id")
        )
        return IdentityMatch(previous_revision=revisions[0] if revisions else None, possible_duplicate_ids=ambiguous_duplicates)

    @staticmethod
    def _same_version_identity(record: dict, candidate: DiscoveryCandidate) -> bool:
        """Keep explicitly distinct source/revision identities separate."""
        candidate_source_id = candidate.metadata.get("filing_id") or candidate.metadata.get("source_document_id")
        record_source_id = _source_id(record)
        if record_source_id and candidate_source_id and str(record_source_id) != str(candidate_source_id):
            return False
        record_revision = record.get("revision_id")
        if record_revision and candidate.revision_id and str(record_revision) != str(candidate.revision_id):
            return False
        record_label = record.get("revision_label")
        if record_label and candidate.revision_label and str(record_label).casefold() != str(candidate.revision_label).casefold():
            return False
        return True
