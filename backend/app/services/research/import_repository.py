"""Atomic JSON import-job persistence matching FINN's existing file-store model."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

from app.services.research.documents import REPORTS_DIR


IMPORTS_PATH = REPORTS_DIR / "imports.json"
ACTIVE_STATES = {"pending", "downloading", "validating", "extracting", "indexing"}
PROGRESS = {"pending": 0, "downloading": 15, "validating": 40, "extracting": 60, "indexing": 85, "ready": 100, "failed": 0}
NEXT_STATES = {"downloading": {"validating"}, "validating": {"extracting"}, "extracting": {"indexing"}, "indexing": {"ready"}}
_lock = RLock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _copy(value: dict) -> dict:
    return json.loads(json.dumps(value, ensure_ascii=False))


class ImportRepositoryError(RuntimeError):
    pass


class ImportStatusRepository:
    def __init__(self, path: Path = IMPORTS_PATH):
        self.path = path
        self.lock = _lock if path == IMPORTS_PATH else RLock()

    def _read(self) -> list[dict]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            return []
        try:
            content = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ImportRepositoryError("The import status store could not be read; existing records were preserved.") from exc
        if not isinstance(content, list) or any(not isinstance(row, dict) for row in content):
            raise ImportRepositoryError("The import status store has an invalid format; existing records were preserved.")
        return content

    def _write(self, rows: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                json.dump(rows, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def public_view(job: dict) -> dict:
        fields = (
            "import_id", "candidate_id", "issuer_id", "company", "ticker", "document_type",
            "reporting_period", "status", "stage", "progress", "document_id", "created_at",
            "updated_at", "started_at", "completed_at", "retryable", "failure_category",
            "failure_reason", "attempts", "document_metadata", "extraction_summary",
        )
        return {key: _copy({key: job[key]})[key] for key in fields if key in job}

    def create(self, candidate: dict, *, check_for_revision: bool = False) -> tuple[dict, bool]:
        candidate_id = str(candidate.get("candidate_id") or "")
        issuer = candidate.get("issuer_id")
        with self.lock:
            rows = self._read()
            matches = [row for row in rows if row.get("candidate_id") == candidate_id and row.get("issuer_id") == issuer]
            active = next((row for row in reversed(matches) if row.get("status") in ACTIVE_STATES), None)
            if active:
                return self.public_view(active), False
            failed = next((row for row in reversed(matches) if row.get("status") == "failed"), None)
            if failed:
                return self.public_view(failed), False
            ready = next((row for row in reversed(matches) if row.get("status") == "ready"), None)
            if ready and not check_for_revision:
                return self.public_view(ready), False
            now = _now()
            job = {
                "import_id": str(uuid4()), "candidate_id": candidate_id, "issuer_id": issuer,
                "company": candidate.get("issuer_name") or candidate.get("company") or issuer,
                "ticker": candidate.get("ticker"), "document_type": candidate.get("document_type"),
                "reporting_period": candidate.get("reporting_period"), "candidate": _copy(candidate),
                "status": "pending", "stage": "pending", "progress": PROGRESS["pending"],
                "document_id": None, "document_metadata": None, "created_at": now,
                "updated_at": now, "started_at": None, "completed_at": None,
                "retryable": False, "failure_category": None, "failure_reason": None,
                "attempts": [],
            }
            rows.append(job)
            self._write(rows)
            return self.public_view(job), True

    def get_internal(self, import_id: str) -> dict | None:
        with self.lock:
            row = next((item for item in self._read() if item.get("import_id") == import_id), None)
            return _copy(row) if row else None

    def get(self, import_id: str) -> dict | None:
        row = self.get_internal(import_id)
        return self.public_view(row) if row else None

    def list(self, *, issuer_id: str | None = None, status: str | None = None, limit: int = 50, offset: int = 0) -> tuple[list[dict], int]:
        with self.lock:
            rows = self._read()
        if issuer_id:
            rows = [row for row in rows if row.get("issuer_id", "").casefold() == issuer_id.casefold()]
        if status:
            rows = [row for row in rows if row.get("status") == status]
        rows.sort(key=lambda row: row.get("created_at", ""), reverse=True)
        return [self.public_view(row) for row in rows[offset: offset + limit]], len(rows)

    def begin_attempt(self, import_id: str) -> dict | None:
        with self.lock:
            rows = self._read()
            job = next((row for row in rows if row.get("import_id") == import_id), None)
            if not job or job.get("status") != "pending":
                return None
            now = _now()
            attempt = {"attempt": len(job.get("attempts", [])) + 1, "started_at": now, "completed_at": None, "failure_category": None, "failure_reason": None}
            job.setdefault("attempts", []).append(attempt)
            job.update({"status": "downloading", "stage": "downloading", "progress": PROGRESS["downloading"], "started_at": job.get("started_at") or now, "updated_at": now, "completed_at": None, "retryable": False, "failure_category": None, "failure_reason": None})
            self._write(rows)
            return _copy(job)

    def transition(self, import_id: str, status: str, **updates) -> dict:
        if status not in PROGRESS:
            raise ValueError("Unsupported import state.")
        with self.lock:
            rows = self._read()
            job = next((row for row in rows if row.get("import_id") == import_id), None)
            if not job:
                raise ImportRepositoryError("Import job was not found.")
            if job.get("status") not in ACTIVE_STATES:
                raise ImportRepositoryError("Import state cannot transition from its current state.")
            if status not in NEXT_STATES.get(job["status"], set()):
                raise ImportRepositoryError(f"Import state cannot transition from {job['status']} to {status}.")
            job.update(updates)
            job.update({"status": status, "stage": status, "progress": PROGRESS[status], "updated_at": _now()})
            if status == "ready":
                job["completed_at"] = _now()
                job["retryable"] = False
                if job.get("attempts"):
                    job["attempts"][-1]["completed_at"] = job["completed_at"]
            self._write(rows)
            return self.public_view(job)

    def attach_document(self, import_id: str, document_id: str, document_metadata: dict) -> dict:
        with self.lock:
            rows = self._read()
            job = next((row for row in rows if row.get("import_id") == import_id), None)
            if not job or job.get("status") not in ACTIVE_STATES:
                raise ImportRepositoryError("Import job is no longer active.")
            job.update({"document_id": document_id, "document_metadata": document_metadata, "updated_at": _now()})
            self._write(rows)
            return self.public_view(job)

    def attach_recovered_document(self, import_id: str, document_id: str) -> None:
        """Repair the crash window after manifest persistence and before job linkage."""
        with self.lock:
            rows = self._read()
            job = next((row for row in rows if row.get("import_id") == import_id), None)
            if not job or job.get("failure_category") != "interrupted":
                return
            job.update({"document_id": document_id, "updated_at": _now()})
            self._write(rows)

    def fail(self, import_id: str, *, category: str, reason: str, retryable: bool) -> dict | None:
        with self.lock:
            rows = self._read()
            job = next((row for row in rows if row.get("import_id") == import_id), None)
            if not job:
                return None
            if job.get("status") == "ready":
                return self.public_view(job)
            now = _now()
            job.update({"status": "failed", "stage": "failed", "progress": 0, "updated_at": now, "completed_at": now, "retryable": retryable, "failure_category": category[:80], "failure_reason": reason[:500]})
            if job.get("attempts"):
                job["attempts"][-1].update({"completed_at": now, "failure_category": category[:80], "failure_reason": reason[:500]})
            self._write(rows)
            return self.public_view(job)

    def retry(self, import_id: str) -> tuple[dict, bool]:
        with self.lock:
            rows = self._read()
            job = next((row for row in rows if row.get("import_id") == import_id), None)
            if not job:
                raise LookupError("Import job not found.")
            if job.get("status") in ACTIVE_STATES:
                return self.public_view(job), False
            if job.get("status") != "failed" or not job.get("retryable"):
                raise PermissionError("This import is not eligible for retry.")
            now = _now()
            job.update({"status": "pending", "stage": "pending", "progress": 0, "updated_at": now, "completed_at": None, "retryable": False, "failure_category": None, "failure_reason": None})
            self._write(rows)
            return self.public_view(job), True

    def recover_interrupted(self) -> list[dict]:
        recovered = []
        with self.lock:
            rows = self._read()
            now = _now()
            for job in rows:
                if job.get("status") not in ACTIVE_STATES:
                    continue
                reason = "Import was interrupted by a server restart. Retry is available."
                job.update({"status": "failed", "stage": "failed", "progress": 0, "updated_at": now, "completed_at": now, "retryable": True, "failure_category": "interrupted", "failure_reason": reason})
                if job.get("attempts"):
                    job["attempts"][-1].update({"completed_at": now, "failure_category": "interrupted", "failure_reason": reason})
                recovered.append(_copy(job))
            if recovered:
                self._write(rows)
        return recovered
