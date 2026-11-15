"""Normalized, provenance-preserving discovery candidate contracts."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime
from enum import Enum
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.services.issuers.registry import Issuer, load_issuer_registry


class DocumentType(str, Enum):
    ANNUAL_REPORT = "annual_report"
    QUARTERLY_RESULTS = "quarterly_results"
    EARNINGS_CALL_TRANSCRIPT = "earnings_call_transcript"
    INVESTOR_PRESENTATION = "investor_presentation"
    OTHER = "other"


class PeriodKind(str, Enum):
    ANNUAL = "annual"
    FISCAL_QUARTER = "fiscal_quarter"
    OTHER = "other"


class VerificationStatus(str, Enum):
    VERIFIED = "verified"
    UNVERIFIED = "unverified"


class ReportingPeriod(BaseModel):
    """Conservative period normalization that retains the issuer's raw label."""

    model_config = ConfigDict(frozen=True)

    raw_label: str = Field(min_length=1, max_length=120)
    normalized_label: str = Field(min_length=1, max_length=120)
    kind: PeriodKind
    fiscal_year: str | None = None
    quarter: int | None = Field(default=None, ge=1, le=4)

    @classmethod
    def from_label(cls, label: str) -> "ReportingPeriod":
        raw = unicodedata.normalize("NFKC", label).strip()
        if not raw:
            raise ValueError("Reporting period cannot be empty.")
        normalized_spacing = re.sub(r"\s+", " ", raw.replace("–", "-").replace("—", "-")).strip()
        quarter_match = re.fullmatch(
            r"(?i)q\s*([1-4])\s*(?:of\s*)?fy\s*([0-9]{2,4}(?:\s*[-/]\s*[0-9]{2,4})?)",
            normalized_spacing,
        )
        if quarter_match:
            year = re.sub(r"\s*[-/]\s*", "-", quarter_match.group(2))
            quarter = int(quarter_match.group(1))
            return cls(
                raw_label=raw,
                normalized_label=f"Q{quarter} FY{year}",
                kind=PeriodKind.FISCAL_QUARTER,
                fiscal_year=year,
                quarter=quarter,
            )

        annual_match = re.fullmatch(r"(?i)fy\s*([0-9]{2,4}(?:\s*[-/]\s*[0-9]{2,4})?)", normalized_spacing)
        if annual_match:
            year = re.sub(r"\s*[-/]\s*", "-", annual_match.group(1))
            return cls(raw_label=raw, normalized_label=f"FY{year}", kind=PeriodKind.ANNUAL, fiscal_year=year)

        # Preserve the supplied period semantics when we do not recognize them.
        # In particular, do not infer fiscal quarters from calendar dates.
        return cls(
            raw_label=raw,
            normalized_label=normalized_spacing,
            kind=PeriodKind.OTHER,
        )


def _issuer_by_id(issuer_id: str) -> Issuer | None:
    return next((issuer for issuer in load_issuer_registry() if issuer.issuer_id == issuer_id), None)


def _validate_https_url(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    if value != value.strip() or any(char.isspace() for char in value):
        raise ValueError(f"{field_name} must be a valid HTTPS URL without whitespace.")
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError as exc:
        raise ValueError(f"{field_name} is malformed.") from exc
    if parsed.scheme.lower() != "https" or not hostname or parsed.username or parsed.password:
        raise ValueError(f"{field_name} must use HTTPS and include a valid host.")
    if not parsed.netloc:
        raise ValueError(f"{field_name} is malformed.")
    return value


def _host_matches(host: str, domain: str) -> bool:
    host = host.lower().rstrip(".")
    domain = domain.lower().removeprefix("www.").rstrip(".")
    return host == domain or host.endswith(f".{domain}")


def _source_is_verified(source_host: str, issuer: Issuer) -> bool:
    for domain in issuer.official_ir_domains:
        if domain.status == "verified" and _host_matches(source_host, domain.domain):
            return True
    if _host_matches(source_host, "nseindia.com") or _host_matches(source_host, "nseindia.in"):
        return issuer.nse_symbol.status == "verified" and bool(issuer.nse_symbol.value)
    if _host_matches(source_host, "bseindia.com"):
        return issuer.bse_scrip_code.status == "verified" and bool(issuer.bse_scrip_code.value)
    return False


def _stable_url(value: str) -> str:
    parsed = urlsplit(value)
    # Preserve the query string exactly; signed-link semantics can depend on its
    # order. Fragments are viewer state and do not identify a source record.
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.query, ""))


