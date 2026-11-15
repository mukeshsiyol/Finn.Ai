import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from fastapi import HTTPException

from app.main import app
from app.services.intelligence.orchestrator import interpret_evidence
from app.services.intelligence import openai_service
from app.services.research import engine, documents
from app.services.intelligence.briefing_store import latest_briefing, save_briefing


class IntelligenceOrchestratorTests(unittest.TestCase):
    def test_uses_deterministic_fallback_without_model(self):
        with patch("app.services.intelligence.orchestrator.ai_is_enabled", return_value=False):
            result = interpret_evidence(capability="market", task="Explain signal", facts=["Price moved 4.2%"], sources=[{"id": "M1", "excerpt": "Price moved 4.2%"}], fallback="Signal crossed.")
        self.assertEqual(result["mode"], "rule_based")
        self.assertEqual(result["answer"], "Signal crossed.")

    def test_withholds_answer_with_unknown_citation(self):
        with patch("app.services.intelligence.orchestrator.ai_is_enabled", return_value=True), patch("app.services.intelligence.orchestrator.generate_text", return_value="Price moved 4.2% [M2]."):
            result = interpret_evidence(capability="market", task="Explain signal", facts=["Price moved 4.2%"], sources=[{"id": "M1", "excerpt": "Price moved 4.2%"}], fallback="Deterministic signal.")
        self.assertEqual(result["mode"], "evidence_only")
        self.assertEqual(result["answer"], "Deterministic signal.")
        self.assertEqual(result["verification"]["failures"][0]["type"], "missing_source")

    def test_detects_unsupported_numeric_claim(self):
        with patch("app.services.intelligence.orchestrator.ai_is_enabled", return_value=True), patch("app.services.intelligence.orchestrator.generate_text", return_value="Price moved 8.4% [M1]."):
            result = interpret_evidence(capability="market", task="Explain signal", facts=["Price moved 4.2%"], sources=[{"id": "M1", "excerpt": "Price moved 4.2%"}], fallback="Deterministic signal.")
        self.assertEqual(result["mode"], "evidence_only")
        self.assertTrue(any("8.4" in failure["reason"] for failure in result["verification"]["failures"]))

    def test_research_engine_retries_uncited_sentence_and_verifies_page_source(self):
        record = next(item for item in documents._manifest() if item.get("filename") == "RELIANCE_Q2_FY27_Concall_Transcript.pdf")
        _, sources = documents.retrieve_pages(record["id"], "margin flow mix competitive dynamics", limit=5)
        self.assertTrue(sources)
        with patch("app.services.research.engine.generate_text", side_effect=["The comments may change company strategy.\nMargins vary by mix [S1].", "Margins vary by mix [S1]."]) as generate:
            answer, verification = engine.synthesize_research_answer("What did management say about margins?", sources)
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(answer, "Margins vary by mix [S1].")
        self.assertEqual(verification["status"], "verified")
        self.assertEqual(verification["attempts"], 2)

    def test_research_citation_rejects_wrong_period_metadata_and_page(self):
        record = next(item for item in documents._manifest() if item.get("filename") == "RELIANCE_Q2_FY27_Concall_Transcript.pdf")
        _, sources = documents.retrieve_pages(record["id"], "margin flow mix competitive dynamics", limit=1)
        self.assertTrue(sources)
        source = dict(sources[0])
        source["reporting_period"] = "FY1999"
        source["filename"] = "Wrong.pdf"
        result = engine.verify_generated_claims(f"Margins vary by mix on page 999 [S1].", [source])
        self.assertEqual(result["status"], "withheld")
        self.assertTrue(any(item["type"] == "source_mapping" for item in result["failures"]))
        self.assertTrue(any(item["type"] == "page_mapping" for item in result["failures"]))

    def test_research_provider_failure_returns_error_instead_of_fake_ai_answer(self):
        with patch("app.services.research.engine.generate_text", side_effect=RuntimeError("provider unavailable")):
            with self.assertRaises(HTTPException) as error:
                engine.synthesize_research_answer("Question", [{"id": "S1", "company": "Acme", "ticker": "ACME", "filename": "source.pdf", "document_type": "Annual report", "reporting_period": "FY2025", "page": 1, "excerpt": "Evidence."}])
        self.assertEqual(error.exception.status_code, 502)

    def test_openai_enabled_requires_key(self):
        with patch.dict("os.environ", {"FINN_LLM_PROVIDER": "openai"}, clear=True):
            self.assertFalse(openai_service.ai_is_enabled())


class IntelligenceEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_market_explanation_uses_server_snapshot_and_rejects_no_signal(self):
        snapshot = {"companies": [{"ticker": "TEST.NS", "name": "Test Ltd", "market_status": "available", "session_date": "2026-11-13", "checked_at": "2026-11-14T05:00:00+00:00", "source_name": "Yahoo Finance via yfinance", "change_pct": 4.2, "previous_close": 100, "price": 104.2, "volume_ratio_20d": 1.1, "price_threshold_pct": 4, "volume_threshold": 1.3, "unusual_price": True, "unusual_volume": False}]}
        with patch("app.main._portfolio_snapshot", return_value=snapshot), patch("app.main.ai_is_enabled", return_value=False):
            response = self.client.post("/api/market/explain", json={"ticker": "TEST.NS", "change_pct": 99, "volume_ratio_20d": 9})
        self.assertEqual(response.status_code, 200)
        self.assertIn("4.20%", response.json()["facts"][0])
        self.assertNotIn("99", " ".join(response.json()["facts"]))
        snapshot["companies"][0]["unusual_price"] = False
        with patch("app.main._portfolio_snapshot", return_value=snapshot):
            response = self.client.post("/api/market/explain", json={"ticker": "TEST.NS"})
        self.assertEqual(response.status_code, 409)

    def test_portfolio_request_is_not_persisted_and_requires_consistent_weights(self):
        payload = {"as_of_date": "2026-11-13", "priced_holding_count": 1, "total_holding_count": 1,
                   "metrics": {"market_value": 1000, "daily_pnl": -2, "unrealized_pnl": 10, "sector_count": 1},
                   "holdings": [{"ticker": "TEST.NS", "company": "Test Ltd", "sector": "Industrials", "weight_pct": 100, "daily_change_pct": -0.2, "session_date": "2026-11-13"}]}
        with patch("app.services.intelligence.orchestrator.ai_is_enabled", return_value=False):
            response = self.client.post("/api/intelligence/portfolio", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["retention"], "request_not_persisted")
        payload["holdings"][0]["weight_pct"] = 80
        self.assertEqual(self.client.post("/api/intelligence/portfolio", json=payload).status_code, 422)

    def test_empty_briefing_discloses_incomplete_market_coverage(self):
        company = {"ticker": "TEST.NS", "company": "Test Ltd", "sector": "Industrials"}
        snapshot = {"market_status": "unavailable", "name": "Test Ltd", "ticker": "TEST.NS"}
        with tempfile.TemporaryDirectory(dir="tmp") as directory, patch("app.main.BRIEFINGS_PATH", Path(directory) / "briefings.json"), patch("app.main._company_universe", return_value={"companies": []}), patch("app.main._portfolio_snapshot", return_value={"companies": []}), patch("app.main._market_snapshot", return_value=snapshot), patch("app.main.fetch_portfolio_announcements", side_effect=RuntimeError("feed down")), patch("app.main.interpret_evidence", return_value={"answer": "No qualifying event.", "mode": "evidence_only", "ai_generated": False, "verification": {"status": "not_applicable", "failures": [], "note": "No event."}}):
            response = self.client.post("/api/intelligence/briefing", json={"companies": [company]})
            saved = self.client.get("/api/intelligence/briefing", params={"tickers": "TEST.NS", "window_hours": 24})
        self.assertEqual(response.status_code, 200)
        self.assertIn("briefing is incomplete", response.json()["answer"])
        self.assertIn("could not be checked", response.json()["answer"])
        self.assertEqual(response.json()["retention"], "persisted")
        self.assertEqual(response.json()["providers"]["bse_filings"]["status"], "unavailable")
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.json()["exists"])
        self.assertEqual(saved.json()["briefing"]["briefing_id"], response.json()["briefing_id"])

    def test_briefing_persistence_filters_exact_company_set_and_window(self):
        with tempfile.TemporaryDirectory(dir="tmp") as directory:
            path = Path(directory) / "briefings.json"
            save_briefing(path, {"briefing_id": "one", "generated_at": "2026-11-15T10:00:00+05:30", "tracked_tickers": ["TITAN.NS", "RELIANCE.NS"], "window_hours": 24})
            self.assertEqual(latest_briefing(path, ["RELIANCE.NS", "TITAN.NS"], 24)["briefing_id"], "one")
            self.assertIsNone(latest_briefing(path, ["RELIANCE.NS"], 24))
            self.assertIsNone(latest_briefing(path, ["RELIANCE.NS", "TITAN.NS"], 48))

    def test_briefing_get_rejects_unresolved_ticker_shape(self):
        response = self.client.get("/api/intelligence/briefing", params={"tickers": "not-a-ticker"})
        self.assertEqual(response.status_code, 422)

    def test_briefing_saved_financials_require_value_in_cited_page_excerpt(self):
        from app.main import _briefing_financial_results
        evidence = {"document_id": "doc-1", "filename": "results.pdf", "page": 4, "excerpt": "Revenue of ₹1,000 crore and profit were reported."}
        report = {"periods": [{"period": "FY2027-Q2", "metrics": {
            "revenue": {"value": 1000, "unit": "₹ crore", "source": evidence, "qoq": {"status": "available", "change_pct": 2, "period": "FY2027-Q1"}, "yoy": {"status": "missing_data", "change_pct": None, "period": "FY2026-Q2"}},
            "pat": {"value": 250, "unit": "₹ crore", "source": {**evidence, "excerpt": "PAT was 245 crore."}, "qoq": {"status": "missing_data", "change_pct": None, "period": "FY2027-Q1"}, "yoy": {"status": "missing_data", "change_pct": None, "period": "FY2026-Q2"}},
        }}]}
        with patch("app.main.quarterly_comparisons", return_value=report):
            result = _briefing_financial_results([{"ticker": "RELIANCE.NS", "name": "Reliance Industries"}])
        self.assertEqual(list(result[0]["metrics"]), ["revenue"])
        self.assertEqual(result[0]["period"], "FY2027-Q2")
        self.assertEqual(result[0]["metrics"]["revenue"]["qoq"]["change_pct"], 2)

    def test_briefing_deduplicates_filings_and_keeps_source_provenance(self):
        company = {"ticker": "TEST.NS", "company": "Test Ltd", "sector": "Industrials"}
        row = {"id": "nse-1", "ticker": "TEST.NS", "company": "Test Ltd", "subject": "Quarterly financial results", "details": "Results for the quarter ended September.", "filed_at": "2026-11-15T09:00:00+05:30", "source_url": "https://www.nseindia.com/example.pdf", "source_name": "NSE filing"}
        snapshot = {"market_status": "unavailable", "name": "Test Ltd", "ticker": "TEST.NS"}
        with tempfile.TemporaryDirectory(dir="tmp") as directory, patch("app.main.BRIEFINGS_PATH", Path(directory) / "briefings.json"), patch("app.main._company_universe", return_value={"companies": []}), patch("app.main._portfolio_snapshot", return_value={"companies": []}), patch("app.main._market_snapshot", return_value=snapshot), patch("app.main.fetch_portfolio_announcements", return_value=[row, dict(row)]), patch("app.main._briefing_financial_results", return_value=[]), patch("app.main.interpret_evidence", return_value={"answer": "One filing was reviewed.", "mode": "evidence_only", "ai_generated": False, "verification": {"status": "not_applicable", "failures": [], "note": "Rule-based."}}):
            response = self.client.post("/api/intelligence/briefing", json={"companies": [company]})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["coverage"]["announcements_reviewed"], 1)
        self.assertEqual(len(data["developments"]), 1)
        self.assertEqual(data["developments"][0]["category"], "results")
        self.assertEqual(data["developments"][0]["source_verification"], "verified")
        self.assertEqual(data["developments"][0]["source_url"], row["source_url"])

    def test_briefing_reuses_existing_portfolio_market_snapshot(self):
        from app.main import _briefing_market_rows
        company = {"ticker": "TEST.NS", "company": "Test Ltd", "sector": "Industrials"}
        cached = {"ticker": "TEST.NS", "name": "Test Ltd", "market_status": "available", "checked_at": "2026-11-15T10:00:00+00:00", "session_date": "2026-11-13", "price": 100, "previous_close": 100, "change_pct": 0, "volume_ratio_20d": 1, "unusual_price": False, "unusual_volume": False}
        with patch("app.main._market_snapshot", side_effect=AssertionError("cached quote should be reused")) as market_snapshot:
            rows = _briefing_market_rows([company], [cached], {"volume_multiple": 1.3, "price_move_pct": 4})
        self.assertEqual(rows, [cached])
        market_snapshot.assert_not_called()

    def test_company_comparison_requires_exact_shared_period_and_units(self):
        def reports(ticker, *_args):
            unit = "₹ crore" if ticker == "ONE.NS" else "₹ crore"
            return {"periods": [{"period": "FY2026-Q1", "metrics": {"revenue": {"value": 120 if ticker == "ONE.NS" else 90, "unit": unit, "source": {"filename": f"{ticker}.pdf", "document_id": "doc-1" if ticker == "ONE.NS" else "doc-2", "page": 4, "excerpt": "Revenue reported for the quarter."}}}}]}
        with patch("app.main.quarterly_comparisons", side_effect=reports), patch("app.main.list_documents", return_value=[]), patch("app.services.intelligence.orchestrator.ai_is_enabled", return_value=False):
            response = self.client.post("/api/research/compare", json={"tickers": ["ONE.NS", "TWO.NS"], "statement_basis": "consolidated", "figure_type": "reported"})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["comparisons"][0]["period"], "FY2026-Q1")
        self.assertEqual([row["value"] for row in result["comparisons"][0]["metrics"][0]["values"]], [120, 90])
        self.assertEqual(len(result["sources"]), 2)

    def test_comparison_rejects_companies_without_shared_period(self):
        with patch("app.main.quarterly_comparisons", side_effect=[{"periods": [{"period": "FY2026-Q1", "metrics": {}}]}, {"periods": [{"period": "FY2025-Q4", "metrics": {}}]}]):
            response = self.client.post("/api/research/compare", json={"tickers": ["ONE.NS", "TWO.NS"]})
        self.assertEqual(response.status_code, 422)

    def test_ask_finn_uses_retrieved_evidence_and_returns_verified_citation(self):
        record = next(item for item in documents._manifest() if item.get("filename") == "RELIANCE_Q2_FY27_Concall_Transcript.pdf")
        with patch("app.services.research.engine.generate_text", return_value="Margins vary by mix [S1]."):
            response = self.client.post("/api/research/query", json={"document_id": record["id"], "question": "What did management say about margins?"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "ai_grounded")
        self.assertEqual(payload["verification"]["status"], "verified")
        self.assertEqual(payload["cited_source_ids"], ["S1"])
        self.assertEqual(payload["sources"][0]["document_id"], record["id"])
        self.assertEqual(payload["sources"][0]["filename"], record["filename"])


if __name__ == "__main__":
    unittest.main()
