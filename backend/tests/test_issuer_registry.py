from dataclasses import replace

import pytest

from app.services.issuers.registry import (
    AmbiguousIssuerError,
    UnknownIssuerError,
    build_issuer_registry,
    load_issuer_registry,
    resolve_issuer,
)


@pytest.fixture(scope="module")
def issuers():
    return load_issuer_registry()


def test_registry_includes_all_portfolio_and_research_only_companies(issuers):
    assert len(issuers) == 25
    assert resolve_issuer("Reliance Industries", issuers).canonical_name == "Reliance Industries"
    assert resolve_issuer("Titan", issuers).canonical_name == "Titan Company Limited"


def test_exact_company_name_resolution(issuers):
    issuer = resolve_issuer("Reliance Industries Limited", issuers)
    assert issuer.issuer_id == "RELIANCE.NS"


def test_bajaj_finance_canonical_name_alias_and_verified_exchange_ids(issuers):
    for query in ("Bajaj Finance Limited", "Bajaj Finance", "BAJFINANCE", "BAJFINANCE.NS", "500034"):
        issuer = resolve_issuer(query, issuers)
        assert issuer.issuer_id == "research:bajajfinance"
        assert issuer.canonical_name == "Bajaj Finance Limited"
    issuer = resolve_issuer("Bajaj Finance Limited", issuers)
    assert issuer.nse_symbol.value == "BAJFINANCE"
    assert issuer.nse_symbol.status == "verified"
    assert issuer.bse_scrip_code.value == "500034"
    assert issuer.bse_scrip_code.status == "verified"


def test_alias_resolution(issuers):
    issuer = resolve_issuer("RIL", issuers)
    assert issuer.canonical_name == "Reliance Industries"


def test_verified_nse_ticker_resolution(issuers):
    issuer = resolve_issuer("TITAN.NS", issuers)
    assert issuer.nse_symbol.value == "TITAN"
    assert issuer.nse_symbol.status == "verified"


def test_verified_bse_code_resolution(issuers):
    issuer = resolve_issuer("500114", issuers)
    assert issuer.canonical_name == "Titan Company Limited"
    assert issuer.bse_scrip_code.status == "verified"


def test_unknown_issuer_is_reported(issuers):
    with pytest.raises(UnknownIssuerError):
        resolve_issuer("Not A FINN Issuer", issuers)


def test_ambiguous_alias_is_reported_instead_of_picking_an_issuer(issuers):
    first, second, *rest = issuers
    ambiguous = (
        replace(first, aliases=first.aliases + ("Shared Alias",)),
        replace(second, aliases=second.aliases + ("Shared Alias",)),
        *rest,
    )
    with pytest.raises(AmbiguousIssuerError):
        resolve_issuer("Shared Alias", ambiguous)


def test_missing_and_unverified_metadata_remain_explicit(issuers):
    tcs = resolve_issuer("TCS", issuers)
    assert tcs.nse_symbol.value == "TCS"
    assert tcs.nse_symbol.status == "inherited_unverified"
    assert tcs.bse_scrip_code.value is None
    assert tcs.bse_scrip_code.status == "unresolved"
    assert tcs.official_ir_domains == ()

    with pytest.raises(UnknownIssuerError):
        resolve_issuer("TCS.NS", issuers)

    adani = resolve_issuer("Adani Enterprises", issuers)
    assert adani.nse_symbol.status == "unresolved"
    assert adani.bse_scrip_code.status == "unresolved"


def test_registry_rejects_unsubstantiated_verified_metadata():
    portfolio = {"companies": [{"name": "Example Co", "ticker": "EXAMPLE.NS"}], "research_only": []}
    registry_data = {"entries": [{
        "portfolio_ticker": "EXAMPLE.NS",
        "nse_symbol": {"value": "EXAMPLE", "status": "verified"},
    }]}
    with pytest.raises(ValueError, match="HTTPS verification source"):
        build_issuer_registry(portfolio, registry_data)
