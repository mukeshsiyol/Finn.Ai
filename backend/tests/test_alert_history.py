import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app import main


class AlertHistoryTests(unittest.TestCase):
    def test_window_uses_inclusive_utc_bounds_and_excludes_future(self):
        now = datetime(2026, 11, 15, 12, tzinfo=timezone.utc)
        rows = [
            {"id": "edge", "event_at": "2026-11-14T12:00:00Z"},
            {"id": "current", "event_at": "2026-11-15T11:59:59+00:00"},
            {"id": "future", "event_at": "2026-11-15T12:00:01Z"},
            {"id": "bad", "event_at": "not-a-date"},
        ]
        self.assertEqual([row["id"] for row in main._alerts_in_window(rows, 24, now)], ["current", "edge"])

    def test_summary_counts_categories_priority_unread_and_ist_days(self):
        now = datetime(2026, 11, 15, 12, tzinfo=timezone.utc)
        rows = [
            {"id": "filing", "kind": "filing", "priority": "high", "is_read": False, "event_at": "2026-11-15T16:00:00+05:30"},
            {"id": "price", "kind": "market", "signal_type": "price_movement", "priority": "high", "is_read": True, "event_at": "2026-11-14T15:30:00+05:30"},
            {"id": "volume", "kind": "market", "signal_type": "volume_spike", "priority": "medium", "is_read": False, "event_at": "2026-11-13T15:30:00+05:30"},
        ]
        summary = main._alert_summary(rows, 72, now)
        self.assertEqual((summary["total"], summary["unread"], summary["high_priority"]), (3, 2, 2))
        self.assertEqual(summary["category_counts"], {"filings": 1, "price_movement": 1, "volume_spike": 1})
        self.assertEqual(len(summary["trend_7d_ist"]), 7)
        days = {item["date"]: item["count"] for item in summary["trend_7d_ist"]}
        self.assertEqual(days["2026-11-13"], 1)
        self.assertEqual(days["2026-11-14"], 1)

    def test_upsert_is_idempotent_and_preserves_read_state(self):
        with tempfile.TemporaryDirectory(dir="tmp") as directory:
            path = Path(directory) / "alerts.json"
            original = {"id": "market-a", "event_at": "2026-11-15T10:00:00Z", "is_read": True, "first_seen_at": "first"}
            path.write_text('[{"id":"market-a","event_at":"2026-11-15T10:00:00Z","is_read":true,"first_seen_at":"first"}]', encoding="utf-8")
            with patch.object(main, "ALERT_HISTORY_PATH", path):
                main._upsert_alert_history([{**original, "is_read": False, "price": 42}, {"id": "market-a", "event_at": original["event_at"], "is_read": False}])
                stored = main._read_alert_history()
            self.assertEqual(len(stored), 1)
            self.assertTrue(stored[0]["is_read"])
            self.assertEqual(stored[0]["first_seen_at"], "first")

    def test_history_api_counts_and_read_state_share_persisted_rows(self):
        with tempfile.TemporaryDirectory(dir="tmp") as directory:
            path = Path(directory) / "alerts.json"
            path.write_text('[{"id":"old","kind":"market","signal_type":"volume_spike","priority":"medium","event_at":"2026-11-13T15:30:00+05:30","is_read":false},{"id":"today","kind":"filing","priority":"high","event_at":"2026-11-15T10:00:00Z","is_read":false}]', encoding="utf-8")
            with patch.object(main, "ALERT_HISTORY_PATH", path), patch("app.main.datetime") as mocked_datetime:
                mocked_datetime.now.return_value = datetime(2026, 11, 15, 12, tzinfo=timezone.utc)
                mocked_datetime.fromisoformat = datetime.fromisoformat
                mocked_datetime.min = datetime.min
                mocked_datetime.max = datetime.max
                mocked_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)
                payload = main.alert_history(24)
            self.assertEqual([row["id"] for row in payload["alerts"]], ["today"])
            self.assertEqual(payload["total_count"], 1)
            self.assertEqual(payload["unread_count"], 1)
            self.assertEqual(payload["all_unread_count"], 2)
            with patch.object(main, "ALERT_HISTORY_PATH", path):
                updated = main.update_alert_read_status(main.AlertReadUpdate(id="today", is_read=True))
            self.assertTrue(updated["is_read"])

    def test_volume_ratio_uses_exactly_prior_20_completed_sessions(self):
        import pandas as pd
        import numpy as np
        dates = pd.date_range("2026-10-01", periods=21, freq="B", tz="America/New_York")
        frame = pd.DataFrame({"Close": [100.0] * 20 + [110.0], "Volume": [1000] * 20 + [1300]}, index=dates)
        ticker = type("Ticker", (), {"history": lambda self, **kwargs: frame})()
        with patch.object(main.yf, "Ticker", return_value=ticker), patch.object(main, "_get_settings", return_value={"volume_multiple": 1.3, "price_move_pct": 4.0}):
            result = main._market_snapshot({"ticker": "TEST.NS", "name": "Test", "sector": "Test"}, {"volume_multiple": 1.3, "price_move_pct": 4.0})
        self.assertEqual(result["volume_ratio_20d"], 1.3)
        self.assertTrue(result["unusual_volume"])
        self.assertEqual(result["change_pct"], 10.0)
        self.assertTrue(result["unusual_price"])

    def test_portfolio_refresh_generates_and_persists_threshold_event(self):
        company = {"name": "Test Co", "ticker": "TEST.NS", "sector": "Test"}
        quote = {**company, "market_status": "available", "session_date": "2026-11-13", "price": 110.0, "previous_close": 100.0, "change_pct": 10.0, "volume": 1300, "average_volume_20d": 1000, "volume_ratio_20d": 1.3, "price_threshold_pct": 5.0, "volume_threshold": 1.2, "unusual_price": True, "unusual_volume": False}
        with tempfile.TemporaryDirectory(dir="tmp") as directory:
            path = Path(directory) / "alerts.json"
            with patch.object(main, "ALERT_HISTORY_PATH", path), patch.object(main, "_company_universe", return_value={"companies": [company], "notice": None}), patch.object(main, "_get_settings", return_value={"volume_multiple": 1.2, "price_move_pct": 5.0}), patch.object(main, "_market_snapshot", return_value=quote), patch.object(main, "_snapshot_cache", {"expires_at": 0.0, "payload": None}):
                snapshot = main._portfolio_snapshot(force=True)
                persisted = main._read_alert_history()
            self.assertEqual(snapshot["alert_count"], 1)
            self.assertEqual(len(persisted), 1)
            self.assertEqual(persisted[0]["signal_type"], "price_movement")
            self.assertEqual(persisted[0]["price_threshold_pct"], 5.0)


if __name__ == "__main__":
    unittest.main()
