# M2 goal: role-profile tuning with leave-one-family-out transfer evidence

Status: **binding**. This document is the single source of truth for the M2
experiment. It supersedes `goal-objective.md` and every goal text exchanged
in chat, including "GOAL M2-FINAL" and all of its amendments. Where this
document conflicts with PLAN.md, this document wins and the deviation is
recorded here. Where it conflicts with observed code reality, stop and
report before proceeding.

Prior work this builds on: [PLAN.md](../PLAN.md) (rationale and product
invariants), [M1-REPORT.md](M1-REPORT.md) (the accepted NO-GO under metric
spec v1), and the in-progress spec v2 implementation under
`src/testing/paired-theme/v2/`. The v1 NO-GO is final; v1 artifacts,
schemas, and receipts are historical records and are never modified.

## 1. Design decisions and their rationale

These six decisions change the experiment relative to earlier goal texts.
They are listed with rationale so the document explains itself.

**D1 — Contamination is defined operationally, not as model naivety.**
Every public design system's dark palette exists in LLM pretraining corpora;
"a system the model has never seen" does not exist, so it cannot be the
validity criterion. The criterion that is both achievable and scientifically
meaningful is pipeline purity: *an evaluation system is valid if and only if
none of its token values flow into the tuning objective, the search loop, or
candidate selection, and the evaluated candidate was frozen (committed with
recorded hashes) before any score against that system existed.* This is
enforced by code structure, not secrecy. Consequently the earlier blocker
("Bootstrap/Ant/Chakra/Radix/USWDS are exposed") is void: prior appearance
of token values in context or training data does not disqualify a system.

**D2 — Leave-one-family-out (LOFO) cross-validation replaces the sacred
two-system holdout.** A single held-out pair gives two transfer estimates
and dies to one infrastructure failure (this happened in M1). LOFO over all
evaluable systems gives one transfer estimate per family, survives
individual failures, and removes the need for exposure receipts, one-shot
claims, and contingency promotion in the main experiment. Honesty is
provided by the frozen search procedure and per-fold candidate freezing
(D1), not by secrecy.

**D3 — The temporal holdout is the only genuinely model-naive data, and it
gets the one-shot machinery.** A design-system release published after the
freeze commit cannot appear in any training corpus or prior context. The
existing v2 exposure/claim implementation (O_EXCL receipt, claim-consumes,
immutable logs) is repurposed for exactly one job: the future confirmatory
evaluation of the final candidate against a qualifying upstream release
(section 7). The pair-holdout promotion path has no remaining purpose; code
that exists only to serve it is deleted, not maintained as insurance.

**D4 — An equivariance suite provides generalization evidence without new
data.** The product's real job is mapping never-seen light palettes, not
matching known systems. Metamorphic tests — procedurally perturb a
development system's light theme (hue rotation, lightness shift, chroma
scale) and require the engine's output to transform correspondingly within
preregistered tolerances — probe exactly that, at zero collection cost.

**D5 — Automated rows scale up; human-reviewed rows do not.** The pipeline
is deterministic (M1 reproduced byte-exactly across Chrome launches), so
metric resolution is limited by row count, not measurement noise. A 10%
relative gate decided by 10 D rows per system flips on a single row. The
scene manifest is expanded toward PLAN.md's 24-scene ceiling to reach at
least 30 automated D rows per system; the human-reviewed subset stays at
exactly 10 rows per system (7 × 10 = 70, an explicit amendment of PLAN.md's
50-row ceiling, preserving per-system coverage).

**D6 — The real-page pilot is promoted to a gate.** Authored-pair agreement
is a proxy; the 12-page pilot is the only bridge to the product's actual
job. It moves from an afterthought to a required Phase C scorecard with
preregistered pages, local-only captures, and blinded human review.

## 2. Mission and stop points

- **Phase A** — finish the v2 infrastructure, encode this document in metric
  spec v2, freeze. Ends with `docs/SPEC-V2-FREEZE.md` committed, then
  **PAUSE for human approval**. Hard stop; Phase B must not start without it.
- **Phase B** — the frozen LOFO experiment: per-fold search, per-fold
  frozen candidates, per-fold transfer scores; then the final candidate fit
  on all systems.
- **Phase C** — mechanical verdict from the preregistered gates
  (LOFO + equivariance + pilot + H review), `docs/M2-REPORT.md`, then stop.
- **Section 7** — a standing temporal-confirmation protocol that outlives
  this goal; registering it is a Phase A deliverable, executing it is not.

A well-evidenced negative result at any phase boundary is a successful
outcome. No M3, no model training, no shadow mode, and no edits to shipped
`ROLE_PROFILES` under this goal.

## 3. Phase A: infrastructure and freeze

### A1. Keep what is built (verified in the current tree)

