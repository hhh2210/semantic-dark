import {describe, expect, it} from 'vitest';

import {renderPairedThemeDocument} from '../../src/testing/paired-theme/render';
import type {SceneDefinition} from '../../src/testing/paired-theme/types';

function scene(): SceneDefinition {
  return {
    id: 'form',
    kind: 'form-focus',
    title: 'Form <focus>',
    paints: [
      {
        id: 'canvas', component: 'page', state: 'default', property: 'background-color',
        pseudo: null, role: 'background', token: 'canvas', backdropPaintId: null,
        contrastKind: 'none', reviewed: false,
      },
      {
        id: 'surface', component: 'input', state: 'default', property: 'background-color',
        pseudo: null, role: 'surface', token: 'surface', backdropPaintId: 'canvas',
        contrastKind: 'none', reviewed: true,
      },
      {
        id: 'focus', component: 'input', state: 'focus-visible', property: 'outline-color',
        pseudo: '::after', role: 'accent', token: 'focus', backdropPaintId: 'surface',
        contrastKind: 'non-text', reviewed: true,
      },
    ],
    surfacePairs: [{id: 'canvas-surface', lowerPaintId: 'canvas', upperPaintId: 'surface'}],
  };
}

const VALUES = {canvas: '#fff', surface: '#f1f3f5', focus: 'rgb(0 90 255 / 80%)'};

describe('paired-theme scene renderer', () => {
  it('renders the backdrop DAG and pseudo paint as deterministic self-contained HTML', () => {
    const html = renderPairedThemeDocument({title: 'Material & baseline', scenes: [scene()], paintValues: VALUES});
    const document = new DOMParser().parseFromString(html, 'text/html');
    const canvas = document.querySelector('[data-paint-id="canvas"]')!;
    const surface = document.querySelector('[data-paint-id="surface"]')!;
    const focus = document.querySelector('[data-paint-id="focus"]')!;

    expect(surface.parentElement).toBe(canvas);
    expect(focus.parentElement).toBe(surface);
    expect(focus.getAttribute('data-pseudo')).toBe('::after');
    expect(focus.getAttribute('style')).toContain('--paired-theme-paint:rgb(0 90 255 / 0.8)');
    expect(html).toContain('#paired-paint-2::after');
    expect(html).toContain('outline-color:var(--paired-theme-paint)');
    expect(html).toContain('Material &amp; baseline');
    expect(html).toContain('Form &lt;focus&gt;');
  });

  it('is byte-identical when scene paint input order changes', () => {
    const forward = scene();
    const reversed = {...forward, paints: [...forward.paints].reverse()};
    expect(renderPairedThemeDocument({title: 'same', scenes: [reversed], paintValues: VALUES}))
      .toBe(renderPairedThemeDocument({title: 'same', scenes: [forward], paintValues: VALUES}));
  });

  it('hard-fails missing, extra, duplicate, and unresolved paint inputs', () => {
    expect(() => renderPairedThemeDocument({
      title: 'missing', scenes: [scene()], paintValues: {canvas: '#fff', surface: '#eee'},
    })).toThrow('Missing paint value: focus');
    expect(() => renderPairedThemeDocument({
      title: 'extra', scenes: [scene()], paintValues: {...VALUES, extra: '#000'},
    })).toThrow('Unexpected paint value: extra');
    expect(() => renderPairedThemeDocument({
      title: 'invalid', scenes: [scene()], paintValues: {...VALUES, focus: 'var(--brand)'},
    })).toThrow('not a resolved CSS color');

    const duplicate = scene();
    duplicate.paints[2] = {...duplicate.paints[2]!, id: 'surface'};
    expect(() => renderPairedThemeDocument({
      title: 'duplicate', scenes: [duplicate], paintValues: VALUES,
    })).toThrow('Duplicate paint id');
  });
});
