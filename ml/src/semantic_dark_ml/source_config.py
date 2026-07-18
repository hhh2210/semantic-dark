from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .manifest import CorpusLabel, TargetSplit


@dataclass(frozen=True, slots=True)
class HfSourceConfig:
    id: str
    dataset: str
    revision: str
    config: str
    split: str
    target_split: TargetSplit
    label: CorpusLabel
    image_field: str | None
    url_field: str | None
    license: str
    partition_index: int = 0
    partition_count: int = 1
    enabled: bool = True
    kind: Literal["hf-viewer"] = "hf-viewer"


@dataclass(frozen=True, slots=True)
class NpmSvgSourceConfig:
    id: str
    package: str
    version: str
    revision: str
    target_split: TargetSplit
    label: CorpusLabel
    license: str
    tarball_url: str
    integrity: str
    enabled: bool = True
    kind: Literal["npm-svg"] = "npm-svg"


SourceConfig = HfSourceConfig | NpmSvgSourceConfig


def load_source(path: str | Path, source_id: str) -> SourceConfig:
    with Path(path).open(encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict) or document.get("schema") != "semantic-dark.sources.v1":
        raise ValueError("Unsupported source configuration schema")
    sources = document.get("sources")
    if not isinstance(sources, list):
        raise ValueError("sources must be an array")
    matches = [entry for entry in sources if isinstance(entry, dict) and entry.get("id") == source_id]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one source named {source_id!r}")
    return _parse_source(matches[0])


def _parse_source(value: dict[str, object]) -> SourceConfig:
    revision = _required_string(value, "revision")
    common = {
        "id": _required_string(value, "id"),
        "revision": revision,
        "target_split": _split(value.get("target_split")),
        "label": _label(value.get("label")),
        "license": _required_string(value, "license"),
        "enabled": bool(value.get("enabled", True)),
    }
    if value.get("kind") == "hf-viewer":
        image_field = value.get("image_field")
        url_field = value.get("url_field")
        if not isinstance(image_field, str) and not isinstance(url_field, str):
            raise ValueError("HF source requires image_field or url_field")
        partition_index = _integer(value.get("partition_index", 0), "partition_index", minimum=0)
        partition_count = _integer(value.get("partition_count", 1), "partition_count", minimum=1)
        if partition_index >= partition_count:
            raise ValueError("partition_index must be smaller than partition_count")
        return HfSourceConfig(
            **common,
            dataset=_required_string(value, "dataset"),
            config=_required_string(value, "config"),
            split=_required_string(value, "split"),
            image_field=image_field if isinstance(image_field, str) else None,
            url_field=url_field if isinstance(url_field, str) else None,
            partition_index=partition_index,
            partition_count=partition_count,
        )
    if value.get("kind") == "npm-svg":
        return NpmSvgSourceConfig(
            **common,
            package=_required_string(value, "package"),
            version=_required_string(value, "version"),
            tarball_url=_required_string(value, "tarball_url"),
            integrity=_required_string(value, "integrity"),
        )
    raise ValueError(f"Unsupported source kind: {value.get('kind')}")


def _required_string(value: dict[str, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        raise ValueError(f"Source field {key!r} is required")
    return item


def _label(value: object) -> CorpusLabel:
    if value not in {"photo", "icon", "diagram", "screenshot", "unknown"}:
        raise ValueError(f"Invalid source label: {value}")
    return value  # type: ignore[return-value]


def _split(value: object) -> TargetSplit:
    if value not in {"train", "val", "test"}:
        raise ValueError(f"Invalid target split: {value}")
    return value  # type: ignore[return-value]


def _integer(value: object, name: str, *, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value
