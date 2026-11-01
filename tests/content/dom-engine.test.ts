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
  it('registers host variables as non-inherited only in the document sheet', () => {
    const documentCss = domOverrideCss(true);
    expect(documentCss).toContain('@property --semantic-dark-background { syntax: \'*\'; inherits: false; }');
    expect(documentCss).toContain('@property --semantic-dark-color { syntax: \'*\'; inherits: false; }');
    // Generated content inherits its variables from the originating element.
    expect(documentCss).not.toContain('@property --semantic-dark-before-background');
    expect(domOverrideCss(false)).not.toContain('@property');
  });

  it('reports idle only once every queued element has been mapped', async () => {
    document.body.innerHTML = '<main style="background:#fff;color:#111">Text</main>';
    const main = document.querySelector<HTMLElement>('main')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);

    engine.start();
    let mapped: boolean | null = null;
    const idle = engine.whenIdle().then(() => {
      mapped = main.hasAttribute('data-semantic-dark-background');
    });
    expect(mapped).toBe(null);
    await idle;
    expect(mapped).toBe(true);
    await expect(engine.whenIdle()).resolves.toBeUndefined();
  });

  it('releases idle waiters when it stops before draining', async () => {
    document.body.innerHTML = '<main style="background:#fff">Text</main>';
    const engine = new DomThemeEngine(DEFAULT_THEME);
    engine.start();
    const idle = engine.whenIdle();
    engine.stop();
    await expect(idle).resolves.toBeUndefined();
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

  it('maps inherited text containers instead of leaving black nested text on dark surfaces', async () => {
    document.body.innerHTML = `
      <article style="background:#fff;color:#000">
        <h2 style="color:#111"><span>Nested heading</span></h2>
        <p style="color:#222">Inherited paragraph text</p>
      </article>`;
    const article = document.querySelector<HTMLElement>('article')!;
    const heading = document.querySelector<HTMLElement>('h2')!;
    const paragraph = document.querySelector<HTMLElement>('p')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    document.documentElement.setAttribute('data-semantic-dark-active', '');
    engine.start();
    await nextTask();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(article.hasAttribute('data-semantic-dark-color')).toBe(true);
    expect(heading.hasAttribute('data-semantic-dark-color')).toBe(true);
    expect(paragraph.hasAttribute('data-semantic-dark-color')).toBe(true);
    expect(article.style.getPropertyValue('--semantic-dark-color')).toMatch(/^rgb/);
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

  it('keeps existing mappings painted while a rescan remaps them', async () => {
    document.body.innerHTML = '<article id="card" style="background:#fff;color:#222">Card</article>';
    const card = document.querySelector<HTMLElement>('#card')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();
    const mapped = card.style.getPropertyValue('--semantic-dark-background');

    engine.rescan();

    // A CSSOM change must not expose the authored light surface until idle time.
    expect(card.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(card.style.getPropertyValue('--semantic-dark-background')).toBe(mapped);
    await nextTask();
    expect(card.style.getPropertyValue('--semantic-dark-background')).toBe(mapped);
  });

  it('remaps a class-changed element before the next paint', async () => {
    document.head.innerHTML = '<style>.card{background:#fff;color:#222}.card.selected{background:#ddf4ff}</style>';
    document.body.innerHTML = '<article id="card" class="card">Card</article>';
    const card = document.querySelector<HTMLElement>('#card')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();
    const before = card.style.getPropertyValue('--semantic-dark-background');

    card.classList.add('selected');
    await Promise.resolve();

    // The mutation callback runs before rendering; the new state is already mapped.
    expect(card.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(card.style.getPropertyValue('--semantic-dark-background')).toMatch(/^rgb/);
    expect(card.style.getPropertyValue('--semantic-dark-background')).not.toBe(before);
  });

  it('maps inserted content before the next paint', async () => {
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();

    const panel = document.createElement('section');
    panel.innerHTML = '<div id="item" style="background:#f6f8fa;color:#111">Inserted</div>';
    panel.style.background = '#fff';
    document.body.append(panel);
    await Promise.resolve();

    const item = panel.querySelector<HTMLElement>('#item')!;
    expect(panel.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(item.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(item.hasAttribute('data-semantic-dark-color')).toBe(true);
  });

  it('maps an inserted host and its open shadow content before the next paint', async () => {
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();

    const host = document.createElement('section');
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = '<div id="surface" style="background:#fff;color:#111">shadow</div>';
    document.body.append(host);
    await Promise.resolve();

    const surface = shadow.querySelector<HTMLElement>('#surface')!;
    expect(surface.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(surface.hasAttribute('data-semantic-dark-color')).toBe(true);
  });

  it('keeps a large mapped container on its previous mapping until idle time', async () => {
    document.head.innerHTML = '<style>#app{background:#fff;color:#222}#app.modal-open{background:#2f6feb}</style>';
    document.body.innerHTML = `<div id="app">${'<p>row</p>'.repeat(600)}</div>`;
    const app = document.querySelector<HTMLElement>('#app')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const before = app.style.getPropertyValue('--semantic-dark-background');
    expect(before).toMatch(/^rgb/);

    app.classList.add('modal-open');
    await Promise.resolve();

    // Remapping it synchronously would restyle all 600 descendants before paint.
    expect(app.hasAttribute('data-semantic-dark-background')).toBe(true);
    expect(app.style.getPropertyValue('--semantic-dark-background')).toBe(before);
    for (let attempt = 0; attempt < 60 &&
      app.style.getPropertyValue('--semantic-dark-background') === before; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(app.style.getPropertyValue('--semantic-dark-background')).not.toBe(before);
  }, 15_000);

  it('finishes before-paint mapping across frames even when every frame runs out of budget', async () => {
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();
    const realNow = performance.now.bind(performance);
    let skew = 0;
    // Each clock read costs 5ms, so every drain exhausts its budget almost at once.
    performance.now = () => realNow() + (skew += 5);
    try {
      const outer = document.createElement('section');
      outer.innerHTML = Array.from({length: 30}, (_, index) =>
        `<div class="row" style="background:#fff;color:#111">Row ${index}</div>`).join('');
      document.body.append(outer);
      outer.classList.add('open');
      outer.firstElementChild!.classList.add('selected');
      for (let frame = 0; frame < 200; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const state = engine as unknown as {urgent: Element[]; frameHandle: number | null};
        if (state.urgent.length === 0 && state.frameHandle === null) break;
      }
    } finally {
      performance.now = realNow;
    }
    const state = engine as unknown as {urgent: Element[]; frameHandle: number | null};
    expect(state.urgent).toEqual([]);
    expect(state.frameHandle).toBeNull();
    for (const row of document.querySelectorAll('.row')) {
      expect(row.hasAttribute('data-semantic-dark-background')).toBe(true);
    }
  });

  it('releases removed elements on rescan', async () => {
    document.body.innerHTML = '<p id="gone" style="color:#222">Removed</p>';
    const gone = document.querySelector<HTMLElement>('#gone')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();
    const state = engine as unknown as {touched: Set<HTMLElement>};
    expect(state.touched.has(gone)).toBe(true);

    gone.remove();
    engine.rescan();

    expect(state.touched.has(gone)).toBe(false);
  });

  it('restores elements that were remapped after a mutation when disabled', async () => {
    document.head.innerHTML = '<style>.card{background:#fff;color:#222}.card.selected{background:#ddf4ff}</style>';
    document.body.innerHTML = '<article id="card" class="card">Card</article>';
    const card = document.querySelector<HTMLElement>('#card')!;
    const engine = new DomThemeEngine(DEFAULT_THEME);
    running.push(engine);
    engine.start();
    await nextTask();
    card.classList.add('selected');
    await Promise.resolve();
    engine.rescan();
    await nextTask();

    engine.update({...DEFAULT_THEME, enabled: false});

    expect(card.hasAttribute('data-semantic-dark-background')).toBe(false);
    expect(card.style.getPropertyValue('--semantic-dark-background')).toBe('');
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
