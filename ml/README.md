# semantic-dark ML experiments

This directory is an isolated `uv` project. It never writes corpora, checkpoints, or predictions into the repository: every artifact-producing command rejects output paths outside an explicit subdirectory of `~/scratch-data`.

## Install

```bash
cd ml
uv sync --extra dev
uv sync --extra corpus --extra train --extra dev
```

The first command is sufficient for dependency-light unit tests. `corpus` adds Pillow and CairoSVG; `train` adds PyTorch, NumPy, and ONNX tooling. CairoSVG also needs the system library (`brew install cairo` on macOS); the CLI automatically includes Homebrew's standard library paths.

## Build a corpus

The three npm sources in `sources.v1.json` are pinned by version, tarball URL, and registry-provided SHA-512 SRI. Beans photo and website-screenshot sources are pinned to audited 40-character HF commits for all three target splits. WebSight v0.1 remains disabled for external-license audit. The downloader checks HF HEAD both before and after download and accepts only Viewer asset URLs containing the configured SHA. If several jobs read one physical HF split, `partition_index/partition_count` gives mutually exclusive rows; corpus validation is stricter and prevents an upstream `source_group` or normalized PNG SHA from crossing target splits.

This small smoke corpus is intentionally not a quality benchmark, but it gives every train/val/test split all four known labels:

```bash
ROOT=~/scratch-data/semantic-dark-corpus-smoke

for source in hf-beans-photo-train hf-beans-photo-val hf-beans-photo-test \
              hf-website-screenshot-train hf-website-screenshot-val hf-website-screenshot-test; do
  uv run semantic-dark-ml hf --sources sources.v1.json \
    --source-id "$source" --count 6 --output "$ROOT"
done

for source in material-icons-train fontawesome-solid-val lucide-static-test; do
  uv run semantic-dark-ml npm-svg --sources sources.v1.json \
    --source-id "$source" --count 6 --output "$ROOT"
done

uv run semantic-dark-ml synthetic --split train --count 6 --seed 101 --output "$ROOT"
uv run semantic-dark-ml synthetic --split val   --count 6 --seed 102 --output "$ROOT"
uv run semantic-dark-ml synthetic --split test  --count 6 --seed 103 --output "$ROOT"
uv run semantic-dark-ml synthetic-unknown --split val  --count 32 --seed 104 --output "$ROOT"
uv run semantic-dark-ml synthetic-unknown --split test --count 32 --seed 105 --output "$ROOT"

MANIFEST_ARGS=()
while IFS= read -r manifest; do
  MANIFEST_ARGS+=(--manifest "$manifest")
done < <(find "$ROOT" -name manifest.jsonl -print | sort)

uv run semantic-dark-ml validate --verify-files "${MANIFEST_ARGS[@]}"
uv run semantic-dark-ml train --device cpu --epochs 1 --batch-size 8 \
  --threshold 0.60 "${MANIFEST_ARGS[@]}" \
  --output ~/scratch-data/semantic-dark-runs/smoke-001
```

Each source writes a source-local `manifest.jsonl` and normalized 96×96 RGBA PNGs. Records retain the exact row/member locator, upstream `source_group`, raw asset SHA-256, and normalized PNG SHA-256. Train with multiple manifests directly; no repository-local merged data tree is needed.

## Validate, train, and evaluate

Use the same repeated `--manifest` form for longer runs. Training refuses to create artifacts unless both train and val contain all four known labels and the combined manifests are group- and normalized-content-disjoint.

The depthwise-separable model consumes all four RGBA channels and predicts four known classes: `photo`, `icon`, `diagram`, and `screenshot`. Manifest label `unknown` is reserved for OOD calibration. It is excluded from training and contributes to false-accept rate under the configured confidence threshold.

`synthetic-unknown` accepts only `val` or `test` and rejects `train`. Use val OOD to tune the confidence threshold, then report false-accept rate once on the independent test OOD set. It deterministically covers transparent/near-empty inputs, flat colors, low-contrast gradients, checker patterns, and noise textures; these are rejection probes, never a fifth training class. Validation accuracy is still computed on known labels only.

Training writes `checkpoint.pt`, `predictions.jsonl`, `metrics.json`, and normally `model.onnx` plus `model.contract.json`. Export success requires `onnx.checker`; the contract pins RGBA NCHW float input range/shape, label order, confidence threshold, opset, and model SHA-256. If the exporter is unavailable, `metrics.json` records `onnx.status = "failed"` and `onnx_export_error.txt` contains the concrete exception.

ONNX Runtime versus browser-runtime numerical parity is not yet automated. That is a required gate before integrating a trained model into the extension, but it does not block this standalone experiment scaffold.

## Source licenses

The source manifest pins both revision and declared license. The v1 corpus uses
[Material Design Icons](https://github.com/google/material-design-icons)
(Apache-2.0), [Font Awesome Free](https://fontawesome.com/license/free)
(icons CC BY 4.0; code MIT), [Lucide](https://lucide.dev/license) (ISC),
[Beans](https://huggingface.co/datasets/AI-Lab-Makerere/beans) (MIT), and the
[website screenshots dataset](https://huggingface.co/datasets/Zexanima/website_screenshots_image_dataset)
(MIT). These downloaded assets are experiment inputs only and are not bundled
with the extension or committed to this repository.
