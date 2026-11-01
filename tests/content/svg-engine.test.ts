import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it} from 'vitest';
import {PREPAINT_ATTRIBUTE} from '../../src/content/prepaint';
import {SvgThemeEngine} from '../../src/content/svg-engine';
import {DEFAULT_THEME} from '../../src/types';

const running: SvgThemeEngine[] = [];

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

afterEach(() => {
  for (const engine of running) engine.stop();
  running.length = 0;
  document.documentElement.innerHTML = '<head></head><body></body>';
  document.documentElement.removeAttribute('data-semantic-dark-active');
  document.documentElement.removeAttribute(PREPAINT_ATTRIBUTE);
});

describe('SvgThemeEngine', () => {
  it('finds the authored backdrop of an SVG inserted under the pre-paint', async () => {
    const sheet = document.createElement('style');
    sheet.textContent = `${readFileSync('extension/prepaint.css', 'utf8')}
      body { background-color: rgb(252, 252, 252); }`;
    document.head.append(sheet);
    document.documentElement.setAttribute('data-semantic-dark-active', '');
    document.documentElement.setAttribute(PREPAINT_ATTRIBUTE, '');
    const engine = new SvgThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();

    const figure = document.createElement('figure');
    figure.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="backdrop" width="100%" height="100%" fill="#fcfcfc"/>
      </svg>`;
    document.body.append(figure);
    await nextTask();

    expect(figure.querySelector('#backdrop')!.getAttribute('fill')).toBe(DEFAULT_THEME.background);
    expect(document.documentElement.hasAttribute(PREPAINT_ATTRIBUTE)).toBe(true);
  });
});
