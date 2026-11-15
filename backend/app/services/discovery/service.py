"""Read-only public-source discovery orchestration."""
from __future__ import annotations

from datetime import datetime, timezone
import re
from urllib.parse import urlsplit, urlunsplit

from app.services.discovery.bse import BSEDiscoveryProvider
from app.services.discovery.ir import CompanyIRProvider
from app.services.discovery.nse import NSEDiscoveryProvider
from app.services.discovery.providers import DiscoveryProvider, ProviderStatus
from app.services.discovery.schema import DiscoveryCandidate, DocumentType, ReportingPeriod
from app.services.issuers.registry import load_issuer_registry, resolve_issuer


def _cross_source_key(candidate: DiscoveryCandidate) -> tuple:
    period = candidate.reporting_period.normalized_label if candidate.reporting_period else ""
    day = candidate.publication_date.date().isoformat() if candidate.publication_date else ""
    title = re.sub(r"[^a-z0-9]+", " ", candidate.title.casefold()).strip()
    revision = candidate.revision_id or candidate.revision_label or ""
    if candidate.document_url:
        parsed = urlsplit(candidate.document_url)
        locator = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.query, ""))
        return "document_url", candidate.issuer_id, candidate.document_type, locator, revision
    return candidate.issuer_id, candidate.document_type, period, title, day, revision


def _candidate_recency(candidate: DiscoveryCandidate) -> float:
    if candidate.publication_date:
        return candidate.publication_date.timestamp()
    fiscal_year = candidate.reporting_period.fiscal_year if candidate.reporting_period else None
    if fiscal_year:
        match = re.match(r"((?:19|20)\d{2}|\d{2})", fiscal_year)
        if match:
            year = int(match.group(0))
            if year < 100:
                year += 2000 if year <= 39 else 1900
            quarter = candidate.reporting_period.quarter or 0
            return float(year * 366 * 24 * 60 * 60 + quarter * 91 * 24 * 60 * 60)
    for url in (candidate.document_url or "", candidate.source_page_url):
        match = re.search(r"/((?:19|20)\d{2})-(0[1-9]|1[0-2])(?:/|$)", urlsplit(url).path)
        if match:
            year = int(match.group(1))
            month = int(match.group(2))
            return float(year * 366 * 24 * 60 * 60 + month * 30 * 24 * 60 * 60)
    return 0.0


class DiscoveryService:
    def __init__(self, providers: tuple[DiscoveryProvider, ...] | None = None):
        self.providers = providers or (NSEDiscoveryProvider(), BSEDiscoveryProvider(), CompanyIRProvider())

    def discover(self, query: str, document_type: DocumentType | None = None, reporting_period: ReportingPeriod | None = None) -> dict:
        issuer = resolve_issuer(query, load_issuer_registry())
        types = (document_type,) if document_type else tuple(DocumentType)
        tasks = [(provider, kind) for kind in types for provider in self.providers]
        results = []
        candidate_map: dict[tuple, DiscoveryCandidate] = {}
        completed = []
        # Queries run in a bounded sequence to respect public-source rate limits.
        # The provider result boundary keeps one source failure from stopping others.
        for provider, kind in tasks:
            try:
                result = provider.search(issuer, kind, reporting_period)
            except Exception as exc:  # defensive boundary for custom providers
                from app.services.discovery.providers import ProviderResult
                result = ProviderResult(provider_id=provider.provider_id, status=ProviderStatus.ERROR, message=f"Provider failed safely: {type(exc).__name__}.", error_type=type(exc).__name__)
            results.append({"provider_id": result.provider_id, "document_type": kind.value, "status": result.status.value, "message": result.message, "error_type": result.error_type})
            completed.append((result.provider_id, kind.value, result.candidates))

        for _, _, items in sorted(completed, key=lambda row: (row[0], row[1])):
            for item in items:
                key = _cross_source_key(item)
                prior = candidate_map.get(key)
                if prior is None:
                    candidate_map[key] = item
                elif prior.source_provider != item.source_provider:
                    metadata = dict(prior.metadata)
                    alternatives = list(metadata.get("alternate_sources", []))
                    alternate = {"provider": item.source_provider, "source_page_url": item.source_page_url, "document_url": item.document_url}
                    if alternate not in alternatives:
                        alternatives.append(alternate)
                    metadata["alternate_sources"] = alternatives
                    candidate_map[key] = prior.model_copy(update={"metadata": metadata})

        ordered = sorted(candidate_map.values(), key=lambda item: (
            0 if reporting_period and item.reporting_period and item.reporting_period.normalized_label == reporting_period.normalized_label else 1,
            -_candidate_recency(item),
            item.title.casefold(),
        ))
        results.sort(key=lambda item: (item["provider_id"], item["document_type"]))
        failures = [item for item in results if item["status"] in {"timeout", "error"}]
        return {
            "issuer": {
                "issuer_id": issuer.issuer_id,
                "canonical_name": issuer.canonical_name,
                "nse_symbol": {"value": issuer.nse_symbol.value, "status": issuer.nse_symbol.status},
                "bse_scrip_code": {"value": issuer.bse_scrip_code.value, "status": issuer.bse_scrip_code.status},
            },
            "candidates": [item.model_dump(mode="json") for item in ordered],
            "providers": results,
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            "warnings": [item["message"] for item in failures if item.get("message")],
        }
