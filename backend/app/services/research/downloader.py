"""Streaming PDF download with public-IP pinning and hostname-verified TLS."""

from __future__ import annotations

import hashlib
import http.client
import ipaddress
import os
import socket
import ssl
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlsplit

from app.services.discovery.source_policy import SourcePolicyError, validate_redirect_url


class DownloadFailure(RuntimeError):
    def __init__(self, message: str, *, category: str, retryable: bool, auto_retry: bool = False):
        super().__init__(message)
        self.category = category
        self.retryable = retryable
        self.auto_retry = auto_retry


@dataclass(frozen=True)
class DownloadedFile:
    path: Path
    size_bytes: int
    sha256: str
    content_type: str
    final_url: str


@dataclass
class _PinnedResponse:
    response: http.client.HTTPResponse
    connection: http.client.HTTPSConnection

    @property
    def status(self) -> int:
        return self.response.status

    @property
    def headers(self):
        return self.response.headers

    def read(self, size: int) -> bytes:
        return self.response.read(size)

    def close(self) -> None:
        try:
            self.response.close()
        finally:
            self.connection.close()


def resolve_public_addresses(host: str) -> tuple[str, ...]:
    try:
        literal = ipaddress.ip_address(host)
        addresses = [literal]
    except ValueError:
        try:
            records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            addresses = [ipaddress.ip_address(record[4][0]) for record in records]
        except (OSError, ValueError) as exc:
            raise DownloadFailure("The approved source host could not be resolved.", category="dns", retryable=True, auto_retry=True) from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise SourcePolicyError("The document host resolves to a private or non-public network address.")
    # De-duplicate while keeping the resolver's address preference order.
    return tuple(dict.fromkeys(str(address) for address in addresses))


def _pinned_https_get(host: str, address: str, request_target: str, *, connect_timeout: float, read_timeout: float) -> _PinnedResponse:
    """Connect to the already validated IP; verify TLS against the original host."""
    raw_socket = socket.create_connection((address, 443), timeout=connect_timeout)
    try:
        raw_socket.settimeout(read_timeout)
        tls_socket = ssl.create_default_context().wrap_socket(raw_socket, server_hostname=host)
    except Exception:
        raw_socket.close()
        raise
    connection = http.client.HTTPSConnection(host, 443, timeout=read_timeout)
    connection.sock = tls_socket
    try:
        connection.request(
            "GET",
            request_target,
            headers={
                "Host": host,
                "User-Agent": "FINN.AI selected document importer/1.0",
                "Accept": "application/pdf, application/octet-stream",
                "Accept-Encoding": "identity",
                "Connection": "close",
            },
        )
        return _PinnedResponse(connection.getresponse(), connection)
    except Exception:
        connection.close()
        raise


