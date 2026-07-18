from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from torch.utils.data import DataLoader

from .ontology import KNOWN_LABELS
from .open_set import rejection_metrics
from .torch_data import LocatedRecord, RgbaCorpusDataset


def predict_dataset(
    model: torch.nn.Module,
    dataset: RgbaCorpusDataset,
    *,
    device: torch.device,
    threshold: float,
    batch_size: int,
) -> tuple[list[dict[str, Any]], dict[str, float | int | None]]:
    if not 0 <= threshold <= 1:
        raise ValueError("confidence threshold must be in [0, 1]")
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    rows: list[dict[str, Any]] = []
    model.eval()
    with torch.inference_mode():
        for inputs, _, indices in loader:
            probabilities = torch.softmax(model(inputs.to(device)), dim=1).cpu()
            for position, dataset_index in enumerate(indices.tolist()):
                item = dataset.records[dataset_index]
                probability_values = probabilities[position].tolist()
                rows.append(format_prediction_row(item, probability_values, threshold=threshold))
    return rows, rejection_metrics(rows)


def format_prediction_row(
    item: LocatedRecord,
    probability_values: list[float],
    *,
    threshold: float,
) -> dict[str, Any]:
    if len(probability_values) != len(KNOWN_LABELS):
        raise ValueError("Probability vector does not match known-label ontology")
    record = item.record
    raw_index = max(range(len(probability_values)), key=probability_values.__getitem__)
    raw_predicted = KNOWN_LABELS[raw_index]
    acceptance_score = float(probability_values[raw_index])
    accepted = acceptance_score >= threshold
    return {
        "schema": "semantic-dark.prediction.v2",
        "id": record.id,
        "source": record.source,
        "source_group": record.source_group,
        "sha256": record.sha256,
        "raw_sha256": record.raw_sha256,
        "label": record.label,
        "target_split": record.target_split,
        "probabilities": dict(zip(KNOWN_LABELS, probability_values, strict=True)),
        "confidence": acceptance_score,
        "acceptance_score": acceptance_score,
        "score_semantics": "softmax-max-probability-v1",
        "predictor_id": "tiny-rgba-cnn-v1",
        "operating_threshold": threshold,
        "raw_predicted": raw_predicted,
        "predicted": raw_predicted if accepted else None,
        "abstained": not accepted,
    }


def write_predictions(rows: list[dict[str, Any]], path: str | Path) -> None:
    destination = Path(path)
    with destination.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
