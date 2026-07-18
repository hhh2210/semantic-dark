from __future__ import annotations

from collections.abc import Iterable

from .manifest import CorpusRecord
from .ontology import KNOWN_LABELS


def assert_train_val_label_coverage(records: Iterable[CorpusRecord]) -> None:
    materialized = list(records)
    failures: list[str] = []
    for split in ("train", "val"):
        present = {record.label for record in materialized if record.target_split == split}
        missing = [label for label in KNOWN_LABELS if label not in present]
        if missing:
            failures.append(f"{split} missing {', '.join(missing)}")
    if failures:
        raise ValueError("Known-label coverage check failed: " + "; ".join(failures))
