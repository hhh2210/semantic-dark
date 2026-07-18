# M1 report: paired-theme baseline and M2 decision

## Decision

**NO-GO for M2 under metric spec v1.**

The three reference systems completed reproducibly, but the single combined
Carbon/Fluent held-out exposure failed during Carbon source normalization,
before either held-out system produced an `E_s`. The preregistered M2 condition
`I_s >= 10%` separately on Carbon and Fluent is therefore not evaluable. The
exclusive exposure receipt remains in place, so the selector cannot be repaired
and rerun under the same protocol.

This is a valid negative experiment outcome, not evidence that the unchanged
color engine transfers to Carbon or Fluent.

## Frozen experiment identity

- M0 engine: `de53f773963af17c889054c690c4f79cf8fd7d12`
- M0 ROLE_PROFILES canonical SHA-256:
  `e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5`
- Metric freeze commit: `af06f6e27ad29f995723b40587e4cfbfa52045f8`
- Metric spec SHA-256:
  `3cdc696270917f080e1c8d7cbcd5954dc50b31b598205b0204fe2be48168089d`
- Runtime: Google Chrome 150.0.7871.129, Node v26.5.0, sRGB,
  1280×900 at 1×
- Each valid system used 4 scenes, 15 paints per variant, 45 computed-style
  observations, 10 reviewed D rows, 6 C rows, and 3 R pairs. Two independent
  browser launches reproduced exactly.

The normative formulas, rational `1:1:1` weights, aggregation cells, safety
thresholds, 50-row identity, M2 gate, source revisions, and implementation pins
are in `fixtures/evaluation/metric-spec.v1.json`. They were committed before the
held-out attempt.

## Per-system results

| System | Split | Status | D ↓ | C ↓ | R ↓ | E ↓ | PairScore ↑ | I ↑ | F | H3/H2/H1 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Material | reference | valid | 0.6292 | 0.5026 | 0.0000 | 0.3773 | 62.2718 | N/A | 0 | not run |
| Primer | reference | valid | 0.7458 | 0.7198 | 0.0000 | 0.4885 | 51.1458 | N/A | 0 | not run |
| Spectrum | reference | valid, baseline-open finding | 0.7191 | 0.5028 | 0.1667 | 0.4628 | 53.7168 | N/A | 1 | not run |
| Carbon | held-out | invalid before render | — | — | — | — | — | invalid | — | not run |
| Fluent | held-out | not evaluated; combined receipt spent | — | — | — | — | — | invalid | — | not run |

The descriptive three-reference macro is `D=0.6980`, `C=0.5751`, `R=0.0556`,
`E=0.4429`, and `PairScore=55.7115`. It is not gate-eligible and cannot hide a
system-specific regression.

`I` is not applicable for a baseline-only endpoint because there is no M2
candidate error. The manual H3/H2/H1 sentinel was not run in this paired-theme
evaluation. Its null state must not be read as zero findings.

Spectrum has one existing automatic finding:

```text
surface.card-to-raised separation 1.11995003 < 1.12000000 required minimum
```

It is recorded as `baseline-open`, not a candidate regression. Spectrum also
has one authored-tie mismatch: its table header intentionally shares the canvas
surface while the baseline mapper imposes a distinct hierarchy.

## Per-system provenance

| System | Frozen source | Protocol ID / SHA-256 | Normalized tokens | Result / metric payload | Run state |
|---|---|---|---|---|---|
| Material | `@material/material-color-utilities@0.4.0` | `material-tonal-spot-2021-v1` / `5a726a10…f319f4b4` | `36c230b6…9a208ca` | `db939354…698c1c` / `bfd44f40…f5dbcf` | exact; clean |
| Primer | `@primer/primitives@11.9.0` | `primer-primitives-11.9.0-v1` / `b7a78537…ff36ed` | `25b20161…279f9dc` | `f8bed0e6…bf5b8` / `91f48ae5…32f19` | exact; clean |
| Spectrum | `@adobe/spectrum-design-data@0.12.0` | `spectrum-design-data-0.12.0-v1` / `30e4c84f…e5bfe` | `654fbd12…ec889a` | `6be83964…b2201e` / `57a4516c…0a37ac` | exact; clean |
| Carbon | `@carbon/themes@11.77.0` | `carbon-themes-11.77.0-white-g100-v1` / `f302614f…7f6bc` | unavailable | unavailable | invalid; clean at claim |
| Fluent | `@fluentui/react-theme@9.2.1` | `fluent-react-theme-9.2.1-web-v1` / `e1297759…99a4f` | unavailable | unavailable | not reached; clean at claim |

