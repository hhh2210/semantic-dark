from email.message import Message
from urllib.error import HTTPError

import pytest

from semantic_dark_ml import http


class _Response:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self, _: int) -> bytes:
        return self.content


def test_retries_429_then_returns_content(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0
    delays: list[float] = []

    def open_once(*_: object, **__: object) -> _Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            headers = Message()
            headers["Retry-After"] = "3"
            raise HTTPError("https://example.test", 429, "limited", headers, None)
        return _Response(b"ok")

    monkeypatch.setattr(http, "urlopen", open_once)
    monkeypatch.setattr(http.time, "sleep", delays.append)
    assert http.get_bytes("https://example.test") == b"ok"
    assert attempts == 2
    assert delays == [3]


def test_does_not_retry_permanent_client_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_: object, **__: object) -> _Response:
        raise HTTPError("https://example.test", 404, "missing", Message(), None)

    monkeypatch.setattr(http, "urlopen", fail)
    with pytest.raises(HTTPError, match="404"):
        http.get_bytes("https://example.test")
