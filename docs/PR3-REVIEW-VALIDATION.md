# PR #3 local repair validation — 2026-10-21

Verdict: the repaired local version passes the merge-readiness checks below. The
remote PR still points at the unfixed `fecaef2`; do not merge that version directly.
No push, remote review/comment, merge, installed extension update, or user-profile
change was performed.

## Scope and fixes

Reviewed all 20 PR files and both Copilot inline comments:
[stylesheet selection](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r3815403445)
and [suspended load callbacks](https://github.com/hhh2210/semantic-dark/pull/3#discussion_r3815403482).
Both were valid and are fixed.

- Restore only owned class-token/attribute/property changes on the original
  elements; preserve concurrent SPA updates and replacement roots/stylesheets.
- Cancel and roll back pending official activations before reconciling a newer
  generation. Preserve same-mode pending rechecks; stale tasks cannot undo the
  newer theme. Resample after rollback instead of reusing pre-activation evidence.
- Wait for CSS load/error, abort, or a two-second bound before visual confirmation.
  Avoid activation/load feedback and disable the transform during confirmation.
- Restrict recipes to authored CSS stylesheet links with reversible disabled/media
  switches. Exclude feeds, translations and extension-owned stylesheets.
- Suppress load callbacks during nested observer suspension; reattach on resume,
  observe boolean markers and stylesheet removal via `rel`, and ignore owned sheets.
- Require actual dark samples for official color-scheme confirmation. Refresh
  force-on settings on same-mode updates.

## Commands and results

Environment: macOS arm64, Node 26.12.0, pnpm 11.14.0, Playwright 1.61.1,
Chrome for Testing 155.0.8059.80, Python 3.13.13.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; no lockfile change |
| `pnpm verify` | Typecheck, 47 test files / **323 tests**, build passed |
| `CHROME_PATH='…/cft-155/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' pnpm e2e` | Existing complete extension E2E plus **15 official-theme scenarios** passed |
| Same checks after temporary integration with latest main `8a8ae7040d56314a2302306c7245defc1009a8c1` | Conflict-free merge; typecheck, **55 files / 359 tests**, build, complete E2E + 15 scenarios passed |
| `UV_CACHE_DIR="$PWD/artifacts/uv-cache" uv run --project ml pytest` | **25 passed, 1 skipped**; optional Torch model suite has no installed Torch |
| `UV_CACHE_DIR="$PWD/artifacts/uv-cache" uv run --project ml ruff check ml/src ml/tests` | Passed |
| `git diff --check`; `node --check scripts/e2e.mjs` | Passed; no JavaScript lint script/config exists |
| New focused regressions against original PR source in an isolated worktree | **25 failed / 28 passed**; all 53 pass with the fixes |

The 15 browser scenarios cover both-root class changes, concurrent theme changes,
replacement html/body, rapid auto/off/on/auto, ineffective switches, stale native
status, CSS/non-CSS alternate links, slow CSS, transform-to-official transition,
stylesheet replacement, system-light cancellation, pending CSS off/on cancellation,
CSS errors, CSS timeout/late response, and unselected alternate-set fallback.
Feeds and translations produced **zero requests**. The slow success case made one
CSS request. Both final runs had **zero page JS exceptions**. The deliberate missing
CSS returned 404; a separate server-side probe identified the other console 404 as
`/favicon.ico` requested after replacing the root (fixture-only).

## Isolation, evidence and limitations

The original main checkout and running research session were not modified. An
independent temporary repository held the integration worktree; no PR history was
rewritten. All test browsers were headless, used disposable profiles and debugging
pipes, and never attached to an existing browser/debug port. Final profiles and
the temporary verification repository were deleted; screenshots/logs were retained.

Raw local evidence is in `artifacts/`: `verify.log`, `e2e-final.json`,
`integration-verify.log`, `integration-e2e.json`, `regression-before.log`,
`ml-pytest.log`, `ml-ruff.log`, `root-replacement-network.log`, and popup/page PNGs
(integration screenshots are under `artifacts/integration/`). These are ignored
artifacts, not committed browser state.

Initial environmental failures were resolved: sandbox Chromium SIGABRT and a
pre-existing unit test's scratch-directory EPERM required task-scoped execution
outside the sandbox; a later uv cache-lock EPERM used a workspace cache. Offline
integration dependency installation lacked a tarball and succeeded online. Two
Playwright `page.route` attempts stalled; the suite now serves real delayed CSS
through the existing loopback fixture server. Only those exact test processes and
profiles were cleaned up. The final E2E has a bounded timeout and profile cleanup.

Remaining boundaries: live Zhihu/Bilibili/Juejin CSS was not tested. Unselected
alternate stylesheet sets without a reversible disabled/media switch use fallback.
CSS slower than the two-second bound can use fallback. Identical-value site writes
cannot be distinguished from extension writes by conditional restoration.
