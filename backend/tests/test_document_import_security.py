import http.client
import socket
import ssl
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.services.discovery.schema import DiscoveryCandidate, DocumentType, VerificationStatus
from app.services.discovery.source_policy import SourcePolicyError, approved_document_domains
from app.services.research.downloader import DownloadFailure, SecureDocumentDownloader, _pinned_https_get, resolve_public_addresses


PDF_BODY = b"%PDF-1.4\nfixture bytes\n%%EOF\n"
DOC_HOST = "rilstaticasset.akamaized.net"
ALLOWED = (DOC_HOST,)
PDF_URL = f"https://{DOC_HOST}/2026-11/report.pdf"


def candidate(document_url=PDF_URL):
    return DiscoveryCandidate(
        issuer_id="RELIANCE.NS", document_type=DocumentType.ANNUAL_REPORT,
        reporting_period="FY2025-26", title="Annual report", source_page_url="https://www.ril.com/investors/financial-reporting",
        document_url=document_url, source_provider="ir", verification_status=VerificationStatus.VERIFIED,
    )


class FakeResponse:
    def __init__(self, status=200, body=PDF_BODY, headers=None, read_error=None):
        self.status = status
        self._body = body
        self._position = 0
        self.headers = {"Content-Type": "application/pdf", "Content-Length": str(len(body)), **(headers or {})}
        self.read_error = read_error
        self.closed = False

    def read(self, size):
        if self.read_error:
            error, self.read_error = self.read_error, None
            raise error
        data = self._body[self._position:self._position + size]
        self._position += len(data)
        return data

    def close(self):
        self.closed = True


class QueueTransport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, host, address, target, **kwargs):
        self.calls.append((host, address, target))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_import_policy_approves_registry_ir_and_rejects_untrusted_urls():
    assert DOC_HOST in approved_document_domains(candidate())
    bse = DiscoveryCandidate(
        issuer_id="RELIANCE.NS", document_type=DocumentType.ANNUAL_REPORT,
        reporting_period="FY2025-26", title="Annual report", source_page_url="https://www.bseindia.com/",
        document_url="https://www.bseindia.com/report.pdf", source_provider="bse",
        verification_status=VerificationStatus.VERIFIED,
    )
    assert approved_document_domains(bse) == ("bseindia.com",)
    unverified = candidate().model_copy(update={"verification_status": VerificationStatus.UNVERIFIED})
    with pytest.raises(SourcePolicyError):
        approved_document_domains(unverified)
    with pytest.raises((SourcePolicyError, ValidationError)):
        approved_document_domains(candidate("http://rilstaticasset.akamaized.net/report.pdf"))
    with pytest.raises(SourcePolicyError):
        approved_document_domains(candidate("https://evil.example/report.pdf"))
    with pytest.raises(SourcePolicyError):
        approved_document_domains(candidate(f"https://{DOC_HOST}:8443/report.pdf"))
    with pytest.raises((SourcePolicyError, ValidationError)):
        approved_document_domains(candidate(f"https://user@{DOC_HOST}/report.pdf"))


def test_approved_pdf_is_streamed_and_hashed(tmp_path):
    transport = QueueTransport(FakeResponse())
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=transport)
    result = downloader.download(PDF_URL, tmp_path / "selected.part", allowed_domains=ALLOWED)
    assert result.path.read_bytes() == PDF_BODY
    assert result.sha256
    assert result.size_bytes == len(PDF_BODY)
    assert result.content_type == "application/pdf"
    assert transport.calls == [(DOC_HOST, "93.184.216.34", "/2026-11/report.pdf")]


def test_redirect_to_unapproved_domain_or_private_ip_is_rejected(tmp_path):
    transport = QueueTransport(FakeResponse(302, b"", {"Location": "https://evil.example/report.pdf"}))
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=transport)
    with pytest.raises(SourcePolicyError):
        downloader.download(PDF_URL, tmp_path / "redirect.part", allowed_domains=ALLOWED)
    private = QueueTransport(FakeResponse(302, b"", {"Location": "https://127.0.0.1/report.pdf"}))
    with pytest.raises(SourcePolicyError):
        SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=private).download(PDF_URL, tmp_path / "private.part", allowed_domains=ALLOWED)


