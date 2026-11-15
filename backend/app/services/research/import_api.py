"""Additive APIs for explicitly selected document imports."""

from enum import Enum

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.services.research.import_repository import ImportStatusRepository
from app.services.research.import_service import ImportService, import_service


class ImportState(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    VALIDATING = "validating"
    EXTRACTING = "extracting"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"


class ImportStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company: str = Field(min_length=1, max_length=160)
    candidate_id: str = Field(pattern=r"^dc_[a-f0-9]{32}$")
    check_for_revision: bool = False


router = APIRouter()
repository = ImportStatusRepository()
service: ImportService = import_service


@router.post("/api/research/discovery/import", status_code=status.HTTP_202_ACCEPTED)
def start_document_import(request: ImportStartRequest, background_tasks: BackgroundTasks):
    job, created = service.start(request.company, request.candidate_id, check_for_revision=request.check_for_revision)
    if created:
        background_tasks.add_task(service.process, job["import_id"])
    return {**job, "scheduled": created, "idempotent_reuse": not created}


@router.get("/api/research/imports")
def list_document_imports(
    issuer_id: str | None = Query(default=None, max_length=100),
    state: ImportState | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
):
    items, total = repository.list(issuer_id=issuer_id, status=state.value if state else None, limit=limit, offset=offset)
    return {"imports": items, "total": total, "limit": limit, "offset": offset}


@router.get("/api/research/imports/{import_id}")
def get_document_import(import_id: str):
    job = repository.get(import_id)
    if not job:
        raise HTTPException(status_code=404, detail="Document import was not found.")
    return job


@router.post("/api/research/imports/{import_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_document_import(import_id: str, background_tasks: BackgroundTasks):
    try:
        job, scheduled = repository.retry(import_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if scheduled:
        background_tasks.add_task(service.process, import_id)
    return {**job, "scheduled": scheduled, "idempotent_reuse": not scheduled}
