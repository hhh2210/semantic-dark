from __future__ import annotations

import io
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

pytest.importorskip("PIL")
from PIL import Image

from semantic_dark_ml.hf_source import download_hf_source, partitioned_indices
from semantic_dark_ml.manifest import load_manifest
from semantic_dark_ml.source_config import HfSourceConfig

REVISION = "a" * 40


def config(**overrides: object) -> HfSourceConfig:
    values: dict[str, object] = {
        "id": "hf-fixture",
        "dataset": "org/data",
        "revision": REVISION,
        "config": "default",
        "split": "train",
        "target_split": "train",
        "label": "photo",
        "image_field": "image",
        "url_field": None,
        "license": "CC0-1.0",
    }
    values.update(overrides)
    return HfSourceConfig(**values)  # type: ignore[arg-type]


def tiny_png() -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", (2, 1), (20, 40, 60, 128)).save(output, format="PNG")
    return output.getvalue()


def test_hf_downloader_checks_sha_and_fetches_only_selected_pages(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    page_calls: list[tuple[int, int]] = []
    head_calls = 0

    def fetch_json(url: str) -> object:
        nonlocal head_calls
        if "/api/datasets/" in url:
            head_calls += 1
            return {"sha": REVISION}
        query = parse_qs(urlparse(url).query)
        offset, length = int(query["offset"][0]), int(query["length"][0])
        page_calls.append((offset, length))
        return {
            "num_rows_total": 250,
            "partial": False,
            "rows": [
                {
                    "row_idx": index,
                    "row": {"image": {"src": f"https://assets/--/{REVISION}/--/{index}.png"}},
                }
                for index in range(offset, min(250, offset + length))
            ],
        }

    output = tmp_path / "scratch-data" / "corpus"
    records = download_hf_source(
        config(),
        output,
        count=7,
        json_fetch=fetch_json,
        bytes_fetch=lambda _: tiny_png(),
    )
    assert len(records) == 7
    assert all(record.original_width == 2 and record.original_height == 1 for record in records)
    assert all(record.revision == REVISION for record in records)
    assert page_calls[0] == (0, 1)
    assert all(length <= 100 for _, length in page_calls)
    assert len(page_calls) <= 4  # one total probe plus at most three selected pages
    assert head_calls == 2  # HEAD is rechecked after all assets are downloaded.
    manifest = output / "hf-fixture" / "manifest.jsonl"
    assert load_manifest(manifest, verify_files=True) == records
    with Image.open(output / "hf-fixture" / records[0].path) as image:
        assert image.mode == "RGBA"
        assert image.size == (96, 96)


def test_hf_downloader_refuses_moving_or_placeholder_revisions(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="commit SHA"):
        download_hf_source(config(revision="main"), tmp_path, count=1)
    with pytest.raises(ValueError, match="moved"):
        download_hf_source(
            config(),
            tmp_path,
            count=1,
            json_fetch=lambda _: {"sha": "b" * 40},
        )


def test_hf_downloader_rejects_viewer_assets_without_the_configured_sha(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    def fetch_json(url: str) -> object:
        if "/api/datasets/" in url:
            return {"sha": REVISION}
        return {
            "num_rows_total": 1,
            "rows": [{"row_idx": 0, "row": {"image": {"src": "https://assets/unpinned.png"}}}],
        }

    with pytest.raises(ValueError, match="not locked"):
        download_hf_source(
            config(),
            tmp_path / "scratch-data" / "corpus",
            count=1,
            json_fetch=fetch_json,
            bytes_fetch=lambda _: tiny_png(),
        )


def test_same_dataset_split_three_way_row_partitions_are_mutually_exclusive() -> None:
    seed = f"org/data@{REVISION}:default:train"
    partitions = [
        set(partitioned_indices(
            1001,
            120,
            partition_index=index,
            partition_count=3,
            seed=seed,
        ))
        for index in range(3)
    ]
    assert all(row % 3 == index for index, rows in enumerate(partitions) for row in rows)
    assert partitions[0].isdisjoint(partitions[1])
    assert partitions[0].isdisjoint(partitions[2])
    assert partitions[1].isdisjoint(partitions[2])
