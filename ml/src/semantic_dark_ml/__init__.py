"""Corpus construction and tiny-model experiments for semantic-dark."""

from .manifest import CorpusRecord, load_manifest, write_manifest
from .corpus_validation import assert_train_val_label_coverage
from .split_validator import SplitLeak, validate_corpus_disjointness

__all__ = [
    "CorpusRecord",
    "SplitLeak",
    "assert_train_val_label_coverage",
    "load_manifest",
    "validate_corpus_disjointness",
    "write_manifest",
]
