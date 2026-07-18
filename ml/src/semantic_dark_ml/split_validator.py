from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

from .manifest import CorpusRecord


@dataclass(frozen=True, slots=True)
class SplitLeak:
    dimension: Literal["source_group", "normalized_sha256", "raw_sha256"]
    key: str
    splits: tuple[str, ...]
    sample_count: int


def validate_corpus_disjointness(records: Iterable[CorpusRecord]) -> list[SplitLeak]:
    materialized = list(records)
    leaks = [
        *_cross_split_leaks(materialized, "source_group"),
        *_cross_split_leaks(materialized, "normalized_sha256"),
        *_cross_split_leaks(materialized, "raw_sha256"),
    ]
    return sorted(leaks, key=lambda leak: (leak.dimension, leak.key))


def assert_corpus_disjoint(records: Iterable[CorpusRecord]) -> None:
    leaks = validate_corpus_disjointness(records)
    if not leaks:
        return
    summary = "; ".join(
        f"{leak.dimension}={leak.key} -> {','.join(leak.splits)}"
        for leak in leaks[:5]
    )
    raise ValueError(f"Group/content-disjoint split violation: {summary}")


def _cross_split_leaks(
    records: list[CorpusRecord],
    dimension: Literal["source_group", "normalized_sha256", "raw_sha256"],
) -> list[SplitLeak]:
    grouped: dict[str, tuple[set[str], int]] = {}
    for record in records:
        key = {
            "source_group": record.source_group,
            "normalized_sha256": record.sha256,
            "raw_sha256": record.raw_sha256,
        }[dimension]
        splits, count = grouped.get(key, (set(), 0))
        splits.add(record.target_split)
        grouped[key] = (splits, count + 1)
    return [
        SplitLeak(dimension, key, tuple(sorted(splits)), count)
        for key, (splits, count) in grouped.items()
        if len(splits) > 1
    ]
