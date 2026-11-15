from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from app.services.announcements import nse_client


class FakeResponse:
    def __init__(self, payload=None):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.headers = {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, *_args, **_kwargs):
        return next(self.responses)


def test_nse_announcement_preserves_listing_and_document_source_urls():
    filed_at = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d-%b-%Y %H:%M:%S")
    payload = [{
        "symbol": "RELIANCE", "seq_id": "seq-123", "subject": "Quarterly financial results",
        "details": "Results for quarter ended.", "dt": filed_at,
        "attchmntFile": "/corporate/filing.pdf",
    }]
    fake = FakeSession([FakeResponse([]), FakeResponse(payload)])
    with patch.object(nse_client.requests, "Session", return_value=fake):
        rows = nse_client.fetch_portfolio_announcements([{"ticker": "RELIANCE.NS", "name": "Reliance Industries"}], 24)
    assert len(rows) == 1
    assert rows[0]["id"] == "seq-123"
    assert rows[0]["source_page_url"] == nse_client.ANNOUNCEMENTS_PAGE
    assert rows[0]["document_url"] == "https://www.nseindia.com/corporate/filing.pdf"
    assert rows[0]["source_url"] == rows[0]["document_url"]