The reference runner's raw split label is `development`; `reference` is the
experiment role used by metric spec v1. Full source integrity strings,
repositories, licenses, unabridged hashes, browser/viewport, record-set hashes,
and per-system worktree state are embedded in the aggregate JSON. The raw
reference artifacts remain the authoritative source for those three valid
runs.

## Held-out exposure outcome

The exposure receipt was created at `2026-07-18T17:04:33.565Z` for exactly one
logical Carbon+Fluent evaluation, with two reproducibility launches planned per
system. Its SHA-256 is
`89994ad729a4a44772891bc0fbc82e552a6e1926278c22014d536defb01bffae`:

```text
~/scratch-data/semantic-dark-pairs/.exposure/
3cdc696270917f080e1c8d7cbcd5954dc50b31b598205b0204fe2be48168089d.json
```

The one-shot command exited 1 with this captured CLI error:

```text
carbon.white.notificationBackgroundError is not a CSS color
```

The command's stderr was not redirected to an immutable raw file before the
attempt. The error above is therefore a post-attempt transcription from the
captured Codex exec output, not an independently hashed raw failure log. The
receipt proves the exposure claim and no-rerun obligation; it does not contain
the error or failure phase.

At `2026-07-18T17:17:35Z`, a read-only filesystem check found only an empty
`heldout/carbon/` directory and zero metric files. The captured error and empty
tree support failure during Carbon source normalization before render or metric
calculation. The pinned synchronous runner order implies Fluent was not reached,
but that is a code-path inference rather than an independent runtime trace.

The source adapter used a selector name committed before package-export access.
Changing it after this error would be outcome-conditioned adapter tuning. The
receipt therefore remains intact and both held-out systems are spent for metric
spec v1. This evidence is sufficient to enforce no rerun, but insufficient for
any Carbon or Fluent score.

The local pnpm policy preflight had materialized the pinned package tarballs at
`2026-07-19T00:39:16+08:00`; this was recorded before the freeze. No held-out
export, token value, render, or metric had been read at that point. The actual
one-way exposure boundary was the guarded package-export import above.

## Residual-error classification

1. **Source normalization / schema coverage — blocking.** The Carbon adapter's
   preregistered semantic selector did not resolve in the pinned export. This is
   an evaluator contract failure, not a measured palette error. It prevents any
   held-out transfer claim.

2. **Role-conditioned color distance — large across all references.** `D` is
   0.63–0.75. The unchanged role profiles do not reproduce authored dark
   lightness/chroma choices closely, so deterministic profile tuning could still
   be technically relevant.

3. **Contrast relationship — system-dependent.** Primer's `C=0.7198` is much
   worse than Material/Spectrum at about 0.50. A single aggregate objective
   could improve Material-like behavior while worsening Primer; per-system
   non-regression remains necessary.

4. **Surface semantics — genuine design-system disagreement.** Material and
   Primer preserve the three frozen rank pairs, while Spectrum contributes a
   tie mismatch (`R=0.1667`). The authored answer is not universal: some systems
   deliberately tie a table header to the canvas while others elevate it.

5. **Safety sentinel — one narrow baseline boundary.** Spectrum's 1.119950
   surface separation misses the frozen 1.12 floor by about 0.00005. No text,
   required non-text, or rank-reversal failures appeared in the three valid
   references. This is an engineering sentinel only, not statistical evidence
   of a low web-wide failure rate.

## Why M2 cannot start

M2 requires both held-out systems to have valid baseline and candidate errors,
reach `I_s >= 10%` independently, avoid any D/C/R regression, and introduce no
new or worsened F/H2/H3 finding. With no Carbon or Fluent baseline `E_s`, all of
those confirmatory conditions are untestable.

There is also a protocol-level consequence: the goal required Carbon/Fluent to
be exposed during M1, whereas the original M2 narrative expected them to remain
untouched until candidate confirmation. After this M1 attempt they cannot be
reused as independent M2 holdouts even if the adapter is later repaired.

A future experiment must either:

- treat Carbon and Fluent as development systems, create metric spec v2, and
  reserve genuinely untouched design-system families for confirmation; or
- stop at the unchanged deterministic baseline.

No ROLE_PROFILES tuning, M3 work, model training, site-specific rules, or
held-out rerun was performed in this goal.

## Artifacts

- Aggregate JSON: `artifacts/paired-theme/m1-baseline.v1.json`
- Aggregate HTML: `artifacts/paired-theme/m1-baseline.v1.html`
- Material raw run: `~/scratch-data/semantic-dark-pairs/frozen-af06f6e/material`
- Primer raw run: `~/scratch-data/semantic-dark-pairs/frozen-af06f6e/primer`
- Spectrum raw run: `~/scratch-data/semantic-dark-pairs/frozen-af06f6e/spectrum`
- Failed held-out attempt directory:
  `~/scratch-data/semantic-dark-pairs/frozen-af06f6e/heldout`