- Profile injection is implemented correctly and stays as-is: production
  `mapRoleColorWithReport` closed over module-private shipped profiles;
  evaluation-only `mapRoleColorWithProfileSet` and `mapCandidateTheme` with
  required, fully-validated profile sets; the type-level and bit-identity
  boundary tests in `tests/color/role-profiles.test.ts`.
- The spec-driven registry direction (systems, splits, variants, and
  denominators derived from the validated frozen spec, never from constants
  or CLI arguments) stays. v1 code paths remain untouched as history.
- Three-layer identity pinning stays: semantic hash of the profiles payload
  (baseline must equal the M0 canonical hash
  `e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5`),
  file SHA-256 of each profile fixture, and evaluator/engine implementation
  pins. The M0 identity check migrates from the dark-map.ts file hash to
  semantic hash + engine pins via an m0-manifest v2 entry.
- The immutable-log pattern (exclusive-create claim record before, fsync'd
  completion/failure record with exit code, signal, byte length, and
  SHA-256 after) applies to every irreversible or one-shot step. Logs under
  `~/scratch-data/semantic-dark-pairs/logs/`.

### A2. Repurpose or delete the pair-holdout machinery

- The v2 exposure receipt/claim implementation is retargeted to the
  temporal confirmation (section 7): its receipt binds the qualifying
  release identity instead of a holdout pair.
- The contingency-promotion path (reserve-pair promotion, and any code
  whose only caller was the pair-holdout flow) is deleted. Insurance code
  for a retired protocol is maintenance debt, not safety.

### A3. Systems

All evaluable systems are development systems in the D1 sense. Start from
the seven with existing or planned adapters: Material, Primer, Spectrum,
Carbon (repair the `notificationBackgroundError` selector), Fluent (build
the adapter), plus up to two from the feasibility list (Bootstrap, Ant
Design, Chakra UI, Radix Themes, USWDS) if their adapters are cheap and
their light/dark pairs are genuinely authored. A system without a canonical
authored pair (likely USWDS) is infeasible; inventing a dark answer for it
is forbidden. Seven systems is the target; more is optional, fewer than six
requires reporting before proceeding.

### A4. The 1.12 boundary (unchanged from prior goal, still pre-freeze)

Measure Spectrum's `1.11995003` separation at four stages: mapper in-memory
→ CSS-serialized → Chrome computed style → after backdrop compositing. A
measurement/serialization artifact becomes an evaluator-side tolerance with
the measured justification; a real rendered shortfall is an engine
intervention fixed in Phase A with a genuine M0-v2 `pnpm verify`/`pnpm e2e`
re-baseline, and all development baselines are computed after the fix.
Weakening the product invariant is forbidden.

### A5. Scene manifest and rows (per D5)

Expand the shared scene manifest toward the 24-scene ceiling until every
system yields at least 30 automated D rows (plus the corresponding C rows
and R pairs the scenes support). Freeze the exact per-system row inventory
in the spec. Human-reviewed subset: exactly 10 rows per system, 70 total.
The observation hierarchy per system per replicate is spec-derived:

    variants (conditions, not samples): light, authored-dark,
      baseline-candidate, m2-candidate
    raw observations = paints × variants, exact counts frozen in the spec
    both candidate arms must be scored; a run scoring only one arm is
      invalid by construction and must fail loudly

### A6. Equivariance suite (per D4)

Preregister in the spec: the perturbation families (at minimum hue rotation
±30°/±90°, lightness shift ±0.05 L, chroma scale ×0.7/×1.3 applied to
development light themes), the expected output transformation for each, the
per-role tolerance, and the pass-rate threshold that enters the Phase C
gate. The suite runs against the in-memory mapper and is fully automated.

### A7. Search procedure (frozen before Phase B)

In the spec: the exact search space (role lightness bands and chroma
retention only; the contrast/hierarchy solver is fixed), the search
algorithm and its deterministic seeding, the training objective computed on
in-fold systems only, and the deterministic selection rule producing
exactly one candidate per fold. The search loop evaluates candidates with
the in-memory mapper (`mapCandidateTheme`); Chrome observation is required
only for scoring frozen candidates, not inside the loop.

### A8. Human-review (H) protocol and real-page pilot (per D6)

Preregister: the fixed case list — final-candidate scene renders plus the
12 pilot pages from the M0 manifest; blinded side-by-side A/B with label
assignment sealed per case until all verdicts are recorded; single reviewer
(the project owner); the H1/H2/H3 severity rubric frozen before Phase B;
worst-state reducer; second look for suspected H2/H3; the unblinding point.
An incomplete H review makes the H gate not-evaluable, and GO impossible.

Pilot mechanics: locally captured, never-committed, never-redistributed
captures of the 12 preregistered pages, darkened with baseline and final
candidate profiles, scored on PLAN.md's deployment-safety card (hard
contrast violations, native-dark false activation, unresolved bright
regions, exact restore) plus the blinded preference review.

