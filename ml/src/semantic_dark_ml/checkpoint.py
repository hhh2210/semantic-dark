from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .ontology import KNOWN_LABELS

CHECKPOINT_SCHEMA = "semantic-dark.checkpoint.v1"


@dataclass(frozen=True, slots=True)
class CheckpointMetadata:
    image_size: int
    confidence_threshold: float
    training_device: str
    eval_split: str


def validate_checkpoint_payload(payload: Any) -> CheckpointMetadata:
    if not isinstance(payload, Mapping):
        raise ValueError("Checkpoint payload must be a mapping")
    if payload.get("schema") != CHECKPOINT_SCHEMA:
        raise ValueError(f"Unsupported checkpoint schema: {payload.get('schema')}")
    if payload.get("labels") != list(KNOWN_LABELS):
        raise ValueError("Checkpoint label ontology does not match the four known classes")
    state_dict = payload.get("state_dict")
    if not isinstance(state_dict, Mapping) or not state_dict:
        raise ValueError("Checkpoint state_dict is missing or empty")
    config = payload.get("config")
    if not isinstance(config, Mapping):
        raise ValueError("Checkpoint config is missing")
    image_size = config.get("image_size")
    threshold = config.get("confidence_threshold")
    device = config.get("device")
    eval_split = config.get("eval_split")
    if isinstance(image_size, bool) or not isinstance(image_size, int) or image_size <= 0:
        raise ValueError("Checkpoint image_size must be a positive integer")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0 <= threshold <= 1:
        raise ValueError("Checkpoint confidence_threshold must be in [0, 1]")
    if not isinstance(device, str) or not device:
        raise ValueError("Checkpoint device must be a non-empty string")
    if eval_split not in {"train", "val", "test"}:
        raise ValueError("Checkpoint eval_split is invalid")
    return CheckpointMetadata(image_size, float(threshold), device, eval_split)