def test_private_dns_result_is_rejected_and_redirect_count_is_bounded(tmp_path):
    with pytest.raises(SourcePolicyError):
        resolve_public_addresses("127.0.0.1")
    redirect = lambda: FakeResponse(302, b"", {"Location": f"https://{DOC_HOST}/next.pdf"})
    transport = QueueTransport(redirect(), redirect(), redirect())
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=transport, max_redirects=2, retries=0)
    with pytest.raises(DownloadFailure, match="redirect"):
        downloader.download(PDF_URL, tmp_path / "loops.part", allowed_domains=ALLOWED)
    assert len(transport.calls) == 3


@pytest.mark.parametrize("code,retryable", [(403, False), (404, False), (429, True)])
def test_source_status_failures_are_classified(tmp_path, code, retryable):
    transport = QueueTransport(FakeResponse(code, b"", {"Content-Length": "0"}))
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=transport)
    with pytest.raises(DownloadFailure) as error:
        downloader.download(PDF_URL, tmp_path / "status.part", allowed_domains=ALLOWED)
    assert error.value.retryable is retryable
    assert len(transport.calls) == 1


def test_server_error_and_interrupted_stream_retry_once(tmp_path):
    transport = QueueTransport(FakeResponse(500, b""), FakeResponse())
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=transport)
    assert downloader.download(PDF_URL, tmp_path / "server.part", allowed_domains=ALLOWED).size_bytes == len(PDF_BODY)
    broken = FakeResponse(body=PDF_BODY, read_error=OSError("connection reset"))
    stream_transport = QueueTransport(broken, FakeResponse())
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=stream_transport)
    assert downloader.download(PDF_URL, tmp_path / "stream.part", allowed_domains=ALLOWED).size_bytes == len(PDF_BODY)
    assert broken.closed
    assert len(stream_transport.calls) == 2


def test_timeout_and_oversized_download_are_bounded(tmp_path):
    timeout = QueueTransport(TimeoutError("fixture"), TimeoutError("fixture"))
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=timeout)
    with pytest.raises(DownloadFailure) as error:
        downloader.download(PDF_URL, tmp_path / "timeout.part", allowed_domains=ALLOWED)
    assert error.value.retryable
    assert len(timeout.calls) == 2
    oversized = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=QueueTransport(FakeResponse()), max_bytes=3)
    with pytest.raises(DownloadFailure, match="size limit"):
        oversized.download(PDF_URL, tmp_path / "large.part", allowed_domains=ALLOWED)
    assert not (tmp_path / "large.part").exists()


def test_html_error_and_unsupported_content_type_are_rejected(tmp_path):
    response = FakeResponse(body=b"<html>not a PDF</html>", headers={"Content-Type": "text/html"})
    downloader = SecureDocumentDownloader(resolver=lambda host: ("93.184.216.34",), request=QueueTransport(response))
    with pytest.raises(DownloadFailure, match="supported PDF"):
        downloader.download(PDF_URL, tmp_path / "html.part", allowed_domains=ALLOWED)
    assert response.closed
    assert not (tmp_path / "html.part").exists()


def test_tls_request_uses_pinned_ip_and_original_hostname():
    class Sock:
        def settimeout(self, value): pass
        def close(self): pass

    class Context:
        def wrap_socket(self, raw, *, server_hostname):
            seen["server_hostname"] = server_hostname
            return raw

    class Connection:
        def __init__(self, host, port, timeout):
            self.sock = None
        def request(self, method, target, headers):
            seen["request"] = (method, target, headers)
        def getresponse(self):
            return FakeResponse()
        def close(self): pass

    seen = {}
    def connect(address, timeout):
        seen["connected_ip"] = address[0]
        return Sock()

    with patch("app.services.research.downloader.socket.create_connection", side_effect=connect), \
         patch("app.services.research.downloader.ssl.create_default_context", return_value=Context()), \
         patch("app.services.research.downloader.http.client.HTTPSConnection", Connection):
        _pinned_https_get(DOC_HOST, "93.184.216.34", "/report.pdf", connect_timeout=3, read_timeout=5)
    assert seen["connected_ip"] == "93.184.216.34"
    assert seen["server_hostname"] == DOC_HOST
    assert seen["request"][0:2] == ("GET", "/report.pdf")
