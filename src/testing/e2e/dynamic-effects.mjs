import assert from 'node:assert/strict';

import {parseRgb, relativeLuminance} from './colors.mjs';

const SAMPLE_MS = 700;
const DARK_LIMIT = 0.2;

function readHalo(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#dc-halo-figure');
    const text = document.querySelector('#dc-halo-text');
    if (!svg || !text) throw new Error('Dynamic SVG halo fixture is missing');
    return {count: svg.getAttribute('data-semantic-dark-halos'), stroke: getComputedStyle(text).stroke};
  });
}

// Simulates a dynamic app reacting to a click: a CSS-in-JS runtime appends a
// rule through the CSSOM, a selected state toggles a class, and a new panel is
// inserted. Every rendered frame afterwards must stay on mapped dark surfaces.
export async function exerciseDynamicClickEffects(page, timeout = 15_000) {
  const firstFrame = await page.evaluate(() => new Promise((resolve) => {
    const style = document.createElement('style');
    style.id = 'dynamic-click-style';
    style.textContent = `
      .dc-card { background: #ffffff; color: #1f2328; border: 1px solid #d0d7de; padding: 4px; }
      .dc-card.dc-selected { background: #ddf4ff; }
      .dc-panel { background: #ffffff; color: #1f2328; padding: 4px; }
      .dc-item { background: #f6f8fa; margin: 2px 0; }`;
    document.head.append(style);
    const section = document.createElement('section');
    section.id = 'dynamic-click';
    // The halo figure sits directly on a mapped light surface, with no SVG
    // backdrop of its own, so halo detection depends on the authored DOM color.
    section.innerHTML = '<div id="dc-halo-host" style="background:#ffffff;padding:8px">' +
      '<svg id="dc-halo-figure" width="240" height="40" xmlns="http://www.w3.org/2000/svg">' +
      '<text id="dc-halo-text" x="8" y="26" font-size="18" fill="#30343b" stroke="#ffffff" ' +
      'stroke-width="6" paint-order="stroke">halo label</text></svg></div>' +
      Array.from({length: 200}, (_, index) =>
        `<div class="dc-card" id="dc-card-${index}"><span>Card ${index}</span></div>`).join('');
    document.body.prepend(section);
    requestAnimationFrame(() => {
      const card = document.querySelector('#dc-card-0');
      resolve({
        processed: card?.hasAttribute('data-semantic-dark-background') ?? false,
        background: card ? getComputedStyle(card).backgroundColor : '',
      });
    });
  }));
  assert.equal(firstFrame.processed, true, 'Inserted content was not mapped before its first frame');
  assert.ok(relativeLuminance(parseRgb(firstFrame.background)) < DARK_LIMIT,
    `Inserted content painted light in its first frame: ${firstFrame.background}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.dc-card')]
    .every((card) => card.hasAttribute('data-semantic-dark-background')) &&
    document.querySelector('#dc-halo-figure')?.hasAttribute('data-semantic-dark-svg'), null, {timeout});
  const haloBefore = await readHalo(page);
  assert.equal(haloBefore.count, '1', `Inserted SVG halo was not detected: ${haloBefore.count}`);

  const frames = await page.evaluate((sampleMs) => new Promise((resolve) => {
    const probes = () => [
      document.querySelector('#dc-card-0'),
      document.querySelector('#dc-card-7'),
      document.querySelector('.dc-panel'),
      document.querySelector('.dc-panel .dc-item'),
    ].filter(Boolean);
    const samples = [];
    const start = performance.now();
    const sample = () => {
      samples.push({
        t: Math.round(performance.now() - start),
        active: document.documentElement.hasAttribute('data-semantic-dark-active'),
        backgrounds: probes().map((element) => getComputedStyle(element).backgroundColor),
      });
      if (performance.now() - start < sampleMs) requestAnimationFrame(sample);
      else resolve(samples);
    };
    const sheet = document.querySelector('#dynamic-click-style').sheet;
    sheet.insertRule('.dc-runtime-1 { padding: 6px; }', sheet.cssRules.length);
    document.querySelector('#dc-card-0').classList.add('dc-selected', 'dc-runtime-1');
    const panel = document.createElement('div');
    panel.className = 'dc-panel';
    panel.innerHTML = Array.from({length: 40}, (_, index) =>
      `<div class="dc-item">Item ${index}</div>`).join('');
    document.querySelector('#dynamic-click').prepend(panel);
    requestAnimationFrame(sample);
  }), SAMPLE_MS);

  const light = frames.filter((frame) => !frame.active ||
    frame.backgrounds.some((background) => relativeLuminance(parseRgb(background)) >= DARK_LIMIT));
  assert.ok(frames.length > 0, 'No frames were sampled after the dynamic click');
  assert.equal(light.length, 0,
    `Dynamic click painted ${light.length}/${frames.length} light frames: ${JSON.stringify(light.slice(0, 3))}`);

  // The CSSOM change rescans SVG while the DOM keeps its dark mapping. Halo
  // detection must still compare against the authored (light) backdrop.
  await page.waitForTimeout(300);
  const haloAfter = await readHalo(page);
  assert.equal(haloAfter.count, haloBefore.count,
    `SVG halo detection changed after a CSSOM rescan: ${haloBefore.count} -> ${haloAfter.count}`);
  assert.ok(relativeLuminance(parseRgb(haloAfter.stroke)) < DARK_LIMIT,
    `SVG halo stroke became light after a CSSOM rescan: ${haloAfter.stroke}`);

  await page.evaluate(() => {
    document.querySelector('#dynamic-click')?.remove();
    document.querySelector('#dynamic-click-style')?.remove();
  });
  return {firstFrame, sampledFrames: frames.length, haloBefore, haloAfter};
}
