from __future__ import annotations

import hashlib
import io


def normalize_rgba_png(raw: bytes, *, size: int = 96) -> tuple[bytes, int, int]:
    """Decode an image and letterbox it into a deterministic square RGBA PNG."""
    if size <= 0:
        raise ValueError("size must be positive")
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise RuntimeError("Image normalization requires: uv sync --extra corpus") from error

    try:
        with Image.open(io.BytesIO(raw)) as opened:
            original_width, original_height = opened.size
            if original_width <= 0 or original_height <= 0:
                raise ValueError("Image dimensions must be positive")
            image = ImageOps.exif_transpose(opened).convert("RGBA")
            image.thumbnail((size, size), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            canvas.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
            output = io.BytesIO()
            canvas.save(output, format="PNG", optimize=False, compress_level=9)
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("Unsupported or corrupt image") from error
    return output.getvalue(), original_width, original_height


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
