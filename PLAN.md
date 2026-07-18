# Semantic Dark development plan

This document explains why the project exists, why neither more hard-coded
rules nor a large screenshot corpus is the immediate answer, and what evidence
is required before a device-side model is allowed to affect rendering.

Current shipped behavior is documented in [README.md](README.md). The frozen
vision-routing experiment is documented in [BENCHMARK.md](BENCHMARK.md), and
the extension's data boundary is documented in [PRIVACY.md](PRIVACY.md).

## Executive decision

We will **not** build a large paired-webpage dataset now.

The next milestone is a small, reproducible testbed that answers one narrower
question: can authored light/dark design decisions improve the current semantic
color map without weakening readability or no-op behavior?

The initial ceiling is deliberately small:

- at most 24 rendered component/state scenes;
- at most 50 hand-reviewed paint decisions;
- three permissively licensed design systems as references;
- two different design systems held out from tuning;
- about 12 real pages used only as black-box regression cases;
- no full-page crawl and no expansion of the existing raster corpus.

Most reference rows will be extracted automatically from design tokens and
computed styles. Raw third-party pages, authenticated sessions, and redistributable
screenshot archives are not part of the dataset. Generated screenshots and run
artifacts stay under `~/scratch-data/semantic-dark-pairs`; Git contains only
small fixtures, source pins, schemas, and aggregate results.

We first tune the existing deterministic role profiles. A learned model is an
optional later experiment, not the starting point.

Source intake is staged rather than parallel. M1a completes one end-to-end
vertical slice using Material Color Utilities only. Primer and Spectrum are
admitted in that order only after the preceding slice reproduces from a clean run. Carbon and Fluent remain
sealed until the evaluation protocol and one candidate are committed.

## How we arrived here

### 1. Simple inversion solves the wrong problem

The same source color can mean page canvas, elevated surface, primary text,
disabled text, border, brand accent, chart series, photograph, or a white
backdrop baked into a diagram. The correct target therefore depends on context:

```text
target = f(source color, semantic role, effective backdrop, state, neighbors, media kind)
```

It is not `1 - RGB`. Whole-page filters and browser force-dark heuristics can be
fast, but they cannot reliably preserve all of those relationships. The table
and diagram regressions that motivated this project are examples: nominally
"white" regions needed different actions because some were surfaces, some were
text halos, and some were pixels inside an asset.

### 2. Rules are necessary but not sufficient

Semantic Dark already splits the problem by representation:

- [native-dark detection](src/content/native-dark.ts) decides whether automatic
  mode should do nothing;
- [DOM style mapping](src/content/dom-style-mapper.ts) handles text, surfaces,
  borders, gradients, and generated content;
- [SVG transformation](src/svg/transform.ts) interprets paint relationships;
- [raster routing](src/vision/classifier.ts) distinguishes photo, icon, diagram,
  screenshot, and unknown content;
- [the color solver](src/color/dark-map.ts) maps roles in OKLCH and enforces
  contrast.

This structure is valuable. Contrast floors, exact restore, native-dark bypass,
and abstention are product invariants, not training targets. However, the current
role profiles still contain manually selected lightness spans and chroma scales.
Adding a special case for every observed site would eventually create an
unmaintainable site-rule database without teaching us which general decision was
wrong.

### 3. A device model does not remove the need for semantics

The existing offline experiment already tested a tiny CNN and a 5.8 KB linear
feature router for **raster asset routing**. It found that a learned router can
help behind a deterministic safety gate, while closed-set accuracy alone is a
poor rejection signal. That result does not solve DOM palette selection: the
model predicts image kind, not whether a CSS color is a canvas, selected row,
secondary label, or brand accent.

