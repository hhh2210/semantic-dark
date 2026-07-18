import {afterEach, describe, expect, it} from 'vitest';
import {DomThemeEngine} from '../../src/content/dom-engine';
import {DOM_ATTRIBUTE, domOverrideCss} from '../../src/content/dom-style-contract';
import {DEFAULT_THEME} from '../../src/types';

const running: DomThemeEngine[] = [];

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

afterEach(() => {
  for (const engine of running) engine.stop();
  running.length = 0;
  document.documentElement.innerHTML = '<head></head><body></body>';
  document.documentElement.removeAttribute('data-semantic-dark-active');
});

describe('DomThemeEngine', () => {
  it('scopes document overrides to both the root itself and its descendants', () => {
    const css = domOverrideCss(true);
    expect(css).toContain(`:root[data-semantic-dark-active][${DOM_ATTRIBUTE.background}]`);
    expect(css).toContain(`:root[data-semantic-dark-active] [${DOM_ATTRIBUTE.background}]`);
    expect(css).toContain(`:root[data-semantic-dark-active][${DOM_ATTRIBUTE.updating}]`);
    expect(css).toContain(
      `:root[data-semantic-dark-active] [${DOM_ATTRIBUTE.beforeBackground}]::before`,
    );
    expect(css).toContain(
      `:root[data-semantic-dark-active] [${DOM_ATTRIBUTE.afterBackground}]::after`,
    );
  });
  it('maps authored backgrounds, text, and borders through role variables', async () => {
    document.body.innerHTML = `
      <article id="card" style="background-color:#fff;color:#333;border:1px solid #bbb">
        Semantic colors
      </article>`;
    const card = document.querySelector<HTMLElement>('#card')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);

    engine.start();
    await nextTask();

    expect(card.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(card.hasAttribute('data-semantic-dark-color')).toBe(true);
    expect(card.hasAttribute('data-semantic-dark-border')).toBe(true);
    expect(card.style.getPropertyValue('--semantic-dark-background')).toMatch(/^rgb/);
    expect(card.style.getPropertyValue('--semantic-dark-color')).toMatch(/^rgb/);
  });

  it('restores every extension-owned attribute and variable when disabled', async () => {
    document.body.innerHTML = '<p id="text" style="color:#222">Readable</p>';
    const text = document.querySelector<HTMLElement>('#text')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();

    engine.update({...DEFAULT_THEME, enabled: false});

    expect(text.hasAttribute('data-semantic-dark-color')).toBe(false);
    expect(text.style.getPropertyValue('--semantic-dark-color')).toBe('');
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(false);
  });

  it('discovers and themes elements added inside an open shadow root', async () => {
    const host = document.createElement('section');
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = '<div id="surface" style="background:#fff;color:#111">shadow</div>';
    document.body.append(host);
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);

    engine.start();
    await nextTask();

    const surface = shadow.querySelector<HTMLElement>('#surface')!;
    expect(shadow.querySelector('style[data-semantic-dark-sheet]')).not.toBeNull();
    expect(surface.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(surface.hasAttribute('data-semantic-dark-color')).toBe(true);
  });

  it('jointly maps gradient-backed labels and their text for readability', async () => {
    document.body.innerHTML = `
      <table><tbody><tr>
        <th id="category" style="background-image:linear-gradient(to right, transparent 12px, #f3f3f3 12px);color:#777">
          Audio
        </th>
      </tr></tbody></table>`;
    const category = document.querySelector<HTMLElement>('#category')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);

    engine.start();
    await nextTask();

    expect(category.hasAttribute('data-semantic-dark-background-image')).toBe(true);
    expect(category.style.getPropertyValue('--semantic-dark-background-image')).not.toContain('#f3f3f3');
    expect(category.hasAttribute('data-semantic-dark-color')).toBe(true);
  });
});
