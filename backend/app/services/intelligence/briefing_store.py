"""Atomic persistence for generated Home briefing snapshots."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any

_LOCK = Lock()


def _read(path: Path) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_briefing(path: Path, briefing: dict[str, Any], *, limit: int = 120) -> dict[str, Any]:
    """Store a complete generated report without exposing half-written JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        rows = _read(path)
        rows = [row for row in rows if row.get("briefing_id") != briefing.get("briefing_id")]
        rows.append(briefing)
        rows.sort(key=lambda row: str(row.get("generated_at", "")), reverse=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(rows[:limit], ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
    return briefing


def latest_briefing(path: Path, tickers: list[str], window_hours: int) -> dict[str, Any] | None:
    wanted = tuple(sorted({ticker.strip().upper() for ticker in tickers if ticker.strip()}))
    if not wanted:
        return None
    rows = _read(path)
    for row in sorted(rows, key=lambda item: str(item.get("generated_at", "")), reverse=True):
        saved_tickers = tuple(sorted({str(ticker).upper() for ticker in row.get("tracked_tickers", [])}))
        if saved_tickers == wanted and row.get("window_hours") == window_hours:
            return row
    return None