Chromium's Auto Dark work points in a similar direction: deterministic color
transforms are combined with a small image-classification decision rather than
an end-to-end generative recolorer. Chromium also removed the broader browser
feature project after it did not reach a successful product outcome, while
retaining narrower WebView support. The lesson is not that automatic dark mode
is impossible; it is that low-frequency destructive errors dominate at browser
scale. See the [Chromium project-removal commit](https://github.com/chromium/chromium/commit/ada176c4ce97be7a583312daf5c36162259911e4).

### 4. Authored light/dark pairs are useful, but full pages are noisy labels

Mature design systems usually map stable semantic tokens across themes. Those
pairs reveal useful choices such as surface rank, text hierarchy, state
separation, and accent preservation.

A complete light-page/dark-page screenshot pair is not equally clean evidence:

- the dark version may change layout, shadows, assets, or information density;
- hover, focus, loading, consent, time, locale, and authentication states drift;
- a single light color may intentionally map to several dark colors by role;
- raw pages and screenshots create licensing, privacy, and reproducibility work;
- random node or screenshot splits leak the same brand and component family;
- more pixels do not fix unsupported canvas, closed shadow roots, or CSS access.

Therefore authored pairs are a **reference and evaluation signal**, not a
pixel-to-pixel ground truth dataset.

## Product invariants

These constraints remain deterministic even if a model is introduced later:

1. Pages with a coherent authored dark appearance remain untouched in automatic
   mode.
2. Supported text reaches at least 4.5:1 contrast against its effective
   backdrop.
3. Important non-text paint reaches at least 3:1 where that requirement applies.
4. Mapped surfaces retain authored ordering and at least the configured 1.12:1
   separation from the canvas.
5. Unknown or unsafe content may abstain. Coverage is not more important than
   avoiding destructive transformations.
6. Every extension-owned mutation is reversible when the site is disabled,
   changes theme, or becomes natively dark.
7. Page DOM, text, and pixels remain local. The shipped extension has no
   training upload or behavioral telemetry.

Pair agreement, hue similarity, visual comfort, and coverage are optimization
goals. They can never override the invariants above.

## Target architecture

The model, if justified, classifies intent. It never owns the final color:

```text
authored/native-dark gate
          |
          v
deterministic safety and support checks
          |
          v
semantic role or action
  keep / map / dim / diagram / abstain
          |
          v
candidate palette or surface rank
          |
          v
deterministic OKLCH, gamut, contrast, and hierarchy solver
          |
          v
reversible DOM / SVG / raster writer
```

This division makes a wrong semantic prediction recoverable: the solver can
reject or correct an unsafe candidate, and low confidence can fall back to the
current engine.

## Minimal testbed

The testbed has three layers. Only the middle layer is used to tune palette
behavior.

| Layer | Purpose | Initial size | Used for training? | Stored in Git? |
|---|---|---:|---|---|
| Mechanism fixtures | Prove CSS, pseudo, state, SVG, contrast, and restore behavior | existing suite plus up to 8 reduced regressions | No | Yes, self-authored fixtures only |
| Authored theme references | Compare semantic light/dark choices | up to 24 component/state scenes and 50 reviewed paint decisions | Parameter tuning only | Schema, generators, pins, and aggregate metrics |
| Real-page pilot | Catch deployment harm and native-dark false activation | about 12 pages | No | URLs/metadata or reduced fixtures; raw captures stay local |

### Reference sources

The first pass uses permissively licensed, reproducible sources:

- [Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
  for generated scheme relationships;
- [Primer Primitives](https://github.com/primer/primitives) for semantic token
  pairs;
- [Spectrum design data](https://github.com/adobe/spectrum-design-data) for
  theme-aware design tokens.

[Carbon themes](https://carbondesignsystem.com/elements/themes/overview/) and
[Fluent color tokens](https://fluent2.microsoft.design/color-tokens/) are held
out from tuning. They answer whether a change transfers across design-system
families rather than memorizing the three references.

The initial component families are page canvas, card, table, navigation,
button, input, code block, alert, dialog, tooltip, selected/disabled state, and
a small chart legend. Each scene contains neutral, self-authored content and
only the minimum states needed to expose a distinct semantic mapping.

### Minimal record

We do not need a serialized page. A useful paint-pair row is approximately:

```text
source revision + design system + component family + state
semantic role + CSS property + source color + effective backdrop
authored dark color/action + pairing confidence + license
```

Computed screenshots are debugging artifacts, not the primary data structure.
The paired unit is a semantic token or paint role whenever possible.

### Split rule

The split unit is the complete design-system family. Equivalent component
families appear across systems so transfer can be measured, but scenes, states,
stylesheets, aliases, and tokens from one system never cross splits. Primer,
Material, and Spectrum are tuning references; Carbon and Fluent are sealed
evaluation systems. Split membership, exclusions, source revisions, and record
identities are frozen before profile tuning. Random screenshot or DOM-node
splits are forbidden because they overstate generalization.

## Milestones and stop conditions

### M0 — Freeze runtime safety and the unchanged color baseline

Deliverables:

- record `pnpm verify` and `pnpm e2e` results from one pinned commit;
- reduce the reported table/white-band failures into self-authored fixtures;
- freeze the baseline commit and the exact `ROLE_PROFILES` values and hash;
- freeze mechanism-fixture and real-page pilot IDs, viewport, states, expected
  native-dark decision, and primary task before inspecting a candidate;
- record contrast, restore, native-dark, and performance outcomes that the
  current runtime can already measure.

Pair agreement is deliberately not recorded in M0 because the evaluator does
not exist yet. The frozen objects are the commit, parameters, cases, and runtime
safety results. Every later experiment must run against those same objects and
report both improvements and regressions.

### M1a — Complete one-source vertical slice

Using only a pinned Material Color Utilities release and an explicit frozen
seed/scheme configuration:

- render four to six representative component/state scenes;
- extract and review no more than 12 paint decisions;
- collect computed style for target nodes and `::before`/`::after` where used;
- run the unchanged baseline profiles and produce a JSON/HTML report;
- prove that a clean rerun reproduces record IDs and metrics exactly.

This slice is allowed to refine the normalized pair schema and metric
implementation. It is not allowed to tune `ROLE_PROFILES` or inspect Carbon or
Fluent target results.

Gate: do not add another token schema until the Material slice has no unresolved
pairing, reproduction, or license ambiguity.

### M1b — Normalize the remaining tuning sources

Add Primer and then Spectrum through source-specific adapters rather than
assuming their token schemas or pairing semantics are interchangeable with
Material. Expand
only to the existing ceilings of 24 scenes and 50 reviewed decisions. At least
20 decisions are assigned to the sealed Carbon/Fluent evaluation before their
candidate outcomes are viewed; the remainder may be used for tuning diagnostics.

No parameter search occurs in M1b. The purpose is to demonstrate that all
sources normalize into the same semantic record contract without changing the
meaning of a role, state, exclusion, or missing value.

### M1c — Preregister the metric contract and seal evaluation

Before the first parameter search or held-out scoring run, commit a versioned
protocol block in the paired-theme manifest. It contains:

- baseline commit and exact `ROLE_PROFILES` values/hash;
- source revisions, split membership, record IDs, exclusions, and role/state
  coverage;
- the primary formula, aggregation units and reducers defined below;
- handling for abstention, missing records, ties, alpha compositing, and empty
  cells;
- every secondary metric, non-inferiority margin, harm label, and M2 decision
  threshold;
- the real-page cases, states, tasks, and blind-review procedure.

The protocol commit hash becomes part of every result. After held-out scoring,
its formulas, reducers, thresholds, exclusions, and labels cannot change. A
necessary change creates a new protocol version, invalidates the old comparison,
and requires a genuinely untouched held-out family; it cannot be used to rescue
the current candidate.

### Preregistered authored-pair metric

The confirmatory endpoint is a preregistered composite with fixed normalization,
equal weights, and aggregation order. It is computed separately for each design
system `s`; no weight or threshold may change after the metric-spec commit. All
colors below mean the effective rendered paint after alpha compositing against
the recorded backdrop:

```text
d_i = min(Euclidean OKLab distance(candidate_i, authored_dark_i) / 0.10, 1)
c_i = min(abs(log2(candidate contrast_i / authored contrast_i)), 1)
r_i = 0 for preserved surface order, 0.5 for a frozen-epsilon tie, 1 for inversion

D_s = macro mean of median(d_i): decisions -> scenes -> roles -> system s
C_s = macro mean of median(c_i): applicable decisions -> scenes -> roles -> system s
R_s = mean(r_i): ordered pairs -> scenes -> system s
E_s = (D_s + C_s + R_s) / 3
PairScore_s = 100 * (1 - E_s)
I_s = (E_s_baseline - E_s_candidate) / E_s_baseline
```

Baseline and candidate use identical record IDs. An abstention is scored as the
actual unchanged source paint. An extraction failure or missing candidate record
is a hard failure and may not be silently dropped. Empty cells and the role list
are resolved and committed before scoring. If `E_s_baseline` is zero, the
candidate `E_s` must also be zero and `I_s` is reported as not applicable.

The component losses remain mandatory report columns and non-regression gates;
the composite may not trade a worse component or design system for a better one:

- `contrast_error`: median `abs(log2(candidate contrast / authored contrast))`,
  macro-aggregated with the same frozen cells;
- `surface_rank_inversion_rate`: the fraction of preregistered comparable
  surface pairs whose candidate lightness order disagrees with the authored dark
  order, using the frozen tie epsilon;
- `accent_hue_error`: median circular hue error for records above the frozen
  chroma eligibility threshold;
- hard contrast, native-dark, restore, and surface-separation failure counts.

Every report shows `D_s`, `C_s`, `R_s`, `E_s`, `PairScore_s`, `I_s`, and all
safety metrics for each design system separately. An equal-weight system macro
may be shown as a summary, but
it is descriptive only. Paint-row micro averages never select a candidate, and
an improvement on one system cannot cancel a regression on another.

### Harm taxonomy and small-sample interpretation

The 50 reviewed decisions and 12 pages are a frozen engineering sentinel, not
an estimate of the web-wide failure rate. A page is one clustered case no
matter how many nodes or screenshots it contains; its outcome is its worst
observed severity.

| Level | Operational definition | Gate |
|---|---|---|
| `F` invariant failure | Automatic mode changes native-dark/forced-colors content; supported text falls below 4.5:1; required non-text or focus paint falls below 3:1; surface separation falls below 1.12:1; exact restore, layout, interaction, or mutation handling breaks | Any candidate-caused case vetoes the candidate |
| `H3` destructive | Primary content/control disappears or becomes unusable; status/chart meaning changes; protected media, logo, QR, or CAPTCHA is destructively recolored | Any new or worsened case vetoes the candidate |
| `H2` major | The main task remains possible, but primary table hierarchy, focus/selected/disabled state, diagram tracking, or a large bright region is bad enough that a user must disable the extension | Any new or worsened case in the sentinel vetoes the candidate |
| `H1` minor | Local aesthetic or hue/chroma regression without loss of meaning, readability, or interaction | Report separately; does not alone prove a safety failure |
| `H0` none | Equivalent to or better than the baseline | Pass |

A candidate-caused regression means its severity exceeds the pinned baseline,
or the affected scope materially expands at the same `H2`/`H3` level. A baseline
problem that does not worsen is recorded as `open-existing`, not hidden as a
candidate regression. Each reviewed decision is labeled before tuning with its
expected role/action; A/B order is blinded, and every suspected `F`, `H2`, or
`H3` receives a second review.

Zero severe failures in this panel means only "no veto was observed in the
frozen sentinel." It is not statistical evidence of a low population harm rate
and must not be described as significant or as generalizing across the web.

### M2 — Tune the deterministic role profiles

First compare the current hand-set values in
[`ROLE_PROFILES`](src/color/dark-map.ts) with a small parameter search or robust
regression. The search may adjust role lightness bands and chroma retention, but
the contrast and hierarchy solver remains fixed.

Candidates are selected using only Material, Primer, Spectrum, and mechanism
fixtures. After the candidate parameters and decision rule are committed, the
baseline and candidate are evaluated together once on Carbon, Fluent, the
sealed reviewed decisions, and the real-page pilot.

A candidate advances only if it:

- has zero new `F`, `H2`, or `H3` regression;
- reaches `I_s >= 10%` separately on Carbon and on Fluent;
- has no regression in any of `D_s`, `C_s`, or `R_s` separately on either
  held-out system;
- improves at least one original failure fixture without a site-specific rule.

If systems disagree or a gate is missed, the result is inconclusive or negative:
keep the existing profiles and classify the residual errors. A held-out failure
must not trigger same-protocol retuning against that system. It is evidence that
the candidate did not generalize.

### M3 — Decide whether a tiny semantic router is justified

This milestone is conditional. It begins only if M2 shows that a meaningful
share of remaining failures are repeated **role/action classification errors**.
It does not begin for failures caused by unsupported CSS, canvas, inaccessible
assets, or incorrect mutation handling; those require engineering fixes.

Start with logistic regression or another small structured-feature model. A
model may use source OKLCH, alpha, effective backdrop, property kind, tag/ARIA
role, geometry, pseudo/state flags, and bounded ancestor/sibling statistics. It
must not consume page text, user input, URL queries, or a full DOM serialization.

It is eligible for shadow-mode integration only when all are true:

- at the same harmful-action rate, correct-action coverage improves by at least
  5 percentage points over the deterministic baseline;
- the sealed held-out systems and real-page pilot both improve;
- the serialized model is at most 50 KB and classifier-only p95 is below 1 ms
  on the target Chrome setup;
- low confidence abstains, and every accepted output still passes the existing
  solver;
- removing the model returns exactly to deterministic behavior.

If a linear/small model cannot clear this bar, do not try a larger network on
the same evidence. Revisit the representation or keep the deterministic path.

### M4 — Shadow mode, then a narrow pilot

In shadow mode, the device model records only local debug comparisons and does
not change page output. It runs for at least one development cycle so systematic
cross-site errors can be inspected before activation.

Gated rendering requires a kill switch, deterministic fallback, per-site
override, exact restore, and unchanged native-dark behavior. Chrome Web Store
packaging and public promotion begin only after the real-page pilot has no open
high-severity readability regression.

## Scorecards

Two scorecards prevent a common mistake: matching an authored dark theme is not
the same as safely darkening an arbitrary light-only site.

### Authored-pair agreement

- per-system `D_s`, `C_s`, `R_s`, `PairScore_s`, and relative error reduction;
- per-system hard contrast results;
- per-system surface-rank and state-separation results;
- per-system brand/accent hue error;
- correct recognition of `keep` or asset-swap cases.

This score diagnoses palette quality. It does not gate deployment by itself.

### Light-only deployment safety

- hard contrast violations;
- harmful-action rate and abstention/coverage tradeoff;
- native-dark false activations;
- unresolved bright regions in non-media surfaces;
- exact restoration after disable/theme change;
- activation, interaction, worker, memory, and bundle-size deltas;
- blind preference on the small reviewed failure set.

This score gates runtime changes.

## Reporting contract

Every result includes one row per design system before any equal-weight macro
summary:

| System | Split | Records/cells | `D_s` | `C_s` | `R_s` | `PairScore_s` | `F/H3/H2/H1` |
|---|---|---:|---:|---:|---:|---:|---|

The report also lists component/state denominators, abstentions, missing records,
exclusions, and raw sentinel counts (`better`, `equivalent`, `H1 worse`, `H2+`
`worse`). Confidence intervals may be descriptive where meaningful, but this
small clustered panel is not used to claim statistical significance. Material,
Primer, Spectrum, Carbon, and Fluent are never represented only by a pooled
score.

## Explicitly deferred

The following are out of the current data and model plan:

- end-to-end screenshot style transfer or a model that directly emits final RGB;
- broad web crawling, authenticated-page capture, or cloud inference;
- bundling ONNX Runtime or a general-purpose browser language model;
- training on copyrighted page archives or redistributing third-party assets;
- generic rewriting of canvas, WebGL, video, closed/UA shadow roots, or
  cross-origin inaccessible content;
- site-specific patches that cannot be reduced to a general fixture and rule.

These may be revisited only after the small testbed identifies a concrete error
class that the proposed work can actually address.

## Immediate next step

Complete M0, then the Material-only M1a vertical slice. Admit Primer and Spectrum
sequentially only after the preceding source reproduces cleanly. Finish the normalized tuning set, commit the
M1c metric contract, and select one candidate without inspecting held-out
scores. Only that frozen candidate is evaluated once on Carbon, Fluent, sealed
decisions, and real pages. Until those gates clear, the current deterministic
engine remains the product and the device model remains offline research.
