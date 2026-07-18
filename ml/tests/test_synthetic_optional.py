from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("PIL")

from semantic_dark_ml.manifest import load_manifest
from semantic_dark_ml.split_validator import validate_corpus_disjointness
from semantic_dark_ml.synthetic import generate_synthetic_charts, generate_synthetic_unknown


def test_synthetic_chart_generation_is_deterministic_and_manifested(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    first_root = tmp_path / "scratch-data" / "first"
    second_root = tmp_path / "scratch-data" / "second"
    first = generate_synthetic_charts(first_root, count=4, target_split="val", seed=7)
    second = generate_synthetic_charts(second_root, count=4, target_split="val", seed=7)
    assert [record.sha256 for record in first] == [record.sha256 for record in second]
    assert all(record.label == "diagram" and record.target_split == "val" for record in first)
    manifest = first_root / "synthetic-val-7" / "manifest.jsonl"
    assert load_manifest(manifest, verify_files=True) == first


def test_synthetic_unknown_is_deterministic_ood_only_and_covers_all_probe_families(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    first = generate_synthetic_unknown(tmp_path / "scratch-data" / "unknown-a", count=10, seed=11)
    second = generate_synthetic_unknown(tmp_path / "scratch-data" / "unknown-b", count=10, seed=11)
    assert [record.sha256 for record in first] == [record.sha256 for record in second]
    assert all(record.label == "unknown" and record.target_split == "test" for record in first)
    families = {record.source.rsplit(":", 1)[-1] for record in first}
    assert families == {"near-empty", "solid", "low-contrast-gradient", "checker", "noise-texture"}
    assert len({record.sha256 for record in first}) == len(first)
    validation = generate_synthetic_unknown(
        tmp_path / "scratch-data" / "unknown-val",
        count=5,
        target_split="val",
        seed=12,
    )
    assert all(record.target_split == "val" for record in validation)
    assert validate_corpus_disjointness([*first, *validation]) == []
    with pytest.raises(ValueError, match="val or test"):
        generate_synthetic_unknown(
            tmp_path / "scratch-data" / "unknown-train",
            count=1,
            target_split="train",
        )