### A9. Freeze and pause

Commit metric spec v2 encoding sections A3–A8 (record its SHA-256), the
development baselines for all systems, and `docs/SPEC-V2-FREEZE.md`
summarizing every deviation from v1, from PLAN.md, and from prior goal
texts. Then PAUSE. Phase B requires explicit human approval.

## 4. Phase B: the LOFO experiment

For each fold f over the N frozen systems (target N=7):

1. Run the frozen search procedure on the N−1 in-fold systems only.
2. Freeze candidate_f: commit `fixtures/profiles/candidate-fold-<f>.v2.json`
   with semantic hash and file SHA, before any score against system f
   exists.
3. Score candidate_f and the baseline on system f (all four variants, two
   exact-reproducing Chrome launches, both arms).
4. Record the per-fold transfer result I_f and all component metrics.

Rules:

- The search procedure is identical across folds. If it must change
  mid-experiment, every completed fold is invalidated, the change is
  documented, and Phase B restarts. There is no per-fold tuning by hand.
- Fold order is fixed in the spec. A fold whose scoring fails on
  infrastructure grounds may be repaired and re-run — candidate_f is
  already frozen, so no information can leak into it; the repair and rerun
  are logged with the immutable-log pattern.
- After all folds: run the same frozen search once on all N systems to
  produce candidate_final (`fixtures/profiles/candidate-final.v2.json`,
  frozen the same way). The LOFO distribution {I_f} is the transfer
  estimate for candidate_final; candidate_final itself is never scored on
  data that was held out from its own fit (that is what section 7 is for).
- Report per-fold and per-system always; aggregates never gate alone.

If the search cannot beat the baseline on the development objective at all,
STOP after documenting it: skip the remaining folds, write the
residual-error classification and a no-go memo. That is a valid outcome.

## 5. Phase C: verdict

All thresholds below are the preregistered defaults; Phase A may adjust
them only in the frozen spec, never afterward.

Mechanical GO for M3 consideration requires ALL of:

- LOFO transfer: median I_f ≥ +10% relative to baseline, and min I_f >
  −2% (no fold with materially negative transfer), with no per-fold D/C/R
  component regression beyond the frozen tolerance.
- Zero new hard-constraint, native-dark, or restore failures across
  `pnpm verify` and `pnpm e2e` with candidate_final injected in the
  evaluation harness (shipped defaults untouched).
- Equivariance suite pass rate at or above the frozen threshold for both
  baseline and candidate_final, with the candidate not below the baseline.
- Real-page pilot: no new deployment-safety failure and no new H2/H3 in
  the completed blinded review.
- No new or worsened F finding on any system.

Anything else — including any not-evaluable component — is NO-GO: the
shipped engine stays exactly as it is, and the report classifies residual
errors. On GO, shipped defaults still change only with explicit human
approval, outside this goal.

Deliverables: `docs/M2-REPORT.md` with the v1-style evidence grading
(receipt vs captured log vs filesystem observation vs inference), per-fold
tables, the LOFO distribution, equivariance and pilot scorecards, updated
aggregate JSON/HTML artifacts, and the go/no-go memo.

## 6. Reporting discipline

Per-system and per-fold numbers always accompany any aggregate. Nulls are
reported as nulls, never as zeros. Every claim in M2-REPORT.md carries its
evidence grade. A prettier number without its baseline is not evidence.

## 7. Standing protocol: temporal confirmation

Registered in Phase A, executed whenever it first becomes possible (possibly
after this goal ends):

- A qualifying release is a new upstream version of any frozen system whose
  published token values changed relative to the pinned version, released
  after the spec v2 freeze commit.
- On the first qualifying release: pin it, build the pair via the existing
  adapter, and evaluate baseline and candidate_final once, under the
  repurposed one-shot receipt (O_EXCL claim before token-value access,
  claim-consumes-regardless, immutable logs). This data is model-naive by
  construction; treat its verdict as the strongest single piece of transfer
  evidence and append it to M2-REPORT.md.
- The candidate evaluated is always the frozen candidate_final from Phase
  B. If the M2 verdict was NO-GO, the temporal result is recorded for the
  residual-error record but changes nothing without a new experiment.

## 8. Boundaries and working discipline

Smallest verifiable sub-goal → implement → `pnpm verify` (and `pnpm e2e`
when runtime behavior changed) → commit → next; every commit leaves the
repo green. Raw artifacts under `~/scratch-data/semantic-dark-pairs`; Git
gets schemas, pins, fixtures, generators, and aggregate results only.
Library code in `src/` or `ml/`; `scripts/` stays thin CLI wrappers. No
crawling, no model training, no ONNX, no site-specific rules. PLAN.md
product invariants are untouchable; if a tuned profile conflicts with an
invariant, the invariant wins. Three failed attempts at one blocker →
record the evidence and move to the next independent sub-goal.
