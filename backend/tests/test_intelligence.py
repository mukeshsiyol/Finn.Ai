import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from fastapi import HTTPException

from app.main import app
from app.services.intelligence.orchestrator import interpret_evidence
from app.services.intelligence import openai_service
from app.services.research import engine, documents


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
        with patch("app.main._company_universe", return_value={"companies": []}), patch("app.main._market_snapshot", return_value=snapshot), patch("app.main.fetch_portfolio_announcements", side_effect=RuntimeError("feed down")):
            response = self.client.post("/api/intelligence/briefing", json={"companies": [company]})
        self.assertEqual(response.status_code, 200)
        self.assertIn("briefing is incomplete", response.json()["answer"])
        self.assertIn("could not be checked", response.json()["answer"])
        self.assertEqual(response.json()["retention"], "request_not_persisted")

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
