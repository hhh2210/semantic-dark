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

Tuning and evaluation are separated by organization/design system and component
family. Nodes from the same component, stylesheet, or page template never land
on both sides of an evaluation. Random screenshot or DOM-node splits are
forbidden because they overstate generalization.

## Milestones and stop conditions

### M0 — Freeze the current baseline

Deliverables:

- record `pnpm verify` and `pnpm e2e` results from one pinned commit;
- reduce the reported table/white-band failures into self-authored fixtures;
- record current pair-agreement, contrast, restore, and native-dark outcomes;
- define one manifest for mechanism fixtures and real-page pilot cases.

Gate: every later experiment must run against the same cases and report both
improvements and regressions. A prettier screenshot without a baseline is not
evidence.

### M1 — Build the small authored-pair evaluator

Deliverables:

- parse pinned token pairs from the three reference systems;
- render no more than 24 local component/state scenes;
- collect computed style for target nodes and `::before`/`::after` where used;
- calculate role-conditioned color difference, contrast, surface ordering, and
  hue/chroma retention;
- produce an HTML/JSON report, with raw artifacts under `~/scratch-data`.

Gate: stop collection once every initial role/state is represented and the
50-row reviewed set is full. Do not add more sites merely to increase a sample
count.

### M2 — Tune the deterministic role profiles

First compare the current hand-set values in
[`ROLE_PROFILES`](src/color/dark-map.ts) with a small parameter search or robust
regression. The search may adjust role lightness bands and chroma retention, but
the contrast and hierarchy solver remains fixed.

A candidate is kept only if it:

- has zero new hard-constraint, native-dark, or restore failures;
- improves the held-out design-system pair metric by at least 10% relative to
  the frozen baseline;
- creates no severe regression in the 50 reviewed decisions or 12-page pilot;
- improves at least one original failure fixture without a site-specific rule.

If those gates are not met, keep the existing profiles and classify the
residual errors. A negative result is useful and ends this branch of work.

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

- role-conditioned OKLab/OKLCH color difference;
- text and non-text contrast agreement;
- surface-rank and state-separation agreement;
- brand/accent hue preservation;
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

M0 and M1 form one bounded experiment, not a data-collection program. Build the
small evaluator, tune the existing profiles once, run the held-out and real-page
scorecards, and make a go/no-go decision. Until that evidence exists, the
current deterministic engine remains the product and the device model remains
offline research.
