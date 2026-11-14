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
        def retrieve(doc_id, question, limit):
            pages = {"doc-a": [9, 6, 3, 1], "doc-b": [8, 4, 2, 1]}[doc_id]
            record = next(item for item in self.records if item["id"] == doc_id)
            sources = [
                {
                    "id": "S1",
                    "document_id": doc_id,
                    "filename": record["filename"],
                    "document_type": record["document_type"],
                    "reporting_period": record["reporting_period"],
                    "page": index + 1,
                    "relevance": score,
                    "excerpt": f"Evidence for page {index + 1}",
                }
                for index, score in enumerate(pages[:limit])
            ]
            return record, sources

        with patch.object(documents, "_manifest", return_value=self.records), patch.object(documents, "retrieve_pages", side_effect=retrieve):
            company, sources = documents.retrieve_ticker_pages("ACME.NS", "revenue", limit=8)

        self.assertEqual(company["ticker"], "ACME")
        self.assertEqual(company["document_count"], 2)
        self.assertLessEqual(len(sources), 8)
        self.assertEqual(len({source["id"] for source in sources}), len(sources))
        self.assertEqual({source["document_id"] for source in sources}, {"doc-a", "doc-b"})
        self.assertTrue(all(source["page"] > 0 for source in sources))
        self.assertLessEqual(max(sum(source["document_id"] == doc_id for source in sources) for doc_id in ("doc-a", "doc-b")), 3)

    def test_raises_when_company_has_no_indexed_sources(self):
        with patch.object(documents, "_manifest", return_value=[]):
            with self.assertRaises(HTTPException) as error:
                documents.retrieve_ticker_pages("ACME", "revenue")
        self.assertEqual(error.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
