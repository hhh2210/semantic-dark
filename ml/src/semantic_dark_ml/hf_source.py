from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from .http import get_bytes, get_json
from .images import normalize_rgba_png, sha256_bytes
from .manifest import CorpusRecord, write_manifest
from .paths import require_scratch_path, safe_child
from .sampling import dispersed_indices
from .source_config import HfSourceConfig

JsonFetcher = Callable[[str], Any]
BytesFetcher = Callable[[str], bytes]
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_VIEWER = "https://datasets-server.huggingface.co/rows"
_HUB = "https://huggingface.co/api/datasets"


def download_hf_source(
    config: HfSourceConfig,
    output: str | Path,
    *,
    count: int,
    size: int = 96,
    json_fetch: JsonFetcher = get_json,
    bytes_fetch: BytesFetcher = get_bytes,
) -> list[CorpusRecord]:
    if not config.enabled:
        raise ValueError(f"Source {config.id!r} is disabled")
    if not _COMMIT.fullmatch(config.revision):
        raise ValueError("HF revision must be a pinned 40-character lowercase commit SHA")
    if count <= 0:
        raise ValueError("count must be positive")
    _verify_current_revision(config, json_fetch)

    first = _fetch_page(config, 0, 1, json_fetch)
    total = first.get("num_rows_total")
    if not isinstance(total, int) or total <= 0:
        raise ValueError("Dataset Viewer did not provide a positive num_rows_total")
    selected = partitioned_indices(
        total,
        count,
        partition_index=config.partition_index,
        partition_count=config.partition_count,
        seed=f"{config.dataset}@{config.revision}:{config.config}:{config.split}",
    )
    pages: dict[int, dict[int, dict[str, Any]]] = {}
    for index in selected:
        page_offset = index // 100 * 100
        if page_offset not in pages:
            payload = _fetch_page(config, page_offset, min(100, total - page_offset), json_fetch)
            if payload.get("num_rows_total") != total:
                raise ValueError("Dataset Viewer row count changed during pagination")
            pages[page_offset] = _index_rows(payload, page_offset)

    artifact_root = require_scratch_path(output, create=True)
    source_root = safe_child(artifact_root, config.id)
    image_root = safe_child(source_root, "images")
    image_root.mkdir(parents=True, exist_ok=True)
    records: list[CorpusRecord] = []
    for index in selected:
        row = pages[index // 100 * 100].get(index)
        if row is None:
            raise ValueError(f"Dataset Viewer omitted selected row {index}")
        asset_url = _asset_url(row, config)
        raw = bytes_fetch(asset_url)
        png, width, height = normalize_rgba_png(raw, size=size)
        record_id = f"hf-{config.id}-{index:09d}"
        relative = f"images/{record_id}.png"
        safe_child(source_root, relative).write_bytes(png)
        records.append(CorpusRecord(
            id=record_id,
            label=config.label,
            source=f"hf:{config.dataset}@{config.revision}:{config.config}:{config.split}:{index}",
            source_group=f"hf:{config.dataset}@{config.revision}:{config.config}:{config.split}",
            target_split=config.target_split,
            path=relative,
            sha256=sha256_bytes(png),
            raw_sha256=sha256_bytes(raw),
            original_width=width,
            original_height=height,
            license=config.license,
            revision=config.revision,
        ))
    _verify_current_revision(config, json_fetch)
    write_manifest(records, source_root / "manifest.jsonl")
    return records


def partitioned_indices(
    total: int,
    count: int,
    *,
    partition_index: int,
    partition_count: int,
    seed: str,
) -> list[int]:
    """Sample only rows assigned to one explicit, mutually exclusive partition."""
    if partition_count <= 0 or not 0 <= partition_index < partition_count:
        raise ValueError("partition_index must be in [0, partition_count)")
    if total <= partition_index:
        return []
    candidate_count = (total - 1 - partition_index) // partition_count + 1
    positions = dispersed_indices(candidate_count, count, f"{seed}:partition:{partition_index}/{partition_count}")
    return [partition_index + position * partition_count for position in positions]


def _verify_current_revision(config: HfSourceConfig, fetch: JsonFetcher) -> None:
    url = f"{_HUB}/{quote(config.dataset, safe='/')}"
    payload = fetch(url)
    current = payload.get("sha") if isinstance(payload, dict) else None
    if current != config.revision:
        raise ValueError(
            f"HF repository moved or pin is wrong: expected {config.revision}, current {current}",
        )


def _fetch_page(config: HfSourceConfig, offset: int, length: int, fetch: JsonFetcher) -> dict[str, Any]:
    query = urlencode({
        "dataset": config.dataset,
        "config": config.config,
        "split": config.split,
        "offset": offset,
        "length": length,
    })
    payload = fetch(f"{_VIEWER}?{query}")
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise ValueError(f"Malformed Dataset Viewer page at offset {offset}")
    return payload


def _index_rows(payload: dict[str, Any], page_offset: int) -> dict[int, dict[str, Any]]:
    indexed: dict[int, dict[str, Any]] = {}
    for position, wrapper in enumerate(payload["rows"]):
        if not isinstance(wrapper, dict) or not isinstance(wrapper.get("row"), dict):
            continue
        row_index = wrapper.get("row_idx", page_offset + position)
        if isinstance(row_index, int):
            indexed[row_index] = wrapper["row"]
    return indexed


def _asset_url(row: dict[str, Any], config: HfSourceConfig) -> str:
    value: Any = row.get(config.image_field) if config.image_field else None
    if isinstance(value, dict):
        value = value.get("src") or value.get("url")
    if not isinstance(value, str) and config.url_field:
        value = row.get(config.url_field)
    if not isinstance(value, str) or not value.startswith("https://"):
        raise ValueError("Selected HF row has no supported image or URL field")
    if f"/--/{config.revision}/--/" not in value:
        raise ValueError("Dataset Viewer asset URL is not locked to the configured revision")
    return value
