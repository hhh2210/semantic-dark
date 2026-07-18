from __future__ import annotations

import json
from pathlib import Path

import pytest

from semantic_dark_ml.manifest import CorpusRecord, load_manifest, sha256_file, write_manifest
from semantic_dark_ml.paths import require_scratch_path, safe_child
from semantic_dark_ml.sampling import dispersed_indices
from semantic_dark_ml.source_config import HfSourceConfig, NpmSvgSourceConfig, load_source


def record(**overrides: object) -> CorpusRecord:
    values: dict[str, object] = {
        "id": "sample-1",
        "label": "screenshot",
        "source": "source:one",
        "source_group": "source-group:one",
        "target_split": "train",
        "path": "images/sample.png",
        "sha256": "0" * 64,
        "raw_sha256": "1" * 64,
        "original_width": 120,
        "original_height": 80,
        "license": "CC0-1.0",
        "revision": "abc123",
    }
    values.update(overrides)
    return CorpusRecord(**values)  # type: ignore[arg-type]


def test_manifest_round_trip_and_file_verification(tmp_path: Path) -> None:
    image = tmp_path / "images" / "sample.png"
    image.parent.mkdir()
    image.write_bytes(b"deterministic-png-placeholder")
    item = record(sha256=sha256_file(image))
    manifest = tmp_path / "manifest.jsonl"
    assert write_manifest([item], manifest) == 1
    assert load_manifest(manifest, verify_files=True) == [item]
    payload = json.loads(manifest.read_text())
    assert payload["schema"] == "semantic-dark.corpus.v1"
    assert payload["label"] == "screenshot"


@pytest.mark.parametrize("change", [
    {"path": "../escape.png"},
    {"sha256": "bad"},
    {"revision": ""},
    {"label": "not-a-label"},
])
def test_manifest_rejects_invalid_schema_values(change: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        record(**change).validate()


def test_artifact_guard_only_accepts_a_scratch_subdirectory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    allowed = require_scratch_path(tmp_path / "scratch-data" / "run-1", create=True)
    assert allowed.is_dir()
    with pytest.raises(ValueError):
        require_scratch_path(tmp_path / "outside")
    with pytest.raises(ValueError):
        require_scratch_path(tmp_path / "scratch-data")
    with pytest.raises(ValueError):
        safe_child(allowed, "../escape")


def test_dispersed_sampling_is_unique_deterministic_and_stratified() -> None:
    first = dispersed_indices(997, 37, "pinned-source")
    assert first == dispersed_indices(997, 37, "pinned-source")
    assert len(first) == len(set(first)) == 37
    assert first == sorted(first)
    for stratum, index in enumerate(first):
        assert stratum * 997 // 37 <= index < (stratum + 1) * 997 // 37


def test_pinned_and_skeleton_sources_have_required_revision_fields() -> None:
    sources = Path(__file__).parents[1] / "sources.v1.json"
    npm = load_source(sources, "material-icons-train")
    assert isinstance(npm, NpmSvgSourceConfig)
    assert npm.version == npm.revision == "0.14.15"
    assert npm.integrity.startswith("sha512-")
    hf = load_source(sources, "hf-websight-v01-audit")
    assert isinstance(hf, HfSourceConfig)
    assert hf.enabled is False
    assert hf.revision == "b11f8172f89c992b56ac702319e02c428cca4a4e"
