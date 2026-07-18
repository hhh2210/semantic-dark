from __future__ import annotations

import base64
import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import unquote_to_bytes, urlparse
from urllib.request import Request, urlopen

USER_AGENT = "semantic-dark-ml/0.1 (+local reproducible corpus builder)"
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 5


def get_bytes(url: str, *, timeout: float = 30, max_bytes: int = 64 * 1024 * 1024) -> bytes:
    if url.startswith("data:"):
        return _decode_data_url(url, max_bytes)
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Only HTTPS and data URLs are allowed: {url}")
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    for attempt in range(_MAX_ATTEMPTS):
        try:
            with urlopen(request, timeout=timeout) as response:  # noqa: S310 - HTTPS checked above
                content = response.read(max_bytes + 1)
            break
        except HTTPError as error:
            if error.code not in _RETRYABLE_STATUS or attempt + 1 == _MAX_ATTEMPTS:
                raise
            retry_after = error.headers.get("Retry-After")
            error.close()
            time.sleep(_retry_delay(attempt, retry_after))
        except (TimeoutError, URLError):
            if attempt + 1 == _MAX_ATTEMPTS:
                raise
            time.sleep(_retry_delay(attempt, None))
    if len(content) > max_bytes:
        raise ValueError(f"Response exceeds {max_bytes} bytes: {url}")
    return content


def _retry_delay(attempt: int, retry_after: str | None) -> float:
    try:
        requested = float(retry_after) if retry_after is not None else 0
    except ValueError:
        requested = 0
    return min(10.0, max(2.0**attempt, requested))


def get_json(url: str, *, timeout: float = 30, max_bytes: int = 16 * 1024 * 1024) -> Any:
    raw = get_bytes(url, timeout=timeout, max_bytes=max_bytes)
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid JSON response from {url}") from error


def _decode_data_url(url: str, max_bytes: int) -> bytes:
    header, separator, payload = url.partition(",")
    if not separator:
        raise ValueError("Malformed data URL")
    try:
        content = base64.b64decode(payload, validate=True) if header.endswith(";base64") else unquote_to_bytes(payload)
    except (ValueError, base64.binascii.Error) as error:
        raise ValueError("Malformed data URL payload") from error
    if len(content) > max_bytes:
        raise ValueError(f"Data URL exceeds {max_bytes} bytes")
    return content
