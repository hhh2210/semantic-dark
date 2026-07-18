from __future__ import annotations

import base64
import hashlib
import io
import tarfile

import pytest

from semantic_dark_ml.npm_source import (
    fontawesome_definition_to_svg,
    safe_svg_members,
    svg_dimensions,
    verify_sri,
)


def tarball(name: str, content: bytes, *, kind: bytes | None = None) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        member = tarfile.TarInfo(name)
        member.size = len(content)
        if kind is not None:
            member.type = kind
            member.linkname = "target"
        archive.addfile(member, None if kind is not None else io.BytesIO(content))
    return output.getvalue()


def test_sha512_sri_is_strictly_verified() -> None:
    content = b"pinned tarball"
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode()
    verify_sri(content, integrity)
    with pytest.raises(ValueError, match="mismatch"):
        verify_sri(content + b"changed", integrity)
    with pytest.raises(ValueError, match="sha512"):
        verify_sri(content, "sha256-deadbeef")


def test_safe_tar_reader_accepts_svg_but_rejects_traversal_and_links() -> None:
    svg = b'<svg viewBox="0 0 24 32"><path d="M0 0h1v1z"/></svg>'
    assert safe_svg_members(tarball("package/icons/a.svg", svg)) == {"package/icons/a.svg": svg}
    with pytest.raises(ValueError, match="Unsafe tar member path"):
        safe_svg_members(tarball("../escape.svg", svg))
    with pytest.raises(ValueError, match="Unsafe tar member type"):
        safe_svg_members(tarball("package/link.svg", b"", kind=tarfile.SYMTYPE))


def test_fontawesome_static_definition_is_rebuilt_without_executing_javascript() -> None:
    javascript = b"""
var width = 576;
var height = 512;
var svgPathData = 'M0 0h10v20z';
exports.definition = { icon: [width, height, [], 'x', svgPathData] };
"""
    svg = fontawesome_definition_to_svg(javascript)
    assert svg is not None
    assert svg_dimensions(svg) == (576, 512)
    package = safe_svg_members(tarball("package/faFixture.js", javascript))
    assert list(package) == ["package/faFixture.js.svg"]


def test_svg_dimensions_support_viewbox_and_numeric_units() -> None:
    assert svg_dimensions(b'<svg viewBox="0 0 48 64"/>') == (48, 64)
    assert svg_dimensions(b'<svg width="20px" height="30.5"/>') == (20, 30)
