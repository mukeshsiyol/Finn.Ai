"""Bounded, HTTPS-only access to allowlisted public source pages."""

from __future__ import annotations

import ipaddress
import socket
import time
from dataclasses import dataclass
from threading import Lock
from typing import Callable
from urllib.parse import urljoin, urlsplit

from curl_cffi import requests


class OfficialSourceError(RuntimeError):
    pass


class OfficialSourceTimeout(TimeoutError):
    pass


class OfficialSourceRateLimited(OfficialSourceError):
    pass


class OfficialSourceUnavailable(OfficialSourceError):
    pass


class UnsafeSourceUrl(OfficialSourceError):
    pass


@dataclass(frozen=True)
class PageResponse:
    url: str
    status_code: int
    content_type: str
    body: bytes

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


def _domain_match(host: str, domain: str) -> bool:
    host = host.lower().rstrip(".")
    domain = domain.lower().removeprefix("www.").rstrip(".")
    return host == domain or host.endswith(f".{domain}")


def _resolve_public_host(host: str) -> None:
    try:
        literal = ipaddress.ip_address(host)
        addresses = [literal]
    except ValueError:
        try:
            records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            addresses = [ipaddress.ip_address(record[4][0]) for record in records]
        except (OSError, ValueError) as exc:
            raise OfficialSourceUnavailable("Could not resolve the approved source host.") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise UnsafeSourceUrl("Source host resolves to a private or non-public network address.")


class SafeOfficialHttpClient:
    """Fetch small listing pages only; redirects and destinations are checked."""

    def __init__(
        self,
        *,
        request_get: Callable = requests.get,
        resolver: Callable[[str], None] = _resolve_public_host,
        cache_seconds: int = 20,
        max_bytes: int = 3 * 1024 * 1024,
        max_redirects: int = 3,
    ) -> None:
        self._request_get = request_get
        self._resolver = resolver
        self._cache_seconds = cache_seconds
        self._max_bytes = max_bytes
        self._max_redirects = max_redirects
        self._cache: dict[tuple[str, ...], tuple[float, PageResponse]] = {}
        self._lock = Lock()

    def fetch(self, url: str, *, allowed_domains: tuple[str, ...], accept: str = "text/html,application/json") -> PageResponse:
        cache_key = (url, *sorted(domain.lower() for domain in allowed_domains), accept)
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached and cached[0] > now:
                return cached[1]

        current = url
        for redirect_count in range(self._max_redirects + 1):
            host = self._validate_destination(current, allowed_domains)
            self._resolver(host)
            response = None
            for attempt in range(2):
                try:
                    response = self._request_get(
                        current,
                        timeout=(4, 12),
                        allow_redirects=False,
                        stream=True,
                        headers={"User-Agent": "FINN.AI public-source discovery/0.1", "Accept": accept},
                    )
                    if int(response.status_code) >= 500 and attempt == 0:
                        time.sleep(0.2)
                        continue
                    break
                except (TimeoutError, requests.exceptions.Timeout) as exc:
                    if attempt == 0:
                        time.sleep(0.2)
                        continue
                    raise OfficialSourceTimeout("The official source did not respond before the bounded retry limit.") from exc
                except Exception as exc:
                    raise OfficialSourceUnavailable(f"Official source request failed: {type(exc).__name__}.") from exc
            if response is None:
                raise OfficialSourceUnavailable("Official source returned no response.")

            try:
                status = int(response.status_code)
                if status in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location or redirect_count >= self._max_redirects:
                        raise OfficialSourceUnavailable("Official source returned an invalid or excessive redirect.")
                    current = urljoin(current, location)
                    continue
                if status == 429:
                    raise OfficialSourceRateLimited("The official source rate-limited the request; no retry was attempted.")
                if status >= 400:
                    raise OfficialSourceUnavailable(f"Official source returned HTTP {status}.")

                content_type = str(response.headers.get("content-type", "")).split(";", 1)[0].strip().lower()
                if not any(value in content_type for value in ("text/html", "application/json", "text/plain")):
                    raise OfficialSourceUnavailable(f"Unsupported source response type: {content_type or 'unknown'}.")
                body = bytearray()
                for chunk in response.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    body.extend(chunk)
                    if len(body) > self._max_bytes:
                        raise OfficialSourceUnavailable("Official listing page exceeded the response-size limit.")
            except OfficialSourceError:
                raise
            except Exception as exc:
                raise OfficialSourceUnavailable("Could not safely read the official listing response.") from exc
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()
            result = PageResponse(current, status, content_type, bytes(body))
            with self._lock:
                self._cache[cache_key] = (time.monotonic() + self._cache_seconds, result)
            return result

        raise OfficialSourceUnavailable("Official source redirect limit exceeded.")

    @staticmethod
    def _validate_destination(url: str, allowed_domains: tuple[str, ...]) -> str:
        try:
            parsed = urlsplit(url)
            host = parsed.hostname
            port = parsed.port
        except ValueError as exc:
            raise UnsafeSourceUrl("Source URL is malformed.") from exc
        if parsed.scheme.lower() != "https" or not host or parsed.username or parsed.password:
            raise UnsafeSourceUrl("Only credential-free HTTPS source URLs are allowed.")
        if port not in (None, 443):
            raise UnsafeSourceUrl("Non-standard HTTPS ports are not allowed.")
        if not any(_domain_match(host, domain) for domain in allowed_domains):
            raise UnsafeSourceUrl("Source or redirect host is outside the approved domain list.")
        return host


DEFAULT_HTTP_CLIENT = SafeOfficialHttpClient()
