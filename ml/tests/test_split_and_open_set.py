from __future__ import annotations

import hashlib

import pytest

from semantic_dark_ml.corpus_validation import assert_train_val_label_coverage
from semantic_dark_ml.manifest import CorpusRecord
from semantic_dark_ml.ontology import KNOWN_LABELS
from semantic_dark_ml.open_set import rejection_metrics
from semantic_dark_ml.split_validator import assert_corpus_disjoint, validate_corpus_disjointness


def record(source: str, split: str, identifier: str, label: str | None = None) -> CorpusRecord:
    return CorpusRecord(
        id=identifier,
        label=label or ("unknown" if identifier.startswith("ood") else "icon"),  # type: ignore[arg-type]
        source=source,
        source_group=source,
        target_split=split,  # type: ignore[arg-type]
        path=f"images/{identifier}.png",
        sha256=hashlib.sha256(identifier.encode()).hexdigest(),
        raw_sha256=hashlib.sha256(f"raw:{identifier}".encode()).hexdigest(),
        original_width=96,
        original_height=96,
        license="CC0-1.0",
        revision="fixture-v1",
    )


def test_source_disjoint_validator_only_flags_cross_split_reuse() -> None:
    records = [
        record("same", "train", "a"),
        record("same", "train", "b"),
        record("same", "val", "c"),
        record("other", "test", "d"),
    ]
    leaks = validate_corpus_disjointness(records)
    assert len(leaks) == 1
    assert leaks[0].dimension == "source_group"
    assert leaks[0].key == "same"
    assert leaks[0].splits == ("train", "val")
    assert leaks[0].sample_count == 3
    with pytest.raises(ValueError, match="same"):
        assert_corpus_disjoint(records)
    assert_corpus_disjoint([records[0], records[1], records[3]])


def test_normalized_content_hash_cannot_cross_splits_even_for_distinct_groups() -> None:
    train = record("group-a", "train", "content-a")
    test = record("group-b", "test", "content-b")
    test = CorpusRecord.from_dict({**test.to_dict(), "sha256": train.sha256})
    leaks = validate_corpus_disjointness([train, test])
    assert [(leak.dimension, leak.key) for leak in leaks] == [("normalized_sha256", train.sha256)]


def test_raw_content_hash_cannot_cross_splits_even_after_different_normalization() -> None:
    train = record("group-a", "train", "raw-a")
    test = record("group-b", "test", "raw-b")
    test = CorpusRecord.from_dict({**test.to_dict(), "raw_sha256": train.raw_sha256})
    leaks = validate_corpus_disjointness([train, test])
    assert [(leak.dimension, leak.key) for leak in leaks] == [("raw_sha256", train.raw_sha256)]


def test_unknown_is_ood_not_a_softmax_class_and_false_accepts_are_reported() -> None:
    assert KNOWN_LABELS == ("photo", "icon", "diagram", "screenshot")
    assert "unknown" not in KNOWN_LABELS
    rows = [
        {"label": "icon", "predicted": "icon", "abstained": False},
        {"label": "photo", "predicted": None, "abstained": True},
        {"label": "unknown", "predicted": "diagram", "abstained": False},
        {"label": "unknown", "predicted": None, "abstained": True},
    ]
    metrics = rejection_metrics(rows)
    assert metrics["known_coverage"] == 0.5
    assert metrics["known_selective_accuracy"] == 1.0
    assert metrics["unknown_false_accepts"] == 1
    assert metrics["unknown_false_accept_rate"] == 0.5
    assert metrics["overall_abstain_rate"] == 0.5


def test_train_and_val_must_each_cover_all_four_known_labels() -> None:
    complete = [
        record(f"{split}:{label}", split, f"{split}-{label}", label)
        for split in ("train", "val")
        for label in KNOWN_LABELS
    ]
    assert_train_val_label_coverage(complete)
    with pytest.raises(ValueError, match="val missing screenshot"):
        assert_train_val_label_coverage([
            item for item in complete
            if not (item.target_split == "val" and item.label == "screenshot")
        ])
