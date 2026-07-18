# Semantic Dark

A local-first Chrome Manifest V3 extension for semantic dark-mode rendering. It
avoids a whole-page inversion filter: HTML colors, CSS gradients, SVG paint
relationships, raster diagrams, and ordinary images take separate paths.

## What works now

- HTML backgrounds, surfaces, text, borders, decoration, and caret colors are
  mapped in OKLCH through reversible extension-owned CSS variables.
- Generated `::before`/`::after` surfaces, gradients, text, and borders use the
  same semantic mapping. Common path-local pointer and keyboard-focus state
  changes are re-sampled before their first rendered frame.
- CSS gradients keep their geometry and transparent gutters while solid color
  stops are remapped. Text contrast is checked against the brightest resulting
  stop, covering table headers and callouts that use light gradient bands.
- Text contrast is constrained to at least 4.5:1; important non-text colors use
  a 3:1 floor. Hue and chroma are retained where the target gamut permits it.
- Mapped surfaces keep at least a subtle 1.12:1 separation from the configured
  canvas, and their authored lightness order remains monotonic. This preserves
  card, table-band, and callout hierarchy without turning every region gray.
- Inline SVG text is handled as a paint group. `fill`, `stroke`, `paint-order`,
  and `stroke-width` are interpreted together, so a white background halo
  becomes a dark halo instead of a thick white outline.
- SVG presentation attributes, author CSS, inheritance, `currentColor`, local
  gradient stops, repeated chart colors, and large backdrop rectangles have
  targeted handling and exact restore journals.
- Raster assets are classified as photo, icon, diagram, screenshot, or unknown
  from bounded pixel statistics, then refined with local `alt`, title, role, and
  URL evidence. Unknown is a rejection state, not a fifth content class.
- High-confidence diagrams use an OKLab palette/region transform rather than a
  frame-wide invert. It preserves alpha and accent hue, enforces contrast, and
  abstains when the pixel/background analysis is unsafe.
- Diagram computation runs in a dedicated worker behind an extension-origin
  host iframe. This keeps synchronous main-thread work below 1 ms in the E2E
  fixture and still works when the page sets `worker-src 'none'`.
- Open shadow roots and dynamically inserted DOM are observed. A small
  MAIN-world shim reports CSSOM and `attachShadow` changes to the isolated
  content script.
- Pages that already provide a dark appearance are detected from authored
  markers, `color-scheme` negotiation, and sampled foreground/surface evidence,
  then left untouched. Uncertain pages fail closed and can be overridden
  manually.
- Per-site automatic/manual mode, background, and contrast settings are stored
  locally. Stop, palette change, and popup disable restore the original
  DOM/SVG/image state and revoke generated Blob URLs.

No page pixels or DOM content leave the browser. See [PRIVACY.md](PRIVACY.md)
for the exact data and permission boundaries.

## Load it in Chrome

```bash
pnpm install
pnpm build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select the generated `dist/` directory.

## Verify

```bash
pnpm verify
pnpm e2e
```

E2E requires a locally installed Chrome. macOS uses the standard application
path automatically; elsewhere set `CHROME_PATH=/absolute/path/to/chrome`.

The E2E test starts a local fixture with a strict worker CSP, launches a
temporary system-Chrome profile with only this extension, checks
DOM/SVG/gradient/pseudo-element contrast, exercises hover-state restoration,
confirms authored dark pages remain untouched, audits popup target sizes in
light and dark appearances, measures raster-worker timing, toggles the site
through the real popup, and writes screenshots to `artifacts/`.

## ML status

The installed extension uses a deterministic visual-feature router with an
explicit safety gate. The repository also contains the audited experiment code
and pinned source manifest under `ml/`: source/content leakage guards, a
14,180-parameter RGBA CNN, prediction-v2 contracts, validation-only OOD
threshold selection, and ONNX export. Corpus and run artifacts intentionally
stay under `~/scratch-data` rather than in the source tree.

The first controlled run found that a pure CNN classifies known assets well but
is not a reliable rejection mechanism. The best offline design keeps the
heuristic safety gate and uses a 5.8 KB linear router over the existing visual
features for known-class routing; it slightly beat the CNN hybrid without an
ONNX runtime. It remains offline until a genuinely cross-site corpus verifies
the result. See [BENCHMARK.md](BENCHMARK.md) for exact numbers and limitations;
see [ml/README.md](ml/README.md) for CNN reproduction.

The model, if eventually adopted, will only choose a routing policy. Final
colors remain governed by the deterministic contrast and palette solvers.

## Known boundaries

- Cross-origin stylesheet fetching and recursive `@import` rewriting are not
  implemented.
- Pseudo-elements other than `::before`/`::after`, closed/UA shadow roots,
  external SVG internals, bitmap CSS background images, cross-origin tainted
  pixels, canvas, WebGL, and video are not semantically rewritten. Computed CSS
  gradients are supported.
- Interaction refresh is deliberately bounded to the composed event path and
  small direct-child sets. Deep descendant or broad sibling selectors driven
  only by `:hover`/`:focus` can still require a later CSS-selector-aware pass.
- Source-probe transition suppression is document-scoped. Open shadow content
  is mapped, but an authored color transition inside it may still play while
  automatic mode activates or restores the site's own theme.
- Animated SVG paint mutations are not fully journaled yet.
- Raster recoloring currently reads and re-encodes the full same-origin image;
  it has a one-megapixel cap and runs asynchronously. Wall time varies with
  Chrome and hardware; the tested integration path keeps synchronous
  main-thread work below 2 ms.
- Broad `<all_urls>` host access is suitable for local testing. Store release
  needs an explicit permission/onboarding design and a privacy review.

## License

[MIT](LICENSE)
