from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import torch

from .ontology import KNOWN_LABELS


def export_onnx(
    model: torch.nn.Module,
    output: str | Path,
    *,
    image_size: int = 96,
    confidence_threshold: float = 0.6,
) -> dict[str, Any]:
    if not 0 <= confidence_threshold <= 1:
        raise ValueError("confidence_threshold must be in [0, 1]")
    destination = Path(output)
    error_path = destination.with_name("onnx_export_error.txt")
    contract_path = destination.with_suffix(".contract.json")
    destination.unlink(missing_ok=True)
    error_path.unlink(missing_ok=True)
    contract_path.unlink(missing_ok=True)
    try:
        model = model.to("cpu").eval()
        example = torch.zeros(1, 4, image_size, image_size, dtype=torch.float32)
        torch.onnx.export(
            model,
            example,
            destination,
            input_names=["rgba"],
            output_names=["logits"],
            dynamic_axes={"rgba": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=17,
            do_constant_folding=True,
            dynamo=False,
        )
        if not destination.is_file() or destination.stat().st_size == 0:
            raise RuntimeError("ONNX exporter returned without creating a non-empty file")
        import onnx

        onnx_model = onnx.load(destination)
        onnx.checker.check_model(onnx_model)
        opset = max(item.version for item in onnx_model.opset_import)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        contract = {
            "schema": "semantic-dark.onnx-contract.v1",
            "input": {
                "name": "rgba",
                "layout": "NCHW",
                "dtype": "float32",
                "range": [0.0, 1.0],
                "shape": ["batch", 4, image_size, image_size],
            },
            "output": {
                "name": "logits",
                "dtype": "float32",
                "shape": ["batch", len(KNOWN_LABELS)],
            },
            "labels": list(KNOWN_LABELS),
            "confidence_threshold": confidence_threshold,
            "opset": opset,
            "sha256": digest,
        }
        contract_path.write_text(json.dumps(contract, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return {
            "status": "ok",
            "path": str(destination),
            "contract": str(contract_path),
            "opset": opset,
            "sha256": digest,
        }
    except Exception as error:  # exporter availability varies by local PyTorch build
        destination.unlink(missing_ok=True)
        contract_path.unlink(missing_ok=True)
        message = f"{type(error).__name__}: {error}"
        error_path.write_text(message + "\n", encoding="utf-8")
        return {"status": "failed", "error": message, "error_path": str(error_path)}
