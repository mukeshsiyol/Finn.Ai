"""BSE discovery status adapter.

BSE's public announcement page is an interactive browser application. FINN does
not use undocumented/subscription data endpoints; until a permitted public
structured endpoint is established, this provider reports the limitation.
"""
from app.services.discovery.providers import DiscoveryProvider
from app.services.discovery.schema import DocumentType, ReportingPeriod
from app.services.issuers.registry import Issuer


class UnsupportedSourceAccess(RuntimeError):
    """Access path has not been confirmed as permitted for anonymous public use."""


class BSEDiscoveryProvider(DiscoveryProvider):
    provider_id = "bse"

    def discover(self, issuer: Issuer, document_type: DocumentType, reporting_period: ReportingPeriod | None = None):
        if issuer.bse_scrip_code.status != "verified" or not issuer.bse_scrip_code.value:
            raise UnsupportedSourceAccess("BSE discovery skipped: this issuer has no verified BSE scrip code.")
        raise UnsupportedSourceAccess(
            "BSE's public announcements page is available, but FINN has not confirmed a permitted unauthenticated structured feed. "
            "No subscription-only or undocumented endpoint was queried."
        )
