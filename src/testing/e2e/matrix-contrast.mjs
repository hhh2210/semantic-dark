import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {parseRgb, contrastRatio} from './colors.mjs';

export async function verifyMatrixContrast(page) {
  const results = [];
  for (const id of ['inherited-medium', 'light-gradient', 'mixed-gradient', 'pseudo-gradient']) {
    const locator = page.locator(`#${id}`);
    const text = await locator.evaluate((element, pseudo) => getComputedStyle(element, pseudo).color,
      id === 'pseudo-gradient' ? '::before' : null);
    const png = PNG.sync.read(await locator.screenshot());
    const height = id === 'pseudo-gradient' ? 80 : png.height;
    const ratios = [4, Math.floor(height / 2), height - 5].map(y => {
      const offset = (y * png.width + 4) * 4;
      return contrastRatio(parseRgb(text), [...png.data.subarray(offset, offset + 3)]);
    });
    assert.ok(Math.min(...ratios) >= 4.5, `${id} contrast across rendered backgrounds: ${ratios}`);
    results.push({id, ratios});
  }
  const image = page.locator('#backplate-case');
  await image.evaluate(element => {
    element.setAttribute('data-semantic-dark-image-filter', 'backplate');
    element.classList.add('recheck-backplate');
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#backplate-case')).backgroundColor === 'rgb(255, 255, 255)');
  const mappedSource = await image.evaluate(element => element.style.getPropertyValue('--semantic-dark-background'));
  // Class mutation remaps the DOM, but the image action must not become its source.
  assert.equal(mappedSource, 'rgb(78 78 78)');
  await image.evaluate(element => element.removeAttribute('data-semantic-dark-image-filter'));
  return results;
}