class SecureDocumentDownloader:
    def __init__(
        self,
        *,
        resolver: Callable[[str], tuple[str, ...]] = resolve_public_addresses,
        request: Callable = _pinned_https_get,
        max_bytes: int = 45 * 1024 * 1024,
        connect_timeout: float = 5.0,
        read_timeout: float = 20.0,
        max_redirects: int = 3,
        retries: int = 1,
    ) -> None:
        self.resolver = resolver
        self.request = request
        self.max_bytes = max_bytes
        self.connect_timeout = connect_timeout
        self.read_timeout = read_timeout
        self.max_redirects = max_redirects
        self.retries = retries

    def download(self, url: str, destination: Path, *, allowed_domains: tuple[str, ...]) -> DownloadedFile:
        if destination.exists():
            destination.unlink()
        for attempt in range(self.retries + 1):
            try:
                return self._download_once(url, destination, allowed_domains)
            except DownloadFailure as exc:
                destination.unlink(missing_ok=True)
                if not exc.auto_retry or attempt >= self.retries:
                    raise
                time.sleep(0.2)
            except (TimeoutError, socket.timeout, OSError, http.client.HTTPException) as exc:
                destination.unlink(missing_ok=True)
                if attempt >= self.retries:
                    raise DownloadFailure("The source connection failed after a bounded retry.", category="network", retryable=True) from exc
                time.sleep(0.2)
            except Exception:
                destination.unlink(missing_ok=True)
                raise
        raise DownloadFailure("The source download did not complete.", category="network", retryable=True)

    def _download_once(self, url: str, destination: Path, allowed_domains: tuple[str, ...]) -> DownloadedFile:
        current = url
        for redirect_count in range(self.max_redirects + 1):
            host, path, query = validate_redirect_url(current, allowed_domains)
            addresses = self.resolver(host)  # Re-resolve and revalidate every redirect.
            request_target = path + (f"?{query}" if query else "")
            response = self._request_any_address(host, addresses, request_target)
            try:
                status = response.status
                if status in {301, 302, 303, 307, 308}:
                    location = response.headers.get("Location")
                    if not location or redirect_count >= self.max_redirects:
                        raise DownloadFailure("The source returned an invalid or excessive redirect.", category="redirect", retryable=False)
                    current = urljoin(current, location)
                    # The next loop validates the new hostname before resolving or connecting.
                    continue
                if status == 429:
                    raise DownloadFailure("The source rate-limited the import; retry later.", category="rate_limited", retryable=True)
                if status in {403, 404}:
                    raise DownloadFailure(f"The source returned HTTP {status}.", category="source_not_found" if status == 404 else "source_forbidden", retryable=False)
                if status >= 500:
                    raise DownloadFailure(f"The source returned HTTP {status}.", category="source_error", retryable=True, auto_retry=True)
                if status != 200:
                    raise DownloadFailure(f"The source returned unexpected HTTP {status}.", category="source_error", retryable=False)

                content_type = str(response.headers.get("Content-Type", "")).split(";", 1)[0].strip().lower()
                if content_type not in {"application/pdf", "application/octet-stream", "binary/octet-stream"}:
                    raise DownloadFailure("The selected URL did not return a supported PDF response.", category="content_type", retryable=False)
                length = response.headers.get("Content-Length")
                if length:
                    try:
                        declared_size = int(length)
                    except (TypeError, ValueError) as exc:
                        raise DownloadFailure("The source returned an invalid content length.", category="invalid_response", retryable=False) from exc
                    if declared_size < 1 or declared_size > self.max_bytes:
                        raise DownloadFailure("The selected PDF is empty or exceeds the configured size limit.", category="size_limit", retryable=False)

                destination.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                total = 0
                with destination.open("xb") as stream:
                    while True:
                        chunk = response.read(64 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > self.max_bytes:
                            raise DownloadFailure("The selected PDF exceeds the configured size limit.", category="size_limit", retryable=False)
                        stream.write(chunk)
                        digest.update(chunk)
                    stream.flush()
                    os.fsync(stream.fileno())
                if total == 0:
                    raise DownloadFailure("The source returned an empty file.", category="empty_file", retryable=False)
                return DownloadedFile(destination, total, digest.hexdigest(), content_type, current)
            finally:
                response.close()
        raise DownloadFailure("The source redirect limit was exceeded.", category="redirect", retryable=False)

    def _request_any_address(self, host: str, addresses: tuple[str, ...], target: str):
        errors = []
        for address in addresses[:8]:
            try:
                return self.request(host, address, target, connect_timeout=self.connect_timeout, read_timeout=self.read_timeout)
            except ssl.SSLCertVerificationError as exc:
                raise DownloadFailure("TLS certificate validation failed for the approved source host.", category="tls", retryable=False) from exc
            except (TimeoutError, socket.timeout, OSError, http.client.HTTPException) as exc:
                errors.append(exc)
        if errors:
            raise DownloadFailure("The approved source host could not be reached.", category="network", retryable=True, auto_retry=True) from errors[-1]
        raise DownloadFailure("The approved source host has no usable public address.", category="dns", retryable=True, auto_retry=True)
