# PR #3 repair validation — 2026-10-22, review follow-up

This records local validation of the follow-ups to `9b0d360`, `16fe16d`, `390bae2`, and `027d386`. The earlier local
readiness verdict missed real regressions; current GitHub CI and review results
must also pass before merging. The original research checkout and installed
extension were not modified.

## Findings and changes

| Finding | Resolution and regression evidence |
| --- | --- |
| Inherited theme-map keys (`constructor`, `__proto__`) corrupt classes/attributes | Use `Map` lookups. Unit tests and actual Chromium preserve these keys through auto fallback and off. |
| Slow CSS leaves the open popup permanently Checking/disabled | Refresh while pending until terminal status, supersession or popup close. Unit lifecycle tests and Chromium with 1.7s/4.5s CSS verify Site dark/On without reopening. |
| Callback routes crash `assertE2eInputs` destructuring | Validate file-backed routes only. Mixed-route unit test serves both kinds; full E2E registers a callback favicon route before validation. |
| PLAN omits Juejin | Align the seed list with the implemented catalog. |
| Successful SPA recovery does not reset `officialFailures` | Reset after visual success. Repeated successful route recoveries stay official; consecutive failed attempts remain bounded. |
| Native detector misses recipe-generated boolean/night markers | Recognize boolean markers and `night` values without relaxing the visual gate. Unit tests plus sparse, three-column Chromium fixtures cover both paths. |
| Duplicate stylesheet URL/title matches mutate unrelated links | Runtime stylesheet recipes retain the exact probed link identity; deduplication also uses that identity. Unit/browser tests preserve separate screen/print states and restore each original link. |
| Multiple dark variants are enabled together | Try root-only activation, then one named stylesheet set at a time. Failed variants are restored before trying the next. Chromium proves exclusive variants and same-title multi-file sets. |
| Old failures block newly available candidates | Key the budget to current recipes, link identity and resource fields. New/replaced/repurposed candidates reset it; changed contracts during settlement are re-probed. |
| Replacement roots inherit an exhausted budget | Include the actual html/body element and relevant source attribute/token state in recipe keys. Unit and browser tests replace each root after two failures and verify recovery. |
| Body-hosted stylesheet changes are missed | Observe stylesheet metadata and style text throughout the document, filtering unrelated attributes/text and extension-owned styles. Unit and browser tests cover nested body links. |
| Author CSS changes make an unchanged recipe work | Refresh failed evidence for stylesheet DOM/CSSOM changes and automatic-mode re-entry, while late loads of attempted sheets cannot replenish their own budget. Real Chromium proves recovery and caps ineffective slow CSS at two fetches. |
| E2E timeout cleanup can race late browser acquisition/closure | Abort owned browsers and await the original, memoized close Promise before profile deletion. Lifecycle unit tests and a forced 1ms timeout verify cleanup. |

Remote review threads: [callback route](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4337957958),
[PLAN](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4337958046),
[failure budget](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4338338480),
[markers](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4338338494),
[stylesheet identity](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4338338504).
Further Codex findings on `390bae2`: [root identity](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4339335811) and [body stylesheets](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4339335828).

Further Codex findings on `16fe16d`: [exclusive variants](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4339087377) and [changed candidates](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r4339087392).

The two additional Chromium reproductions came from the independent review log
`/tmp/semantic-pr3-codex-review.log` and were rechecked with the new regressions.

## Local validation

Environment: macOS arm64, Node 26.12.0, pnpm 11.14.0, Playwright 1.61.1,
Chrome for Testing 155.0.8059.80, Python 3.13.13.

| Command / check | Result |
| --- | --- |
| `pnpm verify` | Typecheck, **51 files / 358 tests**, build passed |
| `CHROME_PATH='<cft-155 executable>' pnpm e2e` | Existing full extension E2E plus **32 official-theme scenarios** passed |
| Latest main integration, `8a8ae7040d56314a2302306c7245defc1009a8c1` | Conflict-free temporary merge; typecheck, **59 files / 394 tests**, build, full E2E + **32 scenarios** passed |
| `UV_CACHE_DIR="$PWD/artifacts/uv-cache" uv run --project ml pytest` | **25 passed, 1 skipped** (optional Torch dependency absent) |
| `UV_CACHE_DIR="$PWD/artifacts/uv-cache" uv run --project ml ruff check ml/src ml/tests` | Passed |
| `CHROME_PATH='<cft-155 executable>' E2E_TIMEOUT_MS=1 node scripts/e2e.mjs` | Expected nonzero deadline result; browser exited and profile remained absent |
| Round-2 focused tests on original `9b0d360` source in an isolated worktree | **13 failed / 72 passed**; all 85 pass after repair |
| Round-3 controller regressions on original `16fe16d` | **5 failed / 29 passed**; all 34 pass after repair |
| Round-4 root/observer regressions on original `390bae2` | **4 failed / 39 passed**; all 43 pass after repair |
| Round-5 source-style regressions on original `027d386` | **7 failed / 43 passed**; all 50 pass after repair; real Chromium source-style before/after probe also reproduced recovery |
| `git diff --check`, JavaScript syntax checks | Passed; repository has no JavaScript lint script |

The E2E checks cover the actual controller, engines, popup and rendered CSS.
There were **zero page JS exceptions**, zero feed/translation requests, and only
the deliberately missing CSS response returned HTTP 404. Ordinary completion and
forced-timeout profiles were verified absent after browser termination. The
first timeout-cleanup attempt revealed a recreated profile after a second close
returned early; the memoized close fix and lifecycle tests address that failure.

The integration repository/worktrees are disposable and independent of the
research checkout; no PR history is rebased. Evidence is retained under ignored
`artifacts/review2-*`, `artifacts/review3-*`, `artifacts/review4-*`, and `artifacts/review5-*` logs/JSON, with screenshots including
`popup-slow-1700.png` and `popup-slow-4500.png`.

## Remaining coverage boundaries

Live Zhihu/Bilibili/Juejin CSS was not tested. Unselected alternate stylesheet
sets without a reversible disabled/media switch use fallback. CSS slower than
the two-second bound may fall back. Conditional restoration cannot distinguish
identical-value writes by the site from the extension's own value.
