"""Additive, read-only discovery API."""
from fastapi import APIRouter, HTTPException, Query

from app.services.discovery.schema import DocumentType, ReportingPeriod
from app.services.discovery.service import DiscoveryService
from app.services.issuers.registry import AmbiguousIssuerError, UnknownIssuerError

router = APIRouter()
_service = DiscoveryService()


@router.get("/api/research/discovery")
def get_public_discovery(
    company: str = Query(min_length=1, max_length=160),
    document_type: DocumentType | None = None,
    reporting_period: str | None = Query(default=None, min_length=1, max_length=120),
):
    period = None
    if reporting_period is not None:
        try:
            period = ReportingPeriod.from_label(reporting_period)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid reporting period.") from exc
    try:
        return _service.discover(company, document_type, period)
    except UnknownIssuerError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AmbiguousIssuerError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
