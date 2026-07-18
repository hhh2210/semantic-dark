# Vision routing benchmark v1

This is an engineering decision experiment, not a claim of production-grade
generalization. It asks two separate questions:

1. Which known route is appropriate: photo, icon, diagram, or screenshot?
2. Is the asset sufficiently in-distribution to act on, or should the extension
   abstain?

The table below records the audited v1 run. Raw corpora, checkpoints, and
prediction files are deliberately excluded from Git and remain under
`~/scratch-data`; the repository contains the loaders, source pins, validation
rules, metrics code, and both runnable routers. After building manifests as
described in [ml/README.md](ml/README.md), the command surfaces are:

```bash
pnpm benchmark:vision --manifest /path/to/manifest.jsonl --output ~/scratch-data/semantic-dark-runs/heuristic
pnpm benchmark:feature-router --manifest /path/to/manifest.jsonl --output ~/scratch-data/semantic-dark-runs/feature-router
```

Repeat `--manifest` for every source-local manifest. The recorded identity
digest below is the guard for comparing a rebuilt run with v1; upstream dataset
availability and decoder versions can still affect a future rebuild.

## Corpus and protocol

The corpus contains 704 normalized 96×96 RGBA images:

| Role | Train | Validation | Test | Source strategy |
|---|---:|---:|---:|---|
| Photo | 48 | 48 | 48 | Beans official splits, MIT |
| Icon | 48 | 48 | 48 | Material / Font Awesome / Lucide packages |
| Diagram | 48 | 48 | 48 | independent deterministic chart seeds |
| Screenshot | 48 | 48 | 48 | website-screenshot official splits, MIT |
| Unknown/OOD | 0 | 64 | 64 | independent transparent/flat/gradient/checker/noise seeds |

Every record stores its immutable locator, declared source group, upstream raw
SHA-256, normalized PNG SHA-256, revision, and license. Validation rejects a
source group or either content hash crossing target splits. All three predictors
were evaluated on the same test identity digest:
`6748ed5fbe0917f2c7d5c66fb9245bc43cb3d2de4d589352b1c70f78822a00eb`.

Each predictor first emitted an unthresholded prediction-v2 file. Its operating
threshold was selected using validation only: among thresholds with validation
OOD false-accept rate at most 5%, maximize known-class macro-F1, then coverage.
That frozen threshold was applied once to test. Abstentions count as false
negatives in macro-F1.

## Result

| Predictor | Val-selected threshold | Test macro-F1 | Known coverage | Accuracy among accepted | Test OOD FAR |
|---|---:|---:|---:|---:|---:|
| Heuristic only | 0.6672 | 0.6941 | 78.65% | 86.09% | 1.56% |
| Tiny CNN only | 0.9334 | 0.5856 | 51.04% | 100.00% | 7.81% |
| Linear feature router only | 0.2015 | 1.0000 | 100.00% | 100.00% | 9.38% |
| Heuristic gate + CNN route | 0.6672 | 0.8545 | 78.65% | 99.34% | 1.56% |
| Heuristic gate + feature route | 0.6672 | **0.8622** | **78.65%** | **100.00%** | **1.56%** |

Per-class test F1 shows where the hybrid helps:

| Predictor | Photo | Icon | Diagram | Screenshot |
|---|---:|---:|---:|---:|
| Heuristic | 0.907 | 1.000 | 0.189 | 0.680 |
| Tiny CNN | 0.000 | 0.909 | 0.500 | 0.933 |
| CNN hybrid | 0.946 | 1.000 | 0.588 | 0.884 |
| Feature hybrid | **0.957** | **1.000** | **0.609** | **0.884** |

The CNN has 14,180 trainable parameters. Its checked opset-17 ONNX file is
70,831 bytes with SHA-256
`e7121f83efcc60f2ac1e8c3e23eb8871b2806f310052cff738da815c913d6ed4`.
At threshold zero it reached 99.48% known test accuracy and 100% OOD false
acceptance. Raising softmax confidence enough to satisfy validation OOD did not
transfer to the independent test OOD set; it rejected all photos while still
accepting 7.81% of unknowns, above the 5% operating target.

The lightweight alternative projects the existing bounded pixel statistics to
20 features, then applies a 4×20 linear softmax router. Its complete standalone
model has 284 numeric parameters (including standardization and experimental
OOD geometry), serializes to 5,834 bytes, and runs in about 0.173 ms mean / 0.267
ms p95 in the pixel-only Node measurement. It routed all known test samples
correctly, but its own OOD gate also missed the 5% target at 9.38%. Using only
its class route behind the original heuristic gate retained the gate's 1.56%
FAR and slightly outperformed the CNN hybrid without an ONNX runtime.

## Decision

- Do not integrate the pure CNN. Closed-set accuracy is not a safety signal.
- Prefer the lightweight hybrid direction for the next experiment:
  deterministic/contextual logic decides whether an image is safe to touch; a
  tiny learned feature router may classify accepted assets.
- Do not bundle ONNX Runtime. The 5.8 KB router matched or exceeded the CNN
  hybrid in this corpus, but remains offline until it survives real cross-site
  and perceptual-near-duplicate evaluation.
- Keep deterministic color and contrast solvers as the final rendering boundary.

## Limits

- Photo and screenshot splits are official splits from the same dataset family;
  source groups and exact hashes are disjoint, but author/site/style leakage and
  perceptual near-duplicates have not been fully audited.
- Nine exact screenshot duplicate pairs remain within individual splits. A
  hash-deduplicated audit left the predictor ordering unchanged, but future
  benchmarks should deduplicate before sampling.
- Diagrams and OOD probes are synthetic. They expose routing and rejection
  failures but do not represent the variety of production web assets.
- The test OOD set was regenerated after an audit found repeated blank images.
  All post-fix thresholds still use validation only, but this is an adaptive
  engineering holdout rather than a pristine external test set.
- The feature heuristic's normalized rule scores and the CNN's softmax
  probabilities have different semantics, so their ECE/Brier values should not
  be compared directly.
- Pixel-classifier latency excludes DOM resize/decode, ONNX runtime startup, and
  browser backend costs. The model remains an offline experiment.
