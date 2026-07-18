import assert from 'node:assert/strict';

import {colorsNear, contrastRatio, parseRgb, relativeLuminance} from './colors.mjs';

const BEFORE_ATTRIBUTE = 'data-semantic-dark-before-background';
const AFTER_ATTRIBUTE = 'data-semantic-dark-after-background';
const BACKGROUND_ATTRIBUTE = 'data-semantic-dark-background';
const BEFORE_COLOR_ATTRIBUTE = 'data-semantic-dark-before-color';

export async function readDomEffectState(page) {
  return page.evaluate(({beforeAttribute, afterAttribute, beforeColorAttribute}) => {
    const scroll = document.querySelector('#benchmark-scroll');
    const row = document.querySelector('#benchmark-hover-row');
    const explicit = document.querySelector('#pseudo-explicit-host');
    const inherited = document.querySelector('#pseudo-inherited-host');
    if (!scroll || !row || !explicit || !inherited) {
      throw new Error('DOM effect fixture is missing');
    }
    return {
      beforeProcessed: scroll.hasAttribute(beforeAttribute),
      afterProcessed: scroll.hasAttribute(afterAttribute),
      beforeBackground: getComputedStyle(scroll, '::before').backgroundColor,
      afterBackground: getComputedStyle(scroll, '::after').backgroundColor,
      beforeVariable: scroll.style.getPropertyValue('--semantic-dark-before-background'),
      afterVariable: scroll.style.getPropertyValue('--semantic-dark-after-background'),
      containerBackground: getComputedStyle(scroll.closest('.benchmark-card')).backgroundColor,
      rowBackground: getComputedStyle(row).backgroundColor,
      explicitPseudoProcessed: explicit.hasAttribute(beforeColorAttribute),
      explicitPseudoColor: getComputedStyle(explicit, '::before').color,
      explicitBackground: getComputedStyle(explicit).backgroundColor,
      inheritedPseudoProcessed: inherited.hasAttribute(beforeColorAttribute),
      inheritedPseudoColor: getComputedStyle(inherited, '::before').color,
      inheritedHostColor: getComputedStyle(inherited).color,
      inheritedBackground: getComputedStyle(inherited).backgroundColor,
    };
  }, {
    beforeAttribute: BEFORE_ATTRIBUTE,
    afterAttribute: AFTER_ATTRIBUTE,
    beforeColorAttribute: BEFORE_COLOR_ATTRIBUTE,
  });
}

export function verifyBaselineDomEffects(state, label = 'Baseline') {
  assert.equal(state.beforeProcessed, false, `${label} ::before was already processed`);
  assert.equal(state.afterProcessed, false, `${label} ::after was already processed`);
  assert.equal(state.beforeVariable, '', `${label} ::before retained a mapped variable`);
  assert.equal(state.afterVariable, '', `${label} ::after retained a mapped variable`);
  assert.ok(colorsNear(parseRgb(state.beforeBackground), [255, 255, 255]),
    `${label} ::before is not the authored white surface: ${state.beforeBackground}`);
  assert.ok(colorsNear(parseRgb(state.afterBackground), [255, 255, 255]),
    `${label} ::after is not the authored white surface: ${state.afterBackground}`);
  assert.equal(state.explicitPseudoProcessed, false,
    `${label} explicit pseudo color was already processed`);
  assert.equal(state.inheritedPseudoProcessed, false,
    `${label} inherited pseudo color was already processed`);
}

