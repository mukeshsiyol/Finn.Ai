import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.services.research import documents


class CompanyScopeRetrievalTests(unittest.TestCase):
    def setUp(self):
        self.records = [
            {"id": "doc-a", "ticker": "ACME", "company": "Acme Ltd", "filename": "annual.pdf", "document_type": "Annual report", "reporting_period": "FY2025", "indexing_status": "indexed"},
            {"id": "doc-b", "ticker": "ACME.NS", "company": "Acme Ltd", "filename": "results.pdf", "document_type": "Results", "reporting_period": "Q1 FY2026", "indexing_status": "indexed"},
            {"id": "doc-old", "ticker": "ACME", "superseded_by": "doc-b", "indexing_status": "indexed"},
            {"id": "doc-pending", "ticker": "ACME", "indexing_status": "processing"},
            {"id": "other", "ticker": "OTHER", "indexing_status": "indexed"},
        ]

    def test_merges_indexed_company_sources_with_unique_citations(self):
        def pages_for(record):
            if record["id"] == "doc-a":
                return [(1, "Revenue and EBITDA improved during FY2025. Margin expanded.", ""), (2, "Operations and risk discussion.", "")]
            return [(1, "Quarterly revenue and EBITDA improved. Margin remained stable.", ""), (2, "Operations and risk discussion.", "")]

        with patch.object(documents, "_manifest", return_value=self.records), patch.object(documents, "_load_document_pages", side_effect=pages_for):
            company, sources = documents.retrieve_ticker_pages("ACME.NS", "revenue EBITDA margin", limit=8)

        self.assertEqual(company["ticker"], "ACME")
        self.assertEqual(company["document_count"], 2)
        self.assertLessEqual(len(sources), 8)
        self.assertEqual(len({source["id"] for source in sources}), len(sources))
        self.assertEqual({source["document_id"] for source in sources}, {"doc-a", "doc-b"})
        self.assertTrue(all(source["page"] > 0 for source in sources))
        self.assertLessEqual(max(sum(source["document_id"] == doc_id for source in sources) for doc_id in ("doc-a", "doc-b")), 3)
        self.assertEqual({source["reporting_period"] for source in sources}, {"FY2025", "Q1 FY2026"})
        self.assertTrue(all(source["company"] == "Acme Ltd" for source in sources))

    def test_rejects_ambiguous_ticker_to_company_mapping(self):
        conflicting = [
            {**self.records[0], "company": "Acme Ltd"},
            {**self.records[1], "company": "Other Holdings Ltd"},
        ]
        with patch.object(documents, "_manifest", return_value=conflicting):
            with self.assertRaises(HTTPException) as error:
                documents.retrieve_ticker_pages("ACME.NS", "revenue")
        self.assertEqual(error.exception.status_code, 409)

    def test_reporting_period_metadata_guides_company_wide_retrieval(self):
        def pages_for(_record):
            return [(1, "Revenue and margin improved during the reported quarter.", "")]

        with patch.object(documents, "_manifest", return_value=self.records), patch.object(documents, "_load_document_pages", side_effect=pages_for):
            _, sources = documents.retrieve_ticker_pages("ACME.NS", "FY2025 revenue", limit=4)
        self.assertTrue(sources)
        self.assertEqual(sources[0]["document_id"], "doc-a")
        self.assertEqual(sources[0]["reporting_period"], "FY2025")

    def test_raises_when_company_has_no_indexed_sources(self):
        with patch.object(documents, "_manifest", return_value=[]):
            with self.assertRaises(HTTPException) as error:
                documents.retrieve_ticker_pages("ACME", "revenue")
        self.assertEqual(error.exception.status_code, 404)

    def test_real_concall_extraction_keeps_exact_pdf_page_and_period(self):
        record = next(item for item in documents._manifest() if item.get("filename") == "RELIANCE_Q2_FY27_Concall_Transcript.pdf")
        pages = documents._load_document_pages(record)
        self.assertEqual([item[0] for item in pages], list(range(1, len(pages) + 1)))
        company, sources = documents.retrieve_pages(record["id"], "margin flow mix competitive dynamics", limit=5)
        self.assertEqual(company["id"], record["id"])
        self.assertTrue(sources)
        self.assertTrue(all(source["document_id"] == record["id"] for source in sources))
        self.assertTrue(all(source["filename"] == record["filename"] for source in sources))
        self.assertTrue(all(source["reporting_period"] == record["reporting_period"] for source in sources))
        self.assertTrue(all(1 <= source["page"] <= len(pages) for source in sources))
        self.assertIn("margin", sources[0]["excerpt"].lower())

    def test_layout_gaps_are_preserved_as_table_columns(self):
        class LayoutPage:
            def extract_text(self, extraction_mode=None):
                return "Quarter        Revenue        EBITDA\nQ1              10,000         1,200\nRevenue increased from 10% to 12% while margins improved."

        narrative, tables = documents._extract_page_content(LayoutPage())
        self.assertIn("Revenue increased", narrative)
        self.assertIn("Quarter | Revenue | EBITDA", tables)
        self.assertIn("10,000 | 1,200", tables)


if __name__ == "__main__":
    unittest.main()
