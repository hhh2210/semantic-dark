import assert from 'node:assert/strict';

import {PNG} from 'pngjs';
import {chromium} from 'playwright';

import {contrastRatio, parseRgb} from './colors.mjs';

/** Verify the Chrome RGBA8 behavior assumed by the color-solver postcondition. */
export async function verifyRgba8Quantization({chromePath, headless}) {
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless,
    args: ['--force-color-profile=srgb'],
  });
  try {
    const page = await browser.newPage({viewport: {width: 400, height: 100}, deviceScaleFactor: 1});
    await page.setContent(`
      <style>
        * { margin: 0; }
        body { background: #000; }
        .swatch { position: absolute; top: 0; width: 80px; height: 80px; }
        #card { left: 0; background: rgb(32 32 32); }
        #raised { left: 80px; background: rgb(42 41 41); }
        #rounding { left: 160px; background: rgb(31.49 31.5 31.51); }
        #alpha31 { left: 240px; background: rgb(255 0 0 / .1234567); }
        #alpha32 { left: 320px; background: rgb(255 0 0 / .1249); }
      </style>
      <div id="card" class="swatch"></div>
      <div id="raised" class="swatch"></div>
      <div id="rounding" class="swatch"></div>
      <div id="alpha31" class="swatch"></div>
      <div id="alpha32" class="swatch"></div>
    `);
    const computed = await page.evaluate(() => Object.fromEntries(
      ['card', 'raised', 'rounding', 'alpha31', 'alpha32'].map((id) => [
        id,
        getComputedStyle(document.querySelector(`#${id}`)).backgroundColor,
      ]),
    ));
    assert.equal(computed.card, 'rgb(32, 32, 32)');
    assert.equal(computed.raised, 'rgb(42, 41, 41)');
    assert.equal(computed.rounding, 'rgb(31, 32, 32)');
    assert.ok(contrastRatio(parseRgb(computed.raised), parseRgb(computed.card)) >= 1.12,
      'Corrected Spectrum surface pair fell below 1.12 in Chrome computed style');

    const png = PNG.sync.read(await page.screenshot());
    const sample = (x) => {
      const offset = (png.width * 40 + x) * 4;
      return [...png.data.subarray(offset, offset + 4)];
    };
    assert.deepEqual(sample(40), [32, 32, 32, 255]);
    assert.deepEqual(sample(120), [42, 41, 41, 255]);
    assert.deepEqual(sample(200), [31, 32, 32, 255]);
    assert.deepEqual(sample(280), [31, 0, 0, 255]);
    assert.deepEqual(sample(360), [32, 0, 0, 255]);
  } finally {
    await browser.close();
  }
}
