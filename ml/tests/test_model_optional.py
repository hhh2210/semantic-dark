from __future__ import annotations

import pytest
from pathlib import Path

torch = pytest.importorskip("torch")

from semantic_dark_ml.model import TinyRgbaClassifier, trainable_parameter_count  # noqa: E402
from semantic_dark_ml.checkpoint import validate_checkpoint_payload  # noqa: E402
from semantic_dark_ml.manifest import CorpusRecord  # noqa: E402
from semantic_dark_ml.model_eval import format_prediction_row  # noqa: E402
from semantic_dark_ml.onnx_export import export_onnx  # noqa: E402
from semantic_dark_ml.torch_data import LocatedRecord, RgbaCorpusDataset  # noqa: E402


def test_tiny_rgba_cnn_has_four_inputs_outputs_and_stays_under_budget() -> None:
    model = TinyRgbaClassifier().eval()
    assert trainable_parameter_count(model) < 150_000
    with torch.inference_mode():
        logits = model(torch.zeros(2, 4, 96, 96))
    assert logits.shape == (2, 4)
    assert torch.isfinite(logits).all()


def test_unknown_is_excluded_from_training_but_included_in_test_evaluation() -> None:
    def located(identifier: str, label: str, split: str) -> LocatedRecord:
        return LocatedRecord(CorpusRecord(
            id=identifier,
            label=label,  # type: ignore[arg-type]
            source=f"source:{identifier}",
            source_group=f"source-group:{identifier}",
            target_split=split,  # type: ignore[arg-type]
            path=f"images/{identifier}.png",
            sha256="0" * 64,
            raw_sha256="1" * 64,
            original_width=96,
            original_height=96,
            license="CC0-1.0",
            revision="fixture-v1",
        ), Path(f"/{identifier}.png"))

    records = [
        located("known-train", "photo", "train"),
        located("unknown-train", "unknown", "train"),
        located("known-test", "icon", "test"),
        located("unknown-test", "unknown", "test"),
    ]
    training = RgbaCorpusDataset(records, split="train", include_unknown=False)
    evaluation = RgbaCorpusDataset(records, split="test", include_unknown=True)
    assert [item.record.id for item in training.records] == ["known-train"]
    assert [item.record.id for item in evaluation.records] == ["known-test", "unknown-test"]


def test_onnx_export_failure_writes_an_explicit_diagnostic(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("fixture exporter unavailable")

    monkeypatch.setattr(torch.onnx, "export", fail)
    output = tmp_path / "model.onnx"
    result = export_onnx(TinyRgbaClassifier(), output)
    assert result["status"] == "failed"
    assert not output.exists()
    assert "fixture exporter unavailable" in (tmp_path / "onnx_export_error.txt").read_text()


def test_checkpoint_contract_validates_schema_ontology_and_runtime_defaults() -> None:
    payload = {
        "schema": "semantic-dark.checkpoint.v1",
        "labels": ["photo", "icon", "diagram", "screenshot"],
        "state_dict": {"weight": torch.zeros(1)},
        "config": {
            "image_size": 128,
            "confidence_threshold": 0.72,
            "device": "cpu",
            "eval_split": "val",
        },
    }
    metadata = validate_checkpoint_payload(payload)
    assert metadata.image_size == 128
    assert metadata.confidence_threshold == 0.72
    with pytest.raises(ValueError, match="schema"):
        validate_checkpoint_payload({**payload, "schema": "old"})
    with pytest.raises(ValueError, match="ontology"):
        validate_checkpoint_payload({**payload, "labels": ["photo"]})


def test_prediction_v2_keeps_raw_argmax_when_operating_threshold_abstains() -> None:
    record = CorpusRecord(
        id="prediction-fixture",
        label="photo",
        source="fixture:row:1",
        source_group="fixture:group",
        target_split="test",
        path="images/fixture.png",
        sha256="a" * 64,
        raw_sha256="b" * 64,
        original_width=96,
        original_height=96,
        license="CC0-1.0",
        revision="fixture-v1",
    )
    row = format_prediction_row(
        LocatedRecord(record, Path("/fixture.png")),
        [0.9, 0.04, 0.03, 0.03],
        threshold=0.95,
    )
    assert row["schema"] == "semantic-dark.prediction.v2"
    assert row["raw_predicted"] == "photo"
    assert row["predicted"] is None
    assert row["abstained"] is True
    assert row["acceptance_score"] == 0.9
    assert row["operating_threshold"] == 0.95
    assert row["source_group"] == record.source_group
    assert row["sha256"] == record.sha256
    assert row["raw_sha256"] == record.raw_sha256
