from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    result = arguments.handler(arguments)
    if result is not None:
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="semantic-dark-ml")
    commands = parser.add_subparsers(dest="command", required=True)

    hf = commands.add_parser("hf", help="sample a pinned Hugging Face Dataset Viewer source")
    _source_arguments(hf)
    hf.add_argument("--count", type=int, required=True)
    hf.add_argument("--size", type=int, default=96)
    hf.set_defaults(handler=_hf)

    npm = commands.add_parser("npm-svg", help="download, verify, and rasterize a pinned npm SVG package")
    _source_arguments(npm)
    npm.add_argument("--count", type=int, required=True)
    npm.add_argument("--size", type=int, default=96)
    npm.set_defaults(handler=_npm)

    synthetic = commands.add_parser("synthetic", help="generate deterministic chart images")
    synthetic.add_argument("--output", required=True)
    synthetic.add_argument("--count", type=int, required=True)
    synthetic.add_argument("--split", choices=("train", "val", "test"), required=True)
    synthetic.add_argument("--seed", type=int, default=20260717)
    synthetic.add_argument("--size", type=int, default=96)
    synthetic.set_defaults(handler=_synthetic)

    unknown = commands.add_parser("synthetic-unknown", help="generate deterministic test-only OOD resources")
    unknown.add_argument("--output", required=True)
    unknown.add_argument("--count", type=int, required=True)
    unknown.add_argument("--split", choices=("val", "test"), default="test")
    unknown.add_argument("--seed", type=int, default=20260717)
    unknown.add_argument("--size", type=int, default=96)
    unknown.set_defaults(handler=_synthetic_unknown)

    validate = commands.add_parser("validate", help="verify manifests and group/content-disjoint splits")
    validate.add_argument("--manifest", action="append", required=True)
    validate.add_argument("--verify-files", action="store_true")
    validate.set_defaults(handler=_validate)

    train = commands.add_parser("train", help="train and evaluate the deterministic tiny CNN")
    _model_arguments(train, threshold_default=0.6)
    train.add_argument("--epochs", type=int, default=12)
    train.add_argument("--learning-rate", type=float, default=1e-3)
    train.add_argument("--weight-decay", type=float, default=1e-4)
    train.add_argument("--seed", type=int, default=20260717)
    train.add_argument("--eval-split", choices=("train", "val", "test"), default="test")
    train.set_defaults(handler=_train)

    evaluate = commands.add_parser("eval", help="evaluate an existing checkpoint with OOD rejection")
    _model_arguments(evaluate, threshold_default=None)
    evaluate.add_argument("--checkpoint", required=True)
    evaluate.add_argument("--split", choices=("train", "val", "test"), default="test")
    evaluate.set_defaults(handler=_eval)
    return parser


def _source_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--sources", required=True, help="sources.v1.json")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--output", required=True, help="subdirectory inside ~/scratch-data")


def _model_arguments(parser: argparse.ArgumentParser, *, threshold_default: float | None) -> None:
    parser.add_argument("--manifest", action="append", required=True)
    parser.add_argument("--output", required=True, help="subdirectory inside ~/scratch-data")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    parser.add_argument("--threshold", type=float, default=threshold_default)


def _hf(arguments: argparse.Namespace) -> dict[str, object]:
    from .hf_source import download_hf_source
    from .source_config import HfSourceConfig, load_source

    source = load_source(arguments.sources, arguments.source_id)
    if not isinstance(source, HfSourceConfig):
        raise TypeError(f"Source {arguments.source_id!r} is not hf-viewer")
    records = download_hf_source(source, arguments.output, count=arguments.count, size=arguments.size)
    return {"source": source.id, "records": len(records)}


def _npm(arguments: argparse.Namespace) -> dict[str, object]:
    from .npm_source import download_npm_svg_source
    from .source_config import NpmSvgSourceConfig, load_source

    source = load_source(arguments.sources, arguments.source_id)
    if not isinstance(source, NpmSvgSourceConfig):
        raise TypeError(f"Source {arguments.source_id!r} is not npm-svg")
    records = download_npm_svg_source(source, arguments.output, count=arguments.count, size=arguments.size)
    return {"source": source.id, "records": len(records)}


def _synthetic(arguments: argparse.Namespace) -> dict[str, object]:
    from .synthetic import generate_synthetic_charts

    records = generate_synthetic_charts(
        arguments.output,
        count=arguments.count,
        target_split=arguments.split,
        seed=arguments.seed,
        size=arguments.size,
    )
    return {"records": len(records), "split": arguments.split, "seed": arguments.seed}


def _synthetic_unknown(arguments: argparse.Namespace) -> dict[str, object]:
    from .synthetic import generate_synthetic_unknown

    records = generate_synthetic_unknown(
        arguments.output,
        count=arguments.count,
        target_split=arguments.split,
        seed=arguments.seed,
        size=arguments.size,
    )
    return {"records": len(records), "split": arguments.split, "label": "unknown", "seed": arguments.seed}


def _validate(arguments: argparse.Namespace) -> dict[str, object]:
    from .manifest import load_manifest
    from .split_validator import validate_corpus_disjointness

    records = []
    for manifest in arguments.manifest:
        records.extend(load_manifest(Path(manifest).expanduser(), verify_files=arguments.verify_files))
    leaks = validate_corpus_disjointness(records)
    if leaks:
        raise ValueError(f"Group/content leakage detected: {leaks[:5]}")
    return {
        "records": len(records),
        "source_groups": len({record.source_group for record in records}),
        "locators": len({record.source for record in records}),
        "valid": True,
    }


def _train(arguments: argparse.Namespace) -> dict[str, object]:
    from .training import TrainConfig, train_and_evaluate

    return train_and_evaluate(arguments.manifest, arguments.output, config=TrainConfig(
        epochs=arguments.epochs,
        batch_size=arguments.batch_size,
        learning_rate=arguments.learning_rate,
        weight_decay=arguments.weight_decay,
        seed=arguments.seed,
        device=arguments.device,
        confidence_threshold=arguments.threshold,
        eval_split=arguments.eval_split,
    ))


def _eval(arguments: argparse.Namespace) -> dict[str, object]:
    from .training import evaluate_checkpoint

    return evaluate_checkpoint(
        arguments.manifest,
        arguments.checkpoint,
        arguments.output,
        split=arguments.split,
        threshold=arguments.threshold,
        device_name=arguments.device,
        batch_size=arguments.batch_size,
    )
