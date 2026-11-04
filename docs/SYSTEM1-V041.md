# System 1 integration — 0.4.1

The default extension uses the WebKit matrix and deterministic contrast/visibility
constraints. A local decision model is optional; it does not generate RGB or CSS.
The production transport is content script → service worker → loopback companion
→ an existing validated OneJev runtime. No cloud request or model download occurs.

## Run the local companion

This implementation reuses Larry's installed, instrumented OneJev runtime and
its pinned 0.8B CE+Brier seed-17 Q8 deployment. It does not vendor that runtime or
claim a portable model installer. On the verified machine:

```sh
pnpm build
node scripts/local-asset-model.mjs \
  --runtime /Users/larry_1/scratch-data/semantic-dark-input-ablation-20261021/overnight/e2e \
  --deployment /Users/larry_1/scratch-data/semantic-dark-input-ablation-20261021/overnight/e2e/deployment-new-v3.lock.json \
  --out "$HOME/scratch-data/20261104-semantic-dark-webkit/companion-manual-01" \
  --max-calls 32
```

The output directory must be new. The deployment validator checks weight and
projector hashes before loading. The companion listens only on 127.0.0.1:18949;
the reused model service uses 127.0.0.1:18948. Startup fails if the endpoints are
occupied. Stop with Ctrl-C. Existing endpoints/processes are never killed.

Reload `dist/` in the extension manager. Enable **Local logo repair** in the
popup on the intended host. The default is off. Only transparent colored logos
with a known solid local backdrop use this provider; photos and ordinary diagram
processing do not wait for it. The service worker rechecks per-host opt-in before
sending bounded 128×128 RGBA and background colors. It never sends URLs, cookies
or page DOM. Replies are checked against the caller's finite action allowlist.

## What was actually measured on 2026-11-04

Evidence is under `~/scratch-data/20261104-semantic-dark-webkit/system1-v040/`.
Nothing in the following is a held-out generalization or human-preference result.

1. Eight previously exposed public raw assets were downloaded and hashed. Their
   five candidates were rendered in headless CfT 155: keep, dim, monochrome,
   diagram palette mapping, and white backing. Prior category labels were not
   reused as action labels; assistant visual admissibility sets were frozen
   before inference. Two photos, three diagrams and three logos cover four hosts.
2. The existing adapted 0.8B model made eight real prepared-input calls. Its
   selections were admissible on all eight under those labels, versus 7/8 for
   the old baseline. The extra repair was a dark transparent SIMONS logo.
   Prepared API median was 478 ms, range 453–950 ms; these are not full-page E2E
   timings. Some diagram candidates abstain and equal keep, so selecting them is
   not a successful recoloring.
3. The restricted three-candidate 128px companion input failed to repair that
   same logo, both without and with measured contrast metadata. Preserve these
   failures; do not report the five-candidate result as proof of this input.
4. The opaque-stroke visibility constraint fixes that logo directly. The
   re-rendered candidate bank has identical source/grid PNG hashes. Against the
   new baseline, both baseline and saved model choices are admissible on 8/8:
   **zero demonstrated incremental model repairs and zero new harms on this set**.
5. Real extension E2E used the popup, the service worker, the local model and
   actual DOM writes. A real dark logo is repaired by the constraint. A generated
   brighter-color control is preserved by a cached model decision, then returns
   to the heuristic route when the popup switch is turned off. Source URLs and
   background styles restore, and no page error occurs. The cached setting-to-
   applied measurement is 86 ms; a prior uncached control request took 632 ms
   and correctly hit the deadline fallback. This is a preservation/control E2E,
   not proof of a learned quality gain or a universal 500 ms latency bound.

The model's numeric constraint miss is why the browser enforces the visibility
condition itself. Its rules inspect opaque strokes on a simple backdrop; they
do not infer arbitrary compositing or certify brand semantics. The companion is
experimental, not a new default policy. No new weights were trained in this run:
the only repair opportunity in this diagnostic was already captured by the
updated baseline. Further training requires additional independently sourced
failures of that baseline plus matched preservation cases, not repetitions of
these eight exposed assets.

## Reproduction tools

- `scripts/asset-action-bank.mjs`: bounded raw-asset bank, current production
  classifiers/executors, hashes and failure-preserving ledger; no model calls.
- `scripts/benchmark-local-decisions.mjs`: explicit validated deployment and
  frozen labels, bounded real inference, per-request timing and lifecycle logs.
- `scripts/e2e-local-model.mjs`: actual popup/provider/restore flow with a supplied
  local transparent-logo PNG. Uses a disposable headless browser profile.

These commands require explicit input/output paths, never overwrite a previous
run, and keep source data and model outputs outside Git. The ordinary `pnpm e2e`
does not require a model service and continues to exercise the default product.
