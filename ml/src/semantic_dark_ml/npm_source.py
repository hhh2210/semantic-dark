from __future__ import annotations

import base64
import ast
import hashlib
import hmac
import html
import io
import os
import re
import sys
import tarfile
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath

from .http import get_bytes
from .images import normalize_rgba_png, sha256_bytes
from .manifest import CorpusRecord, write_manifest
from .paths import require_scratch_path, safe_child
from .sampling import dispersed_indices
from .source_config import NpmSvgSourceConfig

_DIMENSION = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)")
_FA_WIDTH = re.compile(rb"var width = ([0-9]+);")
_FA_HEIGHT = re.compile(rb"var height = ([0-9]+);")
_FA_PATH = re.compile(rb"var svgPathData = ('(?:\\.|[^'])*');")


def verify_sri(content: bytes, integrity: str) -> None:
    algorithm, separator, encoded = integrity.partition("-")
    if not separator or algorithm != "sha512":
        raise ValueError("Only sha512 SRI values are accepted for npm tarballs")
    try:
        expected = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise ValueError("Malformed npm SRI value") from error
    actual = hashlib.sha512(content).digest()
    if not hmac.compare_digest(actual, expected):
        raise ValueError("npm tarball sha512 SRI mismatch")


def safe_svg_members(
    tarball: bytes,
    *,
    max_members: int = 100_000,
    max_svg_bytes: int = 2 * 1024 * 1024,
) -> dict[str, bytes]:
    svgs: dict[str, bytes] = {}
    javascript: dict[str, bytes] = {}
    try:
        archive = tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz")
    except tarfile.TarError as error:
        raise ValueError("Invalid npm gzip tarball") from error
    with archive:
        members = archive.getmembers()
        if len(members) > max_members:
            raise ValueError(f"Tarball has too many members: {len(members)}")
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"Unsafe tar member path: {member.name}")
            if member.issym() or member.islnk() or member.isdev():
                raise ValueError(f"Unsafe tar member type: {member.name}")
            if member.isfile() and path.suffix.lower() == ".svg" and member.size > max_svg_bytes:
                # Aggregated SVG fonts can be many MiB. They are not individual
                # samples, so skip them without reading or allocating payloads.
                continue
            if not member.isfile() or path.suffix.lower() != ".svg":
                if member.isfile() and path.suffix.lower() == ".js" and member.size <= max_svg_bytes:
                    extracted = archive.extractfile(member)
                    if extracted is not None:
                        javascript[member.name] = extracted.read(max_svg_bytes + 1)
                continue
            extracted = archive.extractfile(member)
            if extracted is None:
                raise ValueError(f"Cannot read SVG member: {member.name}")
            svgs[member.name] = extracted.read(max_svg_bytes + 1)
    if not svgs:
        for name, content in javascript.items():
            generated = fontawesome_definition_to_svg(content)
            if generated is not None:
                svgs[f"{name}.svg"] = generated
    return svgs


def fontawesome_definition_to_svg(javascript: bytes) -> bytes | None:
    """Parse Font Awesome's static constants without evaluating package code."""
    width_match = _FA_WIDTH.search(javascript)
    height_match = _FA_HEIGHT.search(javascript)
    path_match = _FA_PATH.search(javascript)
    if not width_match or not height_match or not path_match:
        return None
    try:
        path_data = ast.literal_eval(path_match.group(1).decode("utf-8"))
    except (SyntaxError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(path_data, str):
        return None
    width = int(width_match.group(1))
    height = int(height_match.group(1))
    escaped = html.escape(path_data, quote=True)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">'
        f'<path d="{escaped}"/></svg>'
    ).encode()


def download_npm_svg_source(
    config: NpmSvgSourceConfig,
    output: str | Path,
    *,
    count: int,
    size: int = 96,
) -> list[CorpusRecord]:
    if not config.enabled:
        raise ValueError(f"Source {config.id!r} is disabled")
    if count <= 0:
        raise ValueError("count must be positive")
    tarball = get_bytes(config.tarball_url, max_bytes=256 * 1024 * 1024)
    verify_sri(tarball, config.integrity)
    members = safe_svg_members(tarball)
    names = sorted(members)
    if not names:
        raise ValueError(f"npm package {config.package}@{config.version} contains no SVG files")
    indices = dispersed_indices(len(names), count, f"{config.package}@{config.version}")

    artifact_root = require_scratch_path(output, create=True)
    source_root = safe_child(artifact_root, config.id)
    image_root = safe_child(source_root, "images")
    image_root.mkdir(parents=True, exist_ok=True)
    records: list[CorpusRecord] = []
    for index in indices:
        member_name = names[index]
        svg = members[member_name]
        width, height = svg_dimensions(svg)
        png = rasterize_svg(svg, size=size)
        normalized, _, _ = normalize_rgba_png(png, size=size)
        suffix = hashlib.sha256(member_name.encode()).hexdigest()[:16]
        record_id = f"npm-{config.id}-{suffix}"
        relative = f"images/{record_id}.png"
        safe_child(source_root, relative).write_bytes(normalized)
        records.append(CorpusRecord(
            id=record_id,
            label=config.label,
            source=f"npm:{config.package}@{config.version}:{member_name}",
            source_group=f"npm:{config.package}@{config.version}",
            target_split=config.target_split,
            path=relative,
            sha256=sha256_bytes(normalized),
            raw_sha256=sha256_bytes(svg),
            original_width=width,
            original_height=height,
            license=config.license,
            revision=config.revision,
        ))
    write_manifest(records, source_root / "manifest.jsonl")
    return records


def rasterize_svg(svg: bytes, *, size: int = 96) -> bytes:
    _configure_cairo_search_path()
    try:
        import cairosvg
    except (ImportError, OSError) as error:  # pragma: no cover - dependency guidance
        raise RuntimeError(
            "SVG rasterization requires `uv sync --extra corpus` and system Cairo "
            "(`brew install cairo` on macOS)",
        ) from error
    try:
        return cairosvg.svg2png(bytestring=svg, output_width=size, output_height=size, unsafe=False)
    except (ValueError, ET.ParseError) as error:
        raise ValueError("CairoSVG could not rasterize SVG") from error


def svg_dimensions(svg: bytes) -> tuple[int, int]:
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as error:
        raise ValueError("Malformed SVG XML") from error
    view_box = root.attrib.get("viewBox", "").replace(",", " ").split()
    if len(view_box) == 4:
        try:
            return max(1, round(float(view_box[2]))), max(1, round(float(view_box[3])))
        except ValueError:
            pass
    return _dimension(root.attrib.get("width")), _dimension(root.attrib.get("height"))


def _dimension(value: str | None) -> int:
    match = _DIMENSION.match(value or "")
    return max(1, round(float(match.group(1)))) if match else 96


def _configure_cairo_search_path() -> None:
    if sys.platform != "darwin":
        return
    candidates = [path for path in ("/opt/homebrew/lib", "/usr/local/lib") if Path(path).is_dir()]
    existing = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
    paths = [*candidates, *(part for part in existing.split(":") if part)]
    if paths:
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = ":".join(dict.fromkeys(paths))
