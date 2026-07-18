import assert from 'node:assert/strict';

import {
  colorsNear,
  contrastRatio,
  parseRgb,
  parseRgbColors,
  relativeLuminance,
} from './colors.mjs';

const DARK_BACKGROUND = [17, 20, 22];
const SOURCE_FILL = [74, 79, 87];
const SOURCE_STROKE = [255, 255, 255];

export async function readPageState(page) {
  return page.evaluate(() => {
    const required = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Fixture element is missing: ${selector}`);
      return element;
    };
    const svg = required('#semantic-halo-figure');
    const haloText = required('#halo-text');
    const card = required('#dom-card');
    const title = required('#dom-title');
    const image = required('#vision-icon');
    const diagram = required('#vision-diagram');
    const category = required('#benchmark-category');
    const haloStyle = getComputedStyle(haloText);
    const cardStyle = getComputedStyle(card);
    const titleStyle = getComputedStyle(title);
    const diagramSrc = diagram.getAttribute('src');
    const diagramCurrentSrc = diagram.currentSrc;
    const categoryStyle = getComputedStyle(category);
    return {
      svgProcessed: svg.hasAttribute('data-semantic-dark-svg'),
      svgHaloCount: svg.getAttribute('data-semantic-dark-halos'),
      svgFill: haloStyle.fill,
      svgStroke: haloStyle.stroke,
      domBackgroundProcessed: card.hasAttribute('data-semantic-dark-background'),
      domTextProcessed: title.hasAttribute('data-semantic-dark-color'),
      domBackground: cardStyle.backgroundColor,
      domText: titleStyle.color,
      imageKind: image.getAttribute('data-semantic-dark-image-kind'),
      imageFilter: image.getAttribute('data-semantic-dark-image-filter'),
      diagramKind: diagram.getAttribute('data-semantic-dark-image-kind'),
      diagramRasterStatus: diagram.getAttribute('data-semantic-dark-raster-status'),
      diagramRasterMs: diagram.getAttribute('data-semantic-dark-raster-ms'),
      diagramRasterMainMs: diagram.getAttribute('data-semantic-dark-raster-main-ms'),
      diagramRasterDispatchMs: diagram.getAttribute('data-semantic-dark-raster-dispatch-ms'),
      diagramRasterWorkerMs: diagram.getAttribute('data-semantic-dark-raster-worker-ms'),
      diagramRasterWorker: diagram.getAttribute('data-semantic-dark-raster-worker'),
      diagramSrc,
      diagramCurrentSrc,
      diagramUsesBlob: diagramSrc?.startsWith('blob:') === true ||
        diagramCurrentSrc.startsWith('blob:'),
      categoryGradientProcessed: category.hasAttribute('data-semantic-dark-background-image'),
      categoryGradient: categoryStyle.backgroundImage,
      categoryGradientVariable: category.style.getPropertyValue('--semantic-dark-background-image'),
      categoryText: categoryStyle.color,
    };
  });
}

export async function waitForProcessedState(page, timeout = 15_000) {
  await page.waitForFunction(() => {
    const svg = document.querySelector('#semantic-halo-figure');
    const card = document.querySelector('#dom-card');
    const title = document.querySelector('#dom-title');
    const image = document.querySelector('#vision-icon');
    const diagram = document.querySelector('#vision-diagram');
    const category = document.querySelector('#benchmark-category');
    return svg?.hasAttribute('data-semantic-dark-svg') &&
      card?.hasAttribute('data-semantic-dark-background') &&
      title?.hasAttribute('data-semantic-dark-color') &&
      image?.hasAttribute('data-semantic-dark-image-kind') &&
      diagram?.hasAttribute('data-semantic-dark-raster-status') &&
      diagram?.hasAttribute('data-semantic-dark-raster-ms') &&
      diagram?.hasAttribute('data-semantic-dark-raster-main-ms') &&
      diagram?.hasAttribute('data-semantic-dark-raster-dispatch-ms') &&
      diagram?.hasAttribute('data-semantic-dark-raster-worker-ms') &&
      diagram?.getAttribute('data-semantic-dark-raster-worker') === 'dedicated' &&
      category?.hasAttribute('data-semantic-dark-background-image');
  }, undefined, {timeout});
}

export async function waitForRestoredState(page, timeout = 15_000) {
  await page.waitForFunction(() => {
    const svg = document.querySelector('#semantic-halo-figure');
    const card = document.querySelector('#dom-card');
    const title = document.querySelector('#dom-title');
    const image = document.querySelector('#vision-icon');
    const diagram = document.querySelector('#vision-diagram');
    const category = document.querySelector('#benchmark-category');
    return svg && card && title && image && diagram && category &&
      !svg.hasAttribute('data-semantic-dark-svg') &&
      !svg.hasAttribute('data-semantic-dark-halos') &&
      !card.hasAttribute('data-semantic-dark-background') &&
      !title.hasAttribute('data-semantic-dark-color') &&
      !image.hasAttribute('data-semantic-dark-image-kind') &&
      !diagram.hasAttribute('data-semantic-dark-image-kind') &&
      !diagram.hasAttribute('data-semantic-dark-raster-status') &&
      !diagram.hasAttribute('data-semantic-dark-raster-ms') &&
      !diagram.hasAttribute('data-semantic-dark-raster-main-ms') &&
      !diagram.hasAttribute('data-semantic-dark-raster-dispatch-ms') &&
      !diagram.hasAttribute('data-semantic-dark-raster-worker-ms') &&
      !diagram.hasAttribute('data-semantic-dark-raster-worker') &&
      !category.hasAttribute('data-semantic-dark-background-image') &&
      diagram.getAttribute('src') === '/raster-diagram.svg' &&
      !diagram.currentSrc.startsWith('blob:');
  }, undefined, {timeout});
}

function assertSourceSvg(state, label) {
  assert.ok(colorsNear(parseRgb(state.svgStroke), SOURCE_STROKE),
    `${label} SVG stroke is ${state.svgStroke}, not white`);
  assert.ok(colorsNear(parseRgb(state.svgFill), SOURCE_FILL),
    `${label} SVG fill is ${state.svgFill}, not #4A4F57`);
}

export function verifyBaselineState(state) {
  assertSourceSvg(state, 'Baseline');
  assert.equal(state.diagramSrc, '/raster-diagram.svg',
    `Baseline raster src changed unexpectedly: ${state.diagramSrc}`);
  assert.equal(state.diagramUsesBlob, false, 'Baseline raster image unexpectedly uses a Blob URL');
  expectLightSourceGradient(state, 'Baseline');
}

export function verifyTransformedState(state) {
  const stroke = parseRgb(state.svgStroke);
  const fill = parseRgb(state.svgFill);
  const background = parseRgb(state.domBackground);
  const text = parseRgb(state.domText);
  const rasterMs = Number(state.diagramRasterMs);
  const rasterMainMs = Number(state.diagramRasterMainMs);
  const rasterDispatchMs = Number(state.diagramRasterDispatchMs);
  const rasterWorkerMs = Number(state.diagramRasterWorkerMs);
  const gradientStops = parseRgbColors(state.categoryGradientVariable);

  assert.ok(state.svgProcessed, 'Inline SVG is missing data-semantic-dark-svg');
  assert.ok(Number(state.svgHaloCount) >= 1,
    `Expected at least one SVG background halo, received ${state.svgHaloCount}`);
  assert.ok(colorsNear(stroke, DARK_BACKGROUND),
    `SVG halo stroke ${state.svgStroke} is not the configured dark background rgb(17, 20, 22)`);
  assert.ok(contrastRatio(fill, stroke) >= 4.5,
    `SVG fill/stroke contrast is ${contrastRatio(fill, stroke).toFixed(2)}, below WCAG 4.5:1`);

  assert.ok(state.domBackgroundProcessed,
    'Ordinary DOM card is missing data-semantic-dark-background');
  assert.ok(state.domTextProcessed, 'Ordinary DOM title is missing data-semantic-dark-color');
  assert.ok(relativeLuminance(background) < 0.2,
    `DOM card background remained too light: ${state.domBackground}`);
  assert.ok(contrastRatio(text, background) >= 4.5,
    `DOM text/background contrast is ${contrastRatio(text, background).toFixed(2)}, below 4.5:1`);

  assert.match(state.imageKind ?? '', /^(photo|icon|diagram|unknown):0\.\d{2}$/,
    `Visual classifier debug attribute is missing or malformed: ${state.imageKind}`);
  assert.match(state.diagramKind ?? '', /^diagram:0\.\d{2}$/,
    `Raster fixture was not classified as a diagram: ${state.diagramKind}`);
  assert.equal(state.diagramRasterStatus, 'recolored',
    `Raster diagram transform did not complete: ${state.diagramRasterStatus}`);
  assert.equal(state.diagramUsesBlob, true, 'Raster diagram did not install a local Blob result');
  assert.equal(state.diagramRasterWorker, 'dedicated',
    `Raster diagram did not use its dedicated worker: ${state.diagramRasterWorker}`);
  for (const [name, raw, value] of [
    ['wall', state.diagramRasterMs, rasterMs],
    ['main-thread', state.diagramRasterMainMs, rasterMainMs],
    ['dispatch', state.diagramRasterDispatchMs, rasterDispatchMs],
    ['worker', state.diagramRasterWorkerMs, rasterWorkerMs],
  ]) {
    assert.notEqual(raw, null, `Raster ${name} timing attribute is missing`);
    assert.ok(Number.isFinite(value) && value >= 0,
      `Raster ${name} timing must be finite and nonnegative, received ${raw}`);
  }
  assert.ok(rasterMainMs < 40,
    `Raster main-thread synchronous work was ${rasterMainMs}ms, expected <40ms after worker migration`);
  assert.ok(rasterDispatchMs <= rasterMainMs + 0.1,
    `Raster dispatch ${rasterDispatchMs}ms exceeded total main-thread work ${rasterMainMs}ms`);
  assert.equal(state.categoryGradientProcessed, true,
    'Gradient-backed category label was not mapped');
  assert.ok(gradientStops.length >= 1,
    `Mapped category gradient has no readable RGB stop: ${state.categoryGradientVariable}`);
  const categoryText = parseRgb(state.categoryText);
  const brightestStop = gradientStops.reduce((brightest, stop) =>
    relativeLuminance(stop) > relativeLuminance(brightest) ? stop : brightest
  );
  assert.ok(relativeLuminance(brightestStop) < 0.2,
    `Category gradient remained too light: ${state.categoryGradientVariable}`);
  assert.ok(contrastRatio(categoryText, brightestStop) >= 4.5,
    `Category text/gradient contrast is ${contrastRatio(categoryText, brightestStop).toFixed(2)}`);

  return {
    svgFillStrokeContrast: Number(contrastRatio(fill, stroke).toFixed(2)),
    domTextBackgroundContrast: Number(contrastRatio(text, background).toFixed(2)),
    rasterMs,
    rasterMainMs,
    rasterDispatchMs,
    rasterWorkerMs,
  };
}

export function verifyRestoredState(state) {
  assert.equal(state.svgProcessed, false, 'Inline SVG marker remained after disabling the host');
  assert.equal(state.svgHaloCount, null, 'Inline SVG halo marker remained after disabling the host');
  assertSourceSvg(state, 'Restored');
  assert.equal(state.domBackgroundProcessed, false,
    'DOM background marker remained after disabling the host');
  assert.equal(state.domTextProcessed, false,
    'DOM text marker remained after disabling the host');
  assert.equal(state.imageKind, null, 'Image classifier marker remained after disabling the host');
  assert.equal(state.imageFilter, null, 'Image filter marker remained after disabling the host');
  assert.equal(state.diagramKind, null, 'Raster classifier marker remained after disabling the host');
  assert.equal(state.diagramRasterStatus, null, 'Raster status remained after disabling the host');
  assert.equal(state.diagramRasterMs, null, 'Raster timing remained after disabling the host');
  assert.equal(state.diagramRasterMainMs, null,
    'Raster main-thread timing remained after disabling the host');
  assert.equal(state.diagramRasterDispatchMs, null,
    'Raster dispatch timing remained after disabling the host');
  assert.equal(state.diagramRasterWorkerMs, null,
    'Raster worker timing remained after disabling the host');
  assert.equal(state.diagramRasterWorker, null,
    'Raster worker marker remained after disabling the host');
  assert.equal(state.diagramSrc, '/raster-diagram.svg',
    `Raster src was not restored: ${state.diagramSrc}`);
  assert.equal(state.diagramUsesBlob, false, 'Raster image still uses a Blob URL after restoration');
  assert.equal(state.categoryGradientProcessed, false,
    'Gradient category marker remained after disabling the host');
  expectLightSourceGradient(state, 'Restored');
}

export async function readNativeDarkState(page) {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const card = document.querySelector('#native-dark-card');
    if (!card) throw new Error('Native dark fixture card is missing');
    const cardStyle = getComputedStyle(card);
    const ownedAttributes = [];
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        if (attribute.startsWith('data-semantic-dark-')) {
          ownedAttributes.push(`${element.tagName.toLowerCase()}:${attribute}`);
        }
      }
    }
    return {
      initialActive: globalThis.nativeInitialState?.semanticDarkActive ?? null,
      active: document.documentElement.hasAttribute('data-semantic-dark-active'),
      ownedAttributes,
      rootBackground: rootStyle.backgroundColor,
      bodyBackground: bodyStyle.backgroundColor,
      cardBackground: cardStyle.backgroundColor,
      cardText: cardStyle.color,
    };
  });
}

