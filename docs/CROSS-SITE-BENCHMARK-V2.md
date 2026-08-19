# Cross-Site Benchmark v2

## Why the corpus is now above one hundred sites

The previous pilot contained 32 candidate sites. That is useful as a mechanism smoke suite, but it is too small to support claims about cross-site generalization. Public web benchmarks use materially broader environment coverage: Mind2Web reports 2,350 tasks from 137 real websites spanning 31 domains [1], while WebLINX reports 100K interactions across more than 150 real-world websites [2]. These benchmarks are not dark-mode benchmarks, so their counts are not a direct normative requirement; they are evidence that a serious real-web evaluation should separate site diversity from repeated states on a small number of domains.

WPT provides a second design reference. Its official documentation treats reftests, automated scripts, visual tests, WebDriver tests, accessibility mapping tests and manual tests as different test types, and its dashboard presents browser-specific failures across repeated runs rather than only one aggregate score [3] [4]. For semantic-dark, the corresponding unit is a controlled site-state observation: URL × viewport × system color scheme × extension mode × settle policy. A domain can produce multiple observations, but family-disjoint site splits are required for honest generalization claims.

## Corpus construction

The expansion began with eight independent categories and 121 researched candidates. After URL validation and host deduplication there were 115 unique researched domains. A manual supplement added 20 additional candidates; merging with the original 32 sentinels produced **154 unique domains**. Each record contains a stable ID, URL, site family, prior expected layer, page type, feature tags, access risk, source and split.

| Stage | Sites | Meaning |
|---|---:|---|
| Legacy sentinel corpus | 32 | Existing mechanism and safety gates |
| Researched candidate pool after deduplication | 115 | Developer docs, SaaS, media, commerce, data, education, creative and regional sites |
| Manual supplement after merge | 17 | New domains not already present in the researched pool or sentinel set |
| Expanded manifest | 154 | Reproducible candidate universe |
| HTTP preflight passed | 124 | Candidates eligible for browser collection at preflight time |
| Browser benchmark run | 132 | Includes the 124 preflight-pass set plus 8 legacy URLs whose preflight state changed |
| Browser-loaded observations | 114 | Completed baseline, extension and restore measurement |

The discrepancy between 124 preflight-pass records and 132 browser-run records is deliberate: the final run retained legacy sentinel coverage and a preflight can disagree with a browser navigation due to method, headers, redirects or timing. Browser failures remain explicitly recorded; they are not silently removed from the manifest.

## Split policy

The v2 manifest has three cohorts. Legacy sentinels remain in `sentinel`; new families are deterministically assigned to `core` or `held-out` using a stable family hash. If a researched URL belongs to a family already present in the sentinel set—for example, `python-docs` alongside the existing Python.org sentinel—it is also assigned to `sentinel`. The full manifest has no family-disjoint split violation.

| Cohort | Full manifest | Recorded browser-run subset | Purpose |
|---|---:|---:|---|
| `sentinel` | 33 | 30 | Safety gates and known failure fixtures |
| `core` | 95 | 79 | Broad development/benchmark loop |
| `held-out` | 26 | 23 | Unseen-family generalization check |
| Total | 154 | 132 | Candidate universe and fixed recorded run input |

The split is by site family, not by URL string. A future change that adds a subdomain, localized route or product sibling must first update `site_family`; otherwise the split validator should reject it.

## Browser collection and sharding

The collector remains sequential and unauthenticated, but v2 adds explicit metadata preservation and resumable shards. It now supports `SEMANTIC_DARK_START_INDEX` and `SEMANTIC_DARK_MAX_SITES`, so the corpus can be run in deterministic 20–30 site shards. Navigation waits for `commit` and then uses a fixed settling delay; this reduced false timeouts for dynamic sites in smoke testing. A hard page timeout is still recorded as an exclusion rather than retried indefinitely.

```bash
pnpm build
SEMANTIC_DARK_SITE_MANIFEST=$PWD/fixtures/evaluation/cross-site-sites.v2.json \
SEMANTIC_DARK_OUTPUT=$HOME/scratch-data/semantic-dark-cross-site/expanded-final/site-observations.jsonl \
SEMANTIC_DARK_START_INDEX=0 \
SEMANTIC_DARK_MAX_SITES=25 \
SEMANTIC_DARK_NAV_WAIT_UNTIL=commit \
SEMANTIC_DARK_SETTLE_MS=800 \
SEMANTIC_DARK_TIMEOUT_MS=10000 \
pnpm benchmark:real-sites
```

A production run should preserve one JSONL row per manifest record, including HTTP status, browser status, exclusion reason, baseline screenshots and local SHA-256 hashes. Raw screenshots and DOM details remain outside Git under the local scratch directory. No login, form submission, payment, download, edit or authenticated session is used.

## First expanded run

| Metric | Result |
|---|---:|
| Manifest records in browser run | 132 |
| Browser-loaded pages | 114 |
| Browser exclusions | 18 |
| Extension errors | 0 |
| Native-dark pages loaded | 12 |
| Native-dark false activations | 0 |
| Automatic activations overall | 4 |
| Loaded light-only prior labels | 38 |
| Loaded light-only activations | 2 |
| Loaded light-only restore-equal | 38/38 |
| Loaded observations restore-equal | 109/114 |
| Family split violations after v2 fix | 0 |

The four automatic activations in the recorded run were `light-arxiv`, `mixed-chrome-dev`, `openstax` and `material-design`. This is a measurement of the current detector, not a claim that all 84 pages whose measured light/dark baseline profile looks light-stable should be automatically transformed. The large light no-op count is useful evidence for the next algorithm iteration, but it also exposes a labeling issue: many public pages are mixed or system-dependent even when their prior manifest label says `light-only`.