export function verifyTransformedDomEffects(state) {
  assert.equal(state.beforeProcessed, true, 'Generated ::before surface was not mapped');
  assert.equal(state.afterProcessed, true, 'Generated ::after surface was not mapped');
  assert.notEqual(state.beforeVariable, '', 'Generated ::before variable was not installed');
  assert.notEqual(state.afterVariable, '', 'Generated ::after variable was not installed');
  assert.ok(relativeLuminance(parseRgb(state.beforeBackground)) < 0.2,
    `Generated ::before remained too light: ${state.beforeBackground}`);
  assert.ok(relativeLuminance(parseRgb(state.afterBackground)) < 0.2,
    `Generated ::after remained too light: ${state.afterBackground}`);
  assert.ok(colorsNear(parseRgb(state.beforeBackground), parseRgb(state.afterBackground)),
    'Generated side rails no longer share one continuous surface');
  assert.ok(colorsNear(parseRgb(state.beforeBackground), parseRgb(state.containerBackground)),
    'Generated side rails no longer match the mapped table-card surface');
  assert.equal(state.explicitPseudoProcessed, true,
    'Explicit generated text color was not mapped');
  assert.ok(contrastRatio(
    parseRgb(state.explicitPseudoColor), parseRgb(state.explicitBackground),
  ) >= 4.5, 'Explicit generated text fell below 4.5:1 contrast');
  assert.equal(state.inheritedPseudoProcessed, false,
    'Inherited generated text was redundantly mapped');
  assert.equal(state.inheritedPseudoColor, state.inheritedHostColor,
    'Generated text no longer inherits its mapped host color');
  assert.ok(contrastRatio(
    parseRgb(state.inheritedPseudoColor), parseRgb(state.inheritedBackground),
  ) >= 4.5, 'Inherited generated text fell below 4.5:1 contrast');
}

export async function exerciseInteractiveDomEffects(page, timeout = 15_000) {
  const row = page.locator('#benchmark-hover-row');
  const [firstFrame] = await Promise.all([
    page.evaluate((timeoutMs) => new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        document.removeEventListener('pointerover', onPointerOver, true);
        reject(new Error('Timed out waiting for the first hovered frame'));
      }, timeoutMs);
      function onPointerOver(event) {
        if (!(event.target instanceof Element) ||
            event.target.closest('#benchmark-hover-row') == null) return;
        document.removeEventListener('pointerover', onPointerOver, true);
        requestAnimationFrame(() => {
          window.clearTimeout(timer);
          const element = document.querySelector('#benchmark-hover-row');
          const value = element?.querySelector('td');
          resolve({
            processed: element?.hasAttribute('data-semantic-dark-background') ?? false,
            background: element ? getComputedStyle(element).backgroundColor : '',
            text: value ? getComputedStyle(value).color : '',
          });
        });
      }
      document.addEventListener('pointerover', onPointerOver, true);
    }), timeout),
    row.locator('td').first().hover(),
  ]);
  const firstFrameBackground = parseRgb(firstFrame.background);
  assert.equal(firstFrame.processed, true,
    'Hovered row was not remapped before its first rendered frame');
  assert.ok(relativeLuminance(firstFrameBackground) < 0.2,
    `First hovered frame flashed light: ${firstFrame.background}`);
  assert.ok(contrastRatio(parseRgb(firstFrame.text), firstFrameBackground) >= 4.5,
    'First hovered frame fell below 4.5:1 text contrast');
  await page.waitForFunction((attribute) => {
    const element = document.querySelector('#benchmark-hover-row');
    return element?.hasAttribute(attribute) &&
      getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)';
  }, BACKGROUND_ATTRIBUTE, {timeout});
  const hovered = await page.evaluate((attribute) => {
    const element = document.querySelector('#benchmark-hover-row');
    const value = element?.querySelector('td');
    if (!element || !value) throw new Error('Interactive row fixture is missing');
    return {
      processed: element.hasAttribute(attribute),
      background: getComputedStyle(element).backgroundColor,
      text: getComputedStyle(value).color,
    };
  }, BACKGROUND_ATTRIBUTE);
  const background = parseRgb(hovered.background);
  assert.ok(relativeLuminance(background) < 0.2,
    `Hovered row remained too light: ${hovered.background}`);
  assert.ok(contrastRatio(parseRgb(hovered.text), background) >= 4.5,
    `Hovered row contrast fell below 4.5:1 (${hovered.text} on ${hovered.background})`);

  await page.locator('#dom-card').hover();
  await page.waitForFunction((attribute) => {
    const element = document.querySelector('#benchmark-hover-row');
    return element != null && !element.hasAttribute(attribute) &&
      getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)';
  }, BACKGROUND_ATTRIBUTE, {timeout});
  return {
    firstFrame,
    hovered,
    restoredBackground: await row.evaluate((element) => getComputedStyle(element).backgroundColor),
  };
}
