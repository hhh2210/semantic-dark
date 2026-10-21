# Official theme vs Semantic Dark transform

Daily comfort splits into two lanes. Sites that already ship a real dark theme
should use that theme. Sites without one should get the Semantic Dark
transform, and that transform should look good.

This is **not** a long-term per-site CSS patch database. `PLAN.md` still forbids
growing one. Official support is a reversible root-marker activation sitting
beside native-dark detection.

## Policy (automatic mode, system dark)

1. Sample the authored appearance.
2. If the page is already native-dark, forced-colors, or ambiguous: keep the
   existing fail-closed behavior. Semantic Dark stays off.
3. If the page is stably light: try a reversible official switch when one is
   known.
4. Re-sample. Official success requires **visual** dark evidence
   (`dark-rendered-surfaces` or a dark `color-scheme` with dark coverage). A
   root marker we just wrote is not enough.
5. If the official switch does not darken the page, undo owned changes and
   sample the restored page again. Only stable light evidence permits the
   Semantic Dark transform (`applied-light`).
6. After two failed official attempts on the same page, skip official
   activation and use the transform lane.

Manual force-on restores any official mutation first, then applies the
transform. System light and site disable restore it as well.

The lane does not click theme toggles, rewrite URLs, or write cookies. Cookie
persistence (for example Bilibili `theme_style`) is left to live investigation
in [MANUS-OFFICIAL-THEME-HANDOFF.md](MANUS-OFFICIAL-THEME-HANDOFF.md).

## Two kinds of official signal

**Generic.** Common dual-theme contracts already on the root node:

- `data-theme`, `data-color-mode`, `data-bs-theme`, `theme`, `lab-style`, and
  related attributes whose current value is a light or follow-system token
  (`light`, `day`, `auto`, `system`, `light-mode`, `theme-light`)
- boolean dark attributes already present with a light value (`dark="false"`)
- exact class tokens such as `theme-light` / `light-theme` swapped to their
  dark counterparts
- inert W3C alternate stylesheets titled Dark/Night, or `prefers-color-scheme:
  dark` stylesheets that are `disabled` / `media=none`

Declaring `color-scheme: light dark` without a switch we can flip is **not**
treated as a recipe. If the site does not follow the system, the transform
lane still runs.

**Seed catalog.** Host-suffix recipes for sites whose official CSS is driven by
a known root marker even when the light page has no `data-theme=light` yet:

| Site | Host suffix | Official switch |
| --- | --- | --- |
| Zhihu | `zhihu.com` | `html[data-theme="dark"]` |
| Bilibili | `bilibili.com` | `html.dark`, `body.dark`, `html[lab-style="dark"]` |
| Juejin | `juejin.cn` | `data-theme="dark"` plus `.dark-theme` on html/body |

These entries exist so daily-use Chinese sites with first-party dark CSS are
not inverted on top of that CSS. New seeds must be reversible root markers
with conditional restoration, not injected stylesheets. Unknown switches go to the
Manus handoff instead of growing this table by guesswork.

## Status surface

| Decision | Popup badge | Meaning |
| --- | --- | --- |
| `native-dark` | Already dark | The page was already dark. No mutation. |
| `official-dark` | Site dark | Semantic Dark activated the site's own theme. |
| `applied-light` | On | No usable official switch, or official switch failed; transform applied. |

## What this does not do

- It does not overlay Semantic Dark on a successful official dark page.
- It does not grow into host-specific color patches when official CSS is
  missing.
- It does not relax native-dark thresholds to chase activation rate.
- It does not treat Darkmode.js mix-blend widgets as official site themes.
- Visual quality of the transform lane is a separate problem from this gate.

## Ownership and asynchronous changes

Restoration retains references to the original elements. It only undoes changed
class tokens and attributes/properties that still have the values written by
this activation. Unrelated SPA classes and replacement html/body/link elements
are preserved. An attribute or stylesheet resource repurposed by the site is no
longer overwritten. Identical-value writes by the site cannot be distinguished
from our own value.

Stylesheet recipes require an authored CSS `stylesheet` link and an explicit
`disabled` or inert `media` state. Feeds, translations and extension-owned sheets
are excluded. An unselected alternate stylesheet set may report `disabled=false`;
selecting such a set changes browser state beyond these reversible properties,
so it is left to the transform fallback.

Enabled CSS gets up to two seconds to load before visual confirmation. Load,
error, timeout and cancellation all settle the wait. A cancelled generation
rolls back its pending activation before a newer generation starts, and cannot
later roll back that newer theme. Same-mode updates retain pending rechecks.
Authored changes during CSS settlement are included in the final sample; the
stylesheet's own load event does not restart activation.

`pnpm e2e` exercises the built extension with the official fixture, SPA root
changes, alternate CSS/feed links, slow/error/timeout loads and rapid modes in a
disposable headless profile. Set `CHROME_PATH` to a test Chromium executable.
