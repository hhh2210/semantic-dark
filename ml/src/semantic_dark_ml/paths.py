from __future__ import annotations

from pathlib import Path


def scratch_root() -> Path:
    return (Path.home() / "scratch-data").resolve()


def require_scratch_path(path: str | Path, *, create: bool = False) -> Path:
    """Resolve an artifact path and reject writes outside ~/scratch-data."""
    resolved = Path(path).expanduser().resolve()
    root = scratch_root()
    if resolved == root:
        raise ValueError("Choose a dedicated subdirectory inside ~/scratch-data")
    if not resolved.is_relative_to(root):
        raise ValueError(f"Artifact path must be inside {root}: {resolved}")
    if create:
        resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def safe_child(root: Path, relative: str | Path) -> Path:
    child = (root / relative).resolve()
    if not child.is_relative_to(root.resolve()):
        raise ValueError(f"Path escapes artifact root: {relative}")
    return child
