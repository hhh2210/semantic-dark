from __future__ import annotations

import copy
import json
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import torch
from torch.utils.data import DataLoader

from .checkpoint import CHECKPOINT_SCHEMA, validate_checkpoint_payload
from .corpus_validation import assert_train_val_label_coverage
from .model import TinyRgbaClassifier, trainable_parameter_count
from .model_eval import predict_dataset, write_predictions
from .ontology import KNOWN_LABELS
from .onnx_export import export_onnx
from .paths import require_scratch_path
from .split_validator import assert_corpus_disjoint
from .torch_data import RgbaCorpusDataset, load_located_records


@dataclass(frozen=True, slots=True)
class TrainConfig:
    epochs: int = 12
    batch_size: int = 64
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    seed: int = 20260717
    device: str = "auto"
    confidence_threshold: float = 0.6
    image_size: int = 96
    eval_split: str = "test"

    def validate(self) -> None:
        if self.epochs <= 0 or self.batch_size <= 0 or self.image_size <= 0:
            raise ValueError("epochs, batch_size, and image_size must be positive")
        if self.learning_rate <= 0 or self.weight_decay < 0:
            raise ValueError("learning_rate must be positive and weight_decay non-negative")
        if not 0 <= self.confidence_threshold <= 1:
            raise ValueError("confidence_threshold must be in [0, 1]")
        if self.eval_split not in {"train", "val", "test"}:
            raise ValueError(f"Invalid eval_split: {self.eval_split}")


