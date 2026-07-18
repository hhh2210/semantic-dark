from __future__ import annotations

import io
import random
from pathlib import Path

from .images import sha256_bytes
from .manifest import CorpusRecord, TargetSplit, write_manifest
from .paths import require_scratch_path, safe_child

_REVISION = "synthetic-chart-v1"
_UNKNOWN_REVISION = "synthetic-unknown-v1"


def generate_synthetic_charts(
    output: str | Path,
    *,
    count: int,
    target_split: TargetSplit,
    seed: int = 20260717,
    size: int = 96,
) -> list[CorpusRecord]:
    if count <= 0 or size < 32:
        raise ValueError("count must be positive and size must be at least 32")
    if target_split not in {"train", "val", "test"}:
        raise ValueError(f"Invalid target split: {target_split}")
    try:
        from PIL import Image, ImageDraw
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise RuntimeError("Synthetic charts require: uv sync --extra corpus") from error

    artifact_root = require_scratch_path(output, create=True)
    source_root = safe_child(artifact_root, f"synthetic-{target_split}-{seed}")
    image_root = safe_child(source_root, "images")
    image_root.mkdir(parents=True, exist_ok=True)
    records: list[CorpusRecord] = []
    for index in range(count):
        rng = random.Random((seed << 32) ^ index)
        dark = index % 4 == 3
        background = _color(rng, 10, 45) if dark else _color(rng, 232, 255)
        foreground = _color(rng, 185, 245) if dark else _color(rng, 20, 70)
        image = Image.new("RGBA", (size, size), (*background, 255))
        draw = ImageDraw.Draw(image)
        margin = max(6, size // 10)
        draw.line((margin, margin, margin, size - margin), fill=(*foreground, 255), width=2)
        draw.line((margin, size - margin, size - margin, size - margin), fill=(*foreground, 255), width=2)
        if index % 3 == 0:
            _draw_bars(draw, rng, size, margin, dark)
        elif index % 3 == 1:
            _draw_line(draw, rng, size, margin, dark)
        else:
            _draw_scatter(draw, rng, size, margin, dark)
        output_bytes = io.BytesIO()
        image.save(output_bytes, format="PNG", optimize=False, compress_level=9)
        png = output_bytes.getvalue()
        record_id = f"synthetic-{target_split}-{seed}-{index:07d}"
        relative = f"images/{record_id}.png"
        safe_child(source_root, relative).write_bytes(png)
        records.append(CorpusRecord(
            id=record_id,
            label="diagram",
            source=f"synthetic-chart:{seed}:{index}",
            source_group=f"synthetic-chart:{seed}",
            target_split=target_split,
            path=relative,
            sha256=sha256_bytes(png),
            raw_sha256=sha256_bytes(png),
            original_width=size,
            original_height=size,
            license="CC0-1.0",
            revision=_REVISION,
        ))
    write_manifest(records, source_root / "manifest.jsonl")
    return records


def generate_synthetic_unknown(
    output: str | Path,
    *,
    count: int,
    target_split: TargetSplit = "test",
    seed: int = 20260717,
    size: int = 96,
) -> list[CorpusRecord]:
    """Generate ambiguous/OOD resources for validation or test rejection calibration."""
    if count <= 0 or size < 32:
        raise ValueError("count must be positive and size must be at least 32")
    if target_split not in {"val", "test"}:
        raise ValueError("Synthetic unknowns are OOD calibration/evaluation only; split must be val or test")
    try:
        from PIL import Image, ImageDraw
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise RuntimeError("Synthetic unknowns require: uv sync --extra corpus") from error

    artifact_root = require_scratch_path(output, create=True)
    source_root = safe_child(artifact_root, f"synthetic-unknown-{target_split}-{seed}")
    image_root = safe_child(source_root, "images")
    image_root.mkdir(parents=True, exist_ok=True)
    kinds = ("near-empty", "solid", "low-contrast-gradient", "checker", "noise-texture")
    records: list[CorpusRecord] = []
    for index in range(count):
        rng = random.Random((seed << 32) ^ index ^ 0x0DD5E7)
        kind = kinds[index % len(kinds)]
        image = _unknown_image(
            Image,
            ImageDraw,
            rng,
            size,
            kind,
            make_blank=target_split == "test" and index == 0,
        )
        output_bytes = io.BytesIO()
        image.save(output_bytes, format="PNG", optimize=False, compress_level=9)
        png = output_bytes.getvalue()
        record_id = f"synthetic-unknown-{target_split}-{seed}-{index:07d}"
        relative = f"images/{record_id}.png"
        safe_child(source_root, relative).write_bytes(png)
        records.append(CorpusRecord(
            id=record_id,
            label="unknown",
            source=f"synthetic-unknown:{target_split}:{seed}:{index}:{kind}",
            source_group=f"synthetic-unknown:{seed}",
            target_split=target_split,
            path=relative,
            sha256=sha256_bytes(png),
            raw_sha256=sha256_bytes(png),
            original_width=size,
            original_height=size,
            license="CC0-1.0",
            revision=_UNKNOWN_REVISION,
        ))
    write_manifest(records, source_root / "manifest.jsonl")
    return records


def _unknown_image(
    image_module: object,
    draw_module: object,
    rng: random.Random,
    size: int,
    kind: str,
    *,
    make_blank: bool,
) -> object:
    if kind == "near-empty":
        image = image_module.new("RGBA", (size, size), (0, 0, 0, 0))
        if make_blank:
            return image
        draw = draw_module.Draw(image)
        value = rng.randint(80, 180)
        x, y = rng.randrange(size), rng.randrange(size)
        draw.rectangle((x, y, min(size - 1, x + 1), min(size - 1, y + 1)), fill=(value, value, value, 24))
        return image
    if kind == "solid":
        return image_module.new("RGBA", (size, size), (*_color(rng, 0, 255), rng.randint(100, 255)))
    if kind == "low-contrast-gradient":
        base = _color(rng, 55, 200)
        image = image_module.new("RGBA", (size, size))
        image.putdata([
            tuple(min(255, channel + round(7 * x / max(1, size - 1))) for channel in base) + (255,)
            for _y in range(size)
            for x in range(size)
        ])
        return image
    if kind == "checker":
        first = _color(rng, 30, 220)
        second = tuple(max(0, min(255, value + rng.choice((-18, 18)))) for value in first)
        image = image_module.new("RGBA", (size, size))
        block = max(2, size // 12)
        image.putdata([
            (*(first if (x // block + y // block) % 2 == 0 else second), 255)
            for y in range(size)
            for x in range(size)
        ])
        return image
    base = rng.randint(50, 205)
    image = image_module.new("RGBA", (size, size))
    image.putdata([
        tuple(max(0, min(255, base + rng.randint(-35, 35))) for _ in range(3)) + (rng.randint(180, 255),)
        for _ in range(size * size)
    ])
    return image


def _draw_bars(draw: object, rng: random.Random, size: int, margin: int, dark: bool) -> None:
    from PIL import ImageDraw

    typed = draw if isinstance(draw, ImageDraw.ImageDraw) else draw
    count = rng.randint(3, 7)
    width = max(3, (size - margin * 2) // (count * 2))
    for index in range(count):
        x = margin + width + index * width * 2
        height = rng.randint(size // 8, size - margin * 2)
        color = _color(rng, 120 if dark else 45, 240 if dark else 205)
        typed.rectangle((x, size - margin - height, x + width, size - margin - 1), fill=(*color, 255))


def _draw_line(draw: object, rng: random.Random, size: int, margin: int, dark: bool) -> None:
    count = rng.randint(5, 9)
    points = []
    for index in range(count):
        x = margin + index * (size - margin * 2) / (count - 1)
        y = rng.randint(margin + 2, size - margin - 3)
        points.append((round(x), y))
    color = _color(rng, 150 if dark else 25, 245 if dark else 190)
    draw.line(points, fill=(*color, 255), width=3, joint="curve")


def _draw_scatter(draw: object, rng: random.Random, size: int, margin: int, dark: bool) -> None:
    for _ in range(rng.randint(12, 28)):
        x = rng.randint(margin + 2, size - margin - 3)
        y = rng.randint(margin + 2, size - margin - 3)
        radius = rng.randint(1, 3)
        color = _color(rng, 145 if dark else 30, 245 if dark else 205)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, 230))


def _color(rng: random.Random, minimum: int, maximum: int) -> tuple[int, int, int]:
    return tuple(rng.randint(minimum, maximum) for _ in range(3))  # type: ignore[return-value]
