"""Read-only issuer registry built from the portfolio plus verified overlays.

The portfolio remains the source of demo-company names and current tickers. This
registry adds verified exchange identifiers and IR domains without changing
portfolio, announcement, or Research behavior.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[4]
PORTFOLIO_PATH = ROOT / "data" / "portfolio.json"
REGISTRY_PATH = ROOT / "data" / "issuer_registry.json"
IDENTIFIER_STATUSES = {"verified", "inherited_unverified", "unverified", "unresolved"}


class IssuerResolutionError(LookupError):
    """Base class for exact issuer-resolution failures."""


class UnknownIssuerError(IssuerResolutionError):
    """Raised when an exact name, alias, or verified identifier is absent."""


class AmbiguousIssuerError(IssuerResolutionError):
    """Raised when an exact alias maps to more than one issuer."""


@dataclass(frozen=True)
class Identifier:
    value: str | None
    status: str
    source_url: str | None = None


@dataclass(frozen=True)
class OfficialDomain:
    domain: str
    status: str
    source_url: str | None = None


@dataclass(frozen=True)
class Issuer:
    issuer_id: str
    canonical_name: str
    aliases: tuple[str, ...]
    portfolio_ticker: str | None
    nse_symbol: Identifier
    bse_scrip_code: Identifier
    official_ir_domains: tuple[OfficialDomain, ...]


def _normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _identifier(value: Any, *, inherited: bool = False) -> Identifier:
    if isinstance(value, dict):
        identifier = Identifier(
            value=str(value["value"]).strip().upper() if value.get("value") not in (None, "") else None,
            status=str(value.get("status", "unresolved")),
            source_url=value.get("source_url"),
        )
        if identifier.status not in IDENTIFIER_STATUSES:
            raise ValueError(f"Unsupported identifier status: {identifier.status}")
        if identifier.status == "verified" and (not identifier.value or not _is_https_url(identifier.source_url)):
            raise ValueError("Verified identifiers require a value and an HTTPS verification source.")
        if identifier.status == "unresolved" and identifier.value:
            raise ValueError("Unresolved identifiers cannot contain a value.")
        return identifier
    if value not in (None, ""):
        return Identifier(str(value).strip().upper(), "inherited_unverified" if inherited else "unverified")
    return Identifier(None, "unresolved")


def _is_https_url(value: str | None) -> bool:
    parsed = urlsplit(value or "")
    return parsed.scheme == "https" and bool(parsed.hostname)


def _build_issuer(portfolio_entry: dict[str, Any], annotation: dict[str, Any] | None = None) -> Issuer:
    annotation = annotation or {}
    ticker = str(portfolio_entry.get("ticker", "")).strip().upper() or None
    inherited_nse = None
    if ticker and ticker.endswith(".NS"):
        inherited_nse = ticker[:-3]

    canonical = str(annotation.get("canonical_name") or portfolio_entry["name"]).strip()
    aliases = tuple(dict.fromkeys(str(alias).strip() for alias in annotation.get("aliases", []) if str(alias).strip()))
    domains = tuple(
        OfficialDomain(str(item["domain"]).lower().strip().removeprefix("www."), str(item.get("status", "unverified")), item.get("source_url"))
        for item in annotation.get("official_ir_domains", [])
        if isinstance(item, dict) and item.get("domain")
    )
    for domain in domains:
        if domain.status not in {"verified", "unverified"}:
            raise ValueError(f"Unsupported official-domain status: {domain.status}")
        if domain.status == "verified" and not _is_https_url(domain.source_url):
            raise ValueError("Verified IR domains require an HTTPS verification source.")
    return Issuer(
        issuer_id=str(annotation.get("issuer_id") or ticker or f"research:{_normalise(canonical)}"),
        canonical_name=canonical,
        aliases=aliases,
        portfolio_ticker=ticker,
        nse_symbol=_identifier(annotation.get("nse_symbol") or inherited_nse, inherited=not annotation.get("nse_symbol")),
        bse_scrip_code=_identifier(annotation.get("bse_scrip_code")),
        official_ir_domains=domains,
    )


def build_issuer_registry(portfolio: dict[str, Any], registry_data: dict[str, Any]) -> tuple[Issuer, ...]:
    """Materialise all demo issuers, retaining unresolved metadata explicitly."""
    annotations = registry_data.get("entries", [])
    by_ticker = {str(entry.get("portfolio_ticker", "")).upper(): entry for entry in annotations if entry.get("portfolio_ticker")}
    by_research_name = {_normalise(str(entry.get("research_only_name", ""))): entry for entry in annotations if entry.get("research_only_name")}

    issuers: list[Issuer] = []
    companies = portfolio.get("companies", [])
    for company in companies:
        ticker = str(company.get("ticker", "")).upper()
        issuers.append(_build_issuer(company, by_ticker.get(ticker)))

    for research_name in portfolio.get("research_only", []):
        issuer_id = f"research:{_normalise(str(research_name))}"
        annotation = by_research_name.get(_normalise(str(research_name)))
        base = {"name": str(research_name)}
        if annotation and annotation.get("issuer_id"):
            base["ticker"] = None
        issuer = _build_issuer(base, annotation)
        issuers.append(Issuer(
            issuer_id=issuer.issuer_id or issuer_id,
            canonical_name=issuer.canonical_name,
            aliases=issuer.aliases,
            portfolio_ticker=None,
            nse_symbol=issuer.nse_symbol,
            bse_scrip_code=issuer.bse_scrip_code,
            official_ir_domains=issuer.official_ir_domains,
        ))

    return tuple(issuers)


def load_issuer_registry() -> tuple[Issuer, ...]:
    """Load portfolio-backed issuers and their separately maintained annotations."""
    with PORTFOLIO_PATH.open(encoding="utf-8") as stream:
        portfolio = json.load(stream)
    with REGISTRY_PATH.open(encoding="utf-8") as stream:
        registry_data = json.load(stream)
    return build_issuer_registry(portfolio, registry_data)


def resolve_issuer(query: str, issuers: tuple[Issuer, ...] | None = None) -> Issuer:
    """Resolve an exact name, alias, NSE symbol/ticker, or BSE scrip code.

    Unverified inherited metadata is retained for display but is not used as an
    official identifier for resolution.
    """
    term = query.strip()
    if not term:
        raise UnknownIssuerError("Issuer query is empty.")
    candidates = issuers if issuers is not None else load_issuer_registry()
    key = _normalise(term)
    matches = []
    for issuer in candidates:
        name_match = key in {_normalise(issuer.canonical_name), *(_normalise(alias) for alias in issuer.aliases)}
        nse_match = issuer.nse_symbol.status == "verified" and issuer.nse_symbol.value and key in {
            _normalise(issuer.nse_symbol.value),
            _normalise(f"{issuer.nse_symbol.value}.NS"),
        }
        bse_match = issuer.bse_scrip_code.status == "verified" and issuer.bse_scrip_code.value and key == _normalise(issuer.bse_scrip_code.value)
        if name_match or nse_match or bse_match:
            matches.append(issuer)
    if not matches:
        raise UnknownIssuerError(f"No issuer matches {term!r} using verified registry metadata.")
    if len(matches) > 1:
        raise AmbiguousIssuerError(f"Issuer query {term!r} matches multiple registry entries.")
    return matches[0]