def train_and_evaluate(
    manifests: Iterable[str | Path],
    output: str | Path,
    *,
    config: TrainConfig = TrainConfig(),
) -> dict[str, Any]:
    config.validate()
    output_root = require_scratch_path(output)
    located = load_located_records(manifests, verify_files=True)
    assert_corpus_disjoint(item.record for item in located)
    assert_train_val_label_coverage(item.record for item in located)
    train_data = RgbaCorpusDataset(
        located,
        split="train",
        include_unknown=False,
        size=config.image_size,
    )
    val_data = RgbaCorpusDataset(located, split="val", include_unknown=False, size=config.image_size)
    eval_data = RgbaCorpusDataset(
        located,
        split=config.eval_split,
        include_unknown=True,
        size=config.image_size,
    )
    if not train_data.records or not val_data.records or not eval_data.records:
        raise ValueError("Training requires non-empty train, val, and selected evaluation splits")
    output_root.mkdir(parents=True, exist_ok=True)

    set_determinism(config.seed)
    device = resolve_device(config.device)
    model = TinyRgbaClassifier().to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )
    loss_function = torch.nn.CrossEntropyLoss()
    generator = torch.Generator().manual_seed(config.seed)
    loader = DataLoader(
        train_data,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=0,
        generator=generator,
    )
    best_accuracy = -1.0
    best_state: dict[str, torch.Tensor] | None = None
    history: list[dict[str, float | int]] = []
    for epoch in range(config.epochs):
        model.train()
        loss_total = 0.0
        sample_total = 0
        for inputs, targets, _ in loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_function(model(inputs), targets)
            loss.backward()
            optimizer.step()
            loss_total += float(loss.detach()) * inputs.shape[0]
            sample_total += inputs.shape[0]
        val_accuracy = known_accuracy(model, val_data, device=device, batch_size=config.batch_size)
        history.append({
            "epoch": epoch + 1,
            "train_loss": loss_total / sample_total,
            "val_accuracy": val_accuracy,
        })
        if val_accuracy > best_accuracy:
            best_accuracy = val_accuracy
            best_state = {name: value.detach().cpu().clone() for name, value in model.state_dict().items()}
    if best_state is None:
        raise RuntimeError("Training produced no checkpoint state")
    model.load_state_dict(copy.deepcopy(best_state))
    model.to(device)

    checkpoint_path = output_root / "checkpoint.pt"
    torch.save({
        "schema": CHECKPOINT_SCHEMA,
        "state_dict": best_state,
        "labels": list(KNOWN_LABELS),
        "config": asdict(config),
        "parameter_count": trainable_parameter_count(model),
        "best_val_accuracy": best_accuracy,
    }, checkpoint_path)
    rows, metrics = predict_dataset(
        model,
        eval_data,
        device=device,
        threshold=config.confidence_threshold,
        batch_size=config.batch_size,
    )
    predictions_path = output_root / "predictions.jsonl"
    write_predictions(rows, predictions_path)
    onnx = export_onnx(
        model,
        output_root / "model.onnx",
        image_size=config.image_size,
        confidence_threshold=config.confidence_threshold,
    )
    summary: dict[str, Any] = {
        "device": str(device),
        "parameter_count": trainable_parameter_count(model),
        "best_val_accuracy": best_accuracy,
        "image_size": config.image_size,
        "confidence_threshold": config.confidence_threshold,
        "history": history,
        "metrics": metrics,
        "checkpoint": str(checkpoint_path),
        "predictions": str(predictions_path),
        "onnx": onnx,
    }
    (output_root / "metrics.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def evaluate_checkpoint(
    manifests: Iterable[str | Path],
    checkpoint: str | Path,
    output: str | Path,
    *,
    split: str = "test",
    threshold: float | None = None,
    device_name: str = "auto",
    batch_size: int = 64,
) -> dict[str, Any]:
    payload = torch.load(Path(checkpoint).expanduser(), map_location="cpu", weights_only=True)
    metadata = validate_checkpoint_payload(payload)
    threshold_used = metadata.confidence_threshold if threshold is None else threshold
    if not 0 <= threshold_used <= 1:
        raise ValueError("confidence threshold must be in [0, 1]")
    output_root = require_scratch_path(output, create=True)
    located = load_located_records(manifests, verify_files=True)
    assert_corpus_disjoint(item.record for item in located)
    dataset = RgbaCorpusDataset(
        located,
        split=split,
        include_unknown=True,
        size=metadata.image_size,
    )
    if not dataset.records:
        raise ValueError(f"No records for evaluation split {split!r}")
    model = TinyRgbaClassifier()
    model.load_state_dict(payload["state_dict"])
    device = resolve_device(device_name)
    model.to(device)
    rows, metrics = predict_dataset(
        model,
        dataset,
        device=device,
        threshold=threshold_used,
        batch_size=batch_size,
    )
    predictions = output_root / "predictions.jsonl"
    write_predictions(rows, predictions)
    overrides: dict[str, object] = {}
    if threshold is not None:
        overrides["confidence_threshold"] = threshold
    if split != metadata.eval_split:
        overrides["eval_split"] = split
    if device_name != "auto":
        overrides["device"] = device_name
    summary = {
        "checkpoint_schema": CHECKPOINT_SCHEMA,
        "device": str(device),
        "image_size": metadata.image_size,
        "confidence_threshold": threshold_used,
        "overrides": overrides,
        "metrics": metrics,
        "predictions": str(predictions),
    }
    (output_root / "metrics.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    return summary


def known_accuracy(
    model: torch.nn.Module,
    dataset: RgbaCorpusDataset,
    *,
    device: torch.device,
    batch_size: int,
) -> float:
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    correct = total = 0
    model.eval()
    with torch.inference_mode():
        for inputs, targets, _ in loader:
            predictions = model(inputs.to(device)).argmax(dim=1).cpu()
            correct += int((predictions == targets).sum())
            total += targets.numel()
    return correct / total if total else 0.0


def set_determinism(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    if torch.backends.mps.is_available():
        torch.mps.manual_seed(seed)


def resolve_device(name: str) -> torch.device:
    if name not in {"auto", "cpu", "mps"}:
        raise ValueError("device must be auto, cpu, or mps")
    if name == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is unavailable")
    return torch.device("mps" if name == "mps" or (name == "auto" and torch.backends.mps.is_available()) else "cpu")
