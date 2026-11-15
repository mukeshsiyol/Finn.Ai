"""Provider interface and isolated result states for discovery adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Sequence

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.discovery.schema import DiscoveryCandidate, DocumentType, ReportingPeriod
from app.services.issuers.registry import Issuer, load_issuer_registry


class ProviderStatus(str, Enum):
    SUCCESS = "success"
    EMPTY = "empty"
    TIMEOUT = "timeout"
    ERROR = "error"


class ProviderResult(BaseModel):
    """Result from one provider, independent of other providers' outcomes."""

    model_config = ConfigDict(frozen=True)

    provider_id: str = Field(min_length=1, max_length=100)
    status: ProviderStatus
    candidates: tuple[DiscoveryCandidate, ...] = ()
    message: str | None = Field(default=None, max_length=500)
    error_type: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def validate_status_payload(self) -> "ProviderResult":
        if self.status == ProviderStatus.SUCCESS and not self.candidates:
            raise ValueError("Successful provider results must contain candidates; use empty for no matches.")
        if self.status == ProviderStatus.EMPTY and self.candidates:
            raise ValueError("Empty provider results cannot contain candidates.")
        if self.status in {ProviderStatus.TIMEOUT, ProviderStatus.ERROR} and not self.message:
            raise ValueError("Timeout and error results must include a message.")
        if self.status in {ProviderStatus.TIMEOUT, ProviderStatus.ERROR} and self.candidates:
            raise ValueError("Timeout and error results cannot contain candidates.")
        if self.status in {ProviderStatus.EMPTY, ProviderStatus.SUCCESS} and self.error_type:
            raise ValueError("Successful and empty results cannot include an error type.")
        return self


class DiscoveryProvider(ABC):
    """Base interface; adapters implement only source-specific candidate lookup."""

    provider_id: str

    @abstractmethod
    def discover(
        self,
        issuer: Issuer,
        document_type: DocumentType,
        reporting_period: ReportingPeriod | None = None,
    ) -> Sequence[DiscoveryCandidate]:
        """Return normalized candidates from this provider (no shared storage)."""

    def search(
        self,
        issuer: Issuer,
        document_type: DocumentType,
        reporting_period: ReportingPeriod | None = None,
    ) -> ProviderResult:
        registered = next((item for item in load_issuer_registry() if item.issuer_id == issuer.issuer_id), None)
        if registered is None:
            return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.ERROR, message="Issuer is not in the FINN registry.", error_type="InvalidIssuer")
        try:
            candidates = tuple(self.discover(registered, document_type, reporting_period))
        except (TimeoutError,):
            return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.TIMEOUT, message="The source provider timed out.", error_type="TimeoutError")
        except Exception as exc:
            return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.ERROR, message=str(exc)[:500] or "The source provider failed.", error_type=type(exc).__name__[:100])

        if not candidates:
            return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.EMPTY)

        for candidate in candidates:
            if not isinstance(candidate, DiscoveryCandidate):
                return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.ERROR, message="Provider returned a non-normalized candidate.", error_type="ProviderContractError")
            if candidate.source_provider != self.provider_id:
                return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.ERROR, message="Candidate provider provenance does not match the provider.", error_type="ProviderContractError")
            if candidate.issuer_id != registered.issuer_id:
                return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.ERROR, message="Provider returned a candidate for a different issuer.", error_type="ProviderContractError")
            if candidate.document_type != document_type:
                return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.ERROR, message="Provider returned a candidate with a different document type.", error_type="ProviderContractError")
            if reporting_period and (candidate.reporting_period is None or candidate.reporting_period.normalized_label != reporting_period.normalized_label):
                return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.ERROR, message="Provider returned a candidate for a different reporting period.", error_type="ProviderContractError")

        unique: dict[str, DiscoveryCandidate] = {}
        for candidate in candidates:
            unique.setdefault(candidate.candidate_id, candidate)
        return ProviderResult(provider_id=self.provider_id, status=ProviderStatus.SUCCESS, candidates=tuple(unique.values()))