export function verifyNativeDarkState(state) {
  assert.equal(state.initialActive, false,
    'Native-dark page received the prepaint active marker before its inline probe');
  assert.equal(state.active, false, 'Native-dark page remained extension-active');
  assert.deepEqual(state.ownedAttributes, [],
    `Native-dark page was touched: ${state.ownedAttributes.join(', ')}`);
  assert.ok(colorsNear(parseRgb(state.rootBackground), [15, 17, 21]),
    `Native root background changed: ${state.rootBackground}`);
  assert.ok(colorsNear(parseRgb(state.bodyBackground), [15, 17, 21]),
    `Native body background changed: ${state.bodyBackground}`);
  assert.ok(colorsNear(parseRgb(state.cardBackground), [28, 32, 39]),
    `Native card background changed: ${state.cardBackground}`);
  assert.ok(contrastRatio(parseRgb(state.cardText), parseRgb(state.cardBackground)) >= 4.5,
    'Native card text no longer meets 4.5:1 contrast');
}

export function verifyPopupMetrics(metrics, {appearanceHidden}) {
  assert.ok(metrics.popup.width >= 320, `Popup width is only ${metrics.popup.width}px`);
  assert.ok(metrics.switch.width >= 28 && metrics.switch.height >= 28,
    `Switch target is ${metrics.switch.width}x${metrics.switch.height}px`);
  if (!appearanceHidden) {
    assert.ok(metrics.color.width >= 28 && metrics.color.height >= 28,
      `Color target is ${metrics.color.width}x${metrics.color.height}px`);
    assert.ok(metrics.range.width >= 200 && metrics.range.height >= 28,
      `Range target is ${metrics.range.width}x${metrics.range.height}px`);
  }
  assert.equal(metrics.appearanceHidden, appearanceHidden);
  assert.equal(metrics.errorHidden, true);
  const canvas = parseRgb(metrics.bodyStyle.background);
  for (const [label, style] of [
    ['heading', metrics.headingStyle],
    ['hostname', metrics.hostStyle],
  ]) {
    assert.ok(contrastRatio(parseRgb(style.color), canvas) >= 4.5,
      `Popup ${label} contrast is below 4.5:1`);
  }
  assert.ok(contrastRatio(
    parseRgb(metrics.controlStyle.color),
    parseRgb(metrics.surfaceStyle.background),
  ) >= 4.5, 'Popup switch label contrast is below 4.5:1');
}

function expectLightSourceGradient(state, label) {
  const stops = parseRgbColors(state.categoryGradient);
  assert.ok(stops.some((stop) => relativeLuminance(stop) > 0.8),
    `${label} category gradient is not the light authored gradient: ${state.categoryGradient}`);
}
