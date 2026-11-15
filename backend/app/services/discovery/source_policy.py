"""Import-time policy for trusted Phase 2 candidates and document hosts."""

from __future__ import annotations

from urllib.parse import urlsplit

from app.services.discovery.schema import DiscoveryCandidate
from app.services.issuers.registry import load_issuer_registry


NSE_HOSTS = ("nseindia.com", "nseindia.in")
BSE_HOSTS = ("bseindia.com",)
IR_DOCUMENT_HOSTS = {"RELIANCE.NS": ("rilstaticasset.akamaized.net",)}


class SourcePolicyError(ValueError):
    """Candidate provenance or download destination is not approved."""


def _matches(host: str, domain: str) -> bool:
    host, domain = host.lower().rstrip("."), domain.lower().removeprefix("www.").rstrip(".")
    return host == domain or host.endswith("." + domain)


def _parse_https(value: str, *, label: str) -> tuple[str, str, str]:
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        port = parsed.port
    except ValueError as exc:
        raise SourcePolicyError(f"{label} is malformed.") from exc
    if parsed.scheme.lower() != "https" or not host or parsed.username or parsed.password:
        raise SourcePolicyError(f"{label} must be a credential-free HTTPS URL.")
    if port not in (None, 443):
        raise SourcePolicyError(f"{label} uses an unsupported port.")
    if any(char in value for char in "\r\n\t "):
        raise SourcePolicyError(f"{label} contains invalid whitespace.")
    return host.lower().rstrip("."), parsed.path or "/", parsed.query


def approved_document_domains(candidate: DiscoveryCandidate) -> tuple[str, ...]:
    """Validate provider, issuer verification and both provenance URLs."""
    if candidate.verification_status != "verified":
        raise SourcePolicyError("Only verified discovery candidates can be imported.")
    issuer = next((item for item in load_issuer_registry() if item.issuer_id == candidate.issuer_id), None)
    if issuer is None:
        raise SourcePolicyError("Candidate issuer is no longer present in the FINN registry.")
    page_host, _, _ = _parse_https(candidate.source_page_url, label="Listing page URL")
    document_host, path, _ = _parse_https(candidate.document_url or "", label="Document URL")
    if not path.lower().endswith(".pdf"):
        raise SourcePolicyError("Only direct PDF document links can be imported.")

    if candidate.source_provider == "nse":
        if issuer.nse_symbol.status != "verified" or not issuer.nse_symbol.value:
            raise SourcePolicyError("NSE import requires a verified NSE issuer symbol.")
        if not any(_matches(page_host, domain) for domain in NSE_HOSTS):
            raise SourcePolicyError("NSE candidate listing page is outside the approved NSE domains.")
        if not any(_matches(document_host, domain) for domain in NSE_HOSTS):
            raise SourcePolicyError("NSE document URL is outside the approved NSE domains.")
        return NSE_HOSTS

    if candidate.source_provider == "bse":
        if issuer.bse_scrip_code.status != "verified" or not issuer.bse_scrip_code.value:
            raise SourcePolicyError("BSE import requires a verified BSE scrip code.")
        if not any(_matches(page_host, domain) for domain in BSE_HOSTS):
            raise SourcePolicyError("BSE candidate listing page is outside the approved BSE domains.")
        if not any(_matches(document_host, domain) for domain in BSE_HOSTS):
            raise SourcePolicyError("BSE document URL is outside the approved BSE domains.")
        return BSE_HOSTS

    if candidate.source_provider == "ir":
        ir_domains = tuple(domain.domain for domain in issuer.official_ir_domains if domain.status == "verified")
        if not ir_domains or not any(_matches(page_host, domain) for domain in ir_domains):
            raise SourcePolicyError("Investor-relations listing page is not on a verified issuer domain.")
        document_domains = ir_domains + IR_DOCUMENT_HOSTS.get(issuer.issuer_id, ())
        if not any(_matches(document_host, domain) for domain in document_domains):
            raise SourcePolicyError("Document URL is outside the approved issuer/IR document hosts.")
        return tuple(dict.fromkeys(document_domains))

    raise SourcePolicyError("This discovery provider is not approved for document imports.")


def validate_redirect_url(url: str, allowed_domains: tuple[str, ...]) -> tuple[str, str, str]:
    host, path, query = _parse_https(url, label="Redirect URL")
    if not any(_matches(host, domain) for domain in allowed_domains):
        raise SourcePolicyError("Redirect destination is outside the approved document hosts.")
    return host, path, query
