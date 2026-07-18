# Paired-theme metric v1 rationale

`fixtures/evaluation/metric-spec.v1.json` is the normative contract. This note
only explains the choices; it cannot override the JSON.

The endpoint measures three distinct failures: effective-color disagreement
(`D`), contrast-relationship disagreement (`C`), and surface-order disagreement
(`R`). Their weights are frozen as the rational ratio `1:1:1`. Equal weighting
avoids tuning the endpoint toward whichever reference system happens to benefit
from a larger coefficient, and using integers avoids three slightly different
decimal encodings of one third.

Aggregation is deliberately macro-first. Decisions are reduced inside a scene,
then scenes inside a role, then roles inside one design system. Each system is
reported and gated separately. The equal-system macro is descriptive only:
Material-like behavior cannot compensate for a Carbon or Fluent regression.

The reviewed set contains 50 rows in the experiment, defined as five complete
design-system families times the same ten preregistered semantic paint
decisions. The six contrast rows and three rank rows per system are derived
metric records and are not additional human-review decisions. Missing, extra,
duplicate, or preregistered empty cells invalidate the run rather than changing
the denominator after outcomes are visible.

The panel is an engineering sentinel, not a population estimate. `F`, `H2`, or
`H3` findings veto a candidate under the frozen rules, but observing none does
not establish a statistically low web-wide harm rate.

The goal for this experiment requires one baseline-only exposure to Carbon and
Fluent during M1. That spends both families. Their M1 numbers may describe the
unchanged baseline, but they cannot later serve as independent confirmatory M2
holdouts. M2 therefore requires a genuinely untouched family or is a no-go.

At `2026-07-19T00:39:16+08:00`, the local pnpm policy preflight materialized
the two pinned package tarballs while checking the lockfile. No package export,
token file, or color value was imported or read, and no metric was run. The
freeze guard therefore treats adapter import/source-value access, not mere local
tarball presence, as the one-way exposure boundary and records this event
explicitly rather than claiming installation happened later.