The five restore failures were `mixed-observable`, `google-fonts`, `webflow`, `nextjs` and `angular`. They are retained as explicit failure IDs. The 18 browser exclusions include access controls such as 403/401/429, protocol failures and hard timeouts; the exclusion list is stored in `fixtures/evaluation/cross-site-exclusions.v1.json` and must not be treated as a model error.

## Recommended benchmark gates

The next CI gate should report three independent panels. The **safety panel** requires zero automatic activation on loaded `native-dark` sentinels and zero owned-marker leakage after light-to-dark restoration. The **coverage panel** reports activation on pages whose measured light baseline is stable, but does not force activation for mixed/system-dependent pages. The **reliability panel** reports browser exclusions, extension errors, restore mismatches and per-feature coverage; a run with a high exclusion rate should be marked incomplete rather than scored as a high-performing run.

For the current 132-site run, the native-dark safety panel passes: 12 loaded native-dark pages produced 12 no-op decisions and zero native-dark activations. The broad coverage panel is intentionally not yet a pass because only 2 of 38 prior `light-only` loaded pages activated. This makes the expanded benchmark useful: it prevents us from mistaking a small pilot's two successful light cases for general coverage.

## v3 yield and scoring corrections

v2's 2/38 figure mixed two different failures: noisy prior labels, and a detector that abstained on ordinary light documents. v3 keeps the frozen v2 universe and adds a supplement instead of rewriting history.

| Change | Why |
|---|---|
| Coverage denominator is measured `light-stable` | A page labeled `light-only` that follows system dark is not a miss |
| Transparent html/body counts as the UA light canvas | Wikipedia-class pages rarely set an opaque canvas or `color-scheme: light` |
| CSS gradients are sampleable; `url()` backgrounds still abstain | Gradient cards were zeroing the 3×3 grid |
| Viewport cookie banners are skipped | Overlays were being sampled as the page theme |
| Implicit light requires ≥2 samples and `darkCoverage < 0.35` | Avoids blank-page activation and Carbon-style false lights |
| Collector resume, Chrome UA, consent-button dismiss | Preflight/browser yield was being spent on 403/timeout noise |
| `fixtures/evaluation/cross-site-sites.v3-supplement.json` | URL repairs, 15 public docs/media replacements, quality-core IDs |

Regenerate the resolved v3 manifest, then collect:

```bash
pnpm benchmark:merge-supplement
SEMANTIC_DARK_SITE_MANIFEST=$PWD/fixtures/evaluation/cross-site-sites.v3.json \
pnpm benchmark:preflight
SEMANTIC_DARK_SITE_MANIFEST=$PWD/fixtures/evaluation/cross-site-sites.v3.json \
pnpm benchmark:real-sites
pnpm benchmark:quality <observations.jsonl> $PWD/fixtures/evaluation/cross-site-sites.v3.json
```

Four label reviews were measured in two independent runs before being applied: `light-python` remains `light-only`, `aws-documentation` and `threejs` become `dynamic-mixed`, and `looker` remains `light-only`. Collection and cleaning follow-ups live in [MANUS-BENCHMARK-HANDOFF.md](MANUS-BENCHMARK-HANDOFF.md).

## First v3 run

The first v3 browser run contains one JSONL row for each of the 169 manifest records. Aggregate panel numbers are frozen in `fixtures/evaluation/cross-site-v3-run.v1.json`; raw JSONL and screenshots stay in scratch. It loaded 150/169 pages (88.76%); the 42-site quality-core subset loaded 40/42 pages (95.24%), and all 15 v3 supplement sites passed preflight. The panels below are intentionally independent; no weighted total score is introduced.

| Panel | Metric | v3 result | Gate status |
|---|---|---:|---|
| Safety | `nativeDarkSafety.falseActivations` | `[lottiefiles]` | **FAIL**; any non-empty list is a veto |
| Coverage | `measuredLightStable.active / denominator` | `64 / 108` (59.26%) | Descriptive result; higher than v2's `4 / 114` activation count, but not a safety pass |
| Reliability | browser exclusions + restore failures | `19` exclusions; `10` restore failures | Incomplete/review required; all IDs and causes retained |

The v3 run's native-dark false activation is `lottiefiles`. One independent repeat captured it as `light-stable` with `native_dark_decision: true` and no extension errors; a second repeat was not browser-loaded and is therefore insufficient to relabel the safety sentinel. The correct action is to retain the safety veto and diagnose the page/label, not to relax the detector threshold or remove the sentinel. The measured coverage denominator is `light-stable`, while `priorLightOnly` remains an audit-only column.

### v3 preflight and exclusions

The resolved v3 manifest has 169 sites, with 150 preflight successes and 19 exclusions. The 15 `v3-supplement` sites all passed preflight. The exclusions remain explicit, including 401/403 responses, timeouts, connection closures and the existing `cppreference` 403; no blocked URL was retried by changing its path or bypassing access controls.

## References

[1]: https://osu-nlp-group.github.io/Mind2Web/ "Mind2Web official project page"
[2]: https://proceedings.mlr.press/v235/lu24e.html "WebLINX: Real-World Website Navigation with Multi-Turn Dialogue"
[3]: https://web-platform-tests.org/test-suite-design.html "Web Platform Tests: Test Suite Design"
[4]: https://wpt.fyi/results/ "Web Platform Tests dashboard"
