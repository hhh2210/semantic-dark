from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch.utils.data import Dataset

from .manifest import CorpusRecord, load_manifest
from .ontology import KNOWN_LABELS


@dataclass(frozen=True, slots=True)
class LocatedRecord:
    record: CorpusRecord
    path: Path


def load_located_records(manifests: Iterable[str | Path], *, verify_files: bool = True) -> list[LocatedRecord]:
    located: list[LocatedRecord] = []
    seen_ids: set[str] = set()
    for manifest_value in manifests:
        manifest = Path(manifest_value).expanduser().resolve()
        for record in load_manifest(manifest, verify_files=verify_files):
            if record.id in seen_ids:
                raise ValueError(f"Duplicate record id across manifests: {record.id}")
            seen_ids.add(record.id)
            located.append(LocatedRecord(record, (manifest.parent / record.path).resolve()))
    return located


class RgbaCorpusDataset(Dataset[tuple[torch.Tensor, int, int]]):
    def __init__(
        self,
        records: Iterable[LocatedRecord],
        *,
        split: str,
        include_unknown: bool,
        size: int = 96,
    ) -> None:
        self.records = [
            item for item in records
            if item.record.target_split == split and (include_unknown or item.record.label in KNOWN_LABELS)
        ]
        self.size = size

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int, int]:
        try:
            from PIL import Image
        except ImportError as error:  # pragma: no cover - dependency guidance
            raise RuntimeError("Training requires: uv sync --extra train") from error
        item = self.records[index]
        with Image.open(item.path) as opened:
            image = opened.convert("RGBA")
            if image.size != (self.size, self.size):
                raise ValueError(f"Expected {self.size}x{self.size} corpus image: {item.path}")
            array = np.asarray(image, dtype=np.float32).copy() / 255.0
        tensor = torch.from_numpy(array).permute(2, 0, 1).contiguous()
        target = KNOWN_LABELS.index(item.record.label) if item.record.label in KNOWN_LABELS else -1
        return tensor, target, index