def _stable_hash(prefix: str, parts: list[str]) -> str:
    payload = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
    return f"{prefix}_{digest}"


class DiscoveryCandidate(BaseModel):
    """One candidate document, with provider provenance and stable identities."""

    model_config = ConfigDict(frozen=True, use_enum_values=True)

    issuer_id: str = Field(min_length=1, max_length=100)
    document_type: DocumentType
    reporting_period: ReportingPeriod | None = None
    title: str = Field(min_length=1, max_length=300)
    source_page_url: str = Field(min_length=1, max_length=2000)
    document_url: str | None = Field(default=None, max_length=2000)
    publication_date: datetime | None = None
    source_provider: str = Field(min_length=1, max_length=100)
    source_host: str = Field(min_length=1, max_length=253)
    verification_status: VerificationStatus = VerificationStatus.UNVERIFIED
    revision_id: str | None = Field(default=None, max_length=120)
    revision_label: str | None = Field(default=None, max_length=160)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("source_page_url")
    @classmethod
    def validate_source_page_url(cls, value: str) -> str:
        _validate_https_url(value, "source_page_url")
        return value

    @field_validator("document_url")
    @classmethod
    def validate_document_url(cls, value: str | None) -> str | None:
        return _validate_https_url(value, "document_url")

    @field_validator("issuer_id")
    @classmethod
    def validate_issuer_id(cls, value: str) -> str:
        if _issuer_by_id(value) is None:
            raise ValueError("issuer_id is not present in the FINN issuer registry.")
        return value

    @field_validator("source_provider")
    @classmethod
    def normalize_provider_name(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_.-]{0,99}", normalized):
            raise ValueError("source_provider must be a stable lowercase provider identifier.")
        return normalized

    @model_validator(mode="before")
    @classmethod
    def derive_source_host(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        values = dict(values)
        source_url = values.get("source_page_url")
        if isinstance(source_url, str):
            try:
                derived_host = urlsplit(source_url).hostname
            except ValueError:
                derived_host = None
            supplied_host = values.get("source_host")
            if supplied_host and derived_host and supplied_host.lower().rstrip(".") != derived_host.lower().rstrip("."):
                raise ValueError("source_host must match the host in source_page_url.")
            if derived_host:
                values["source_host"] = derived_host.lower()
        return values

    @model_validator(mode="after")
    def verify_source_provenance(self) -> "DiscoveryCandidate":
        issuer = _issuer_by_id(self.issuer_id)
        if issuer is None:  # guarded by field validation; retained for safe typing
            raise ValueError("issuer_id is not present in the FINN issuer registry.")
        if self.verification_status == VerificationStatus.VERIFIED and not _source_is_verified(self.source_host, issuer):
            raise ValueError("Source cannot be marked verified without an approved IR domain or verified exchange identifier.")
        return self

    @field_validator("reporting_period", mode="before")
    @classmethod
    def normalize_reporting_period(cls, value: Any) -> Any:
        if isinstance(value, str):
            return ReportingPeriod.from_label(value)
        return value

    @computed_field(return_type=str)
    @property
    def candidate_id(self) -> str:
        locator = self.document_url or self.source_page_url
        period = self.reporting_period.normalized_label if self.reporting_period else ""
        return _stable_hash("dc", [self.issuer_id, self.source_provider, self.document_type, period, _stable_url(locator), self.revision_id or "", self.revision_label or ""])

    @computed_field(return_type=str)
    @property
    def deduplication_key(self) -> str:
        locator = self.document_url or self.source_page_url
        period = self.reporting_period.normalized_label if self.reporting_period else ""
        return _stable_hash("dd", [self.issuer_id, self.document_type, period, _stable_url(locator), self.revision_id or "", self.revision_label or ""])


def normalize_reporting_period(label: str | None) -> ReportingPeriod | None:
    """Create a conservative normalized period, or keep it absent."""
    return ReportingPeriod.from_label(label) if label is not None else None
