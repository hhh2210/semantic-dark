import {describe, expect, it} from 'vitest';

import {
  contrastRatio,
  mapCssGradient,
  mapRoleColor,
  parseCssColor,
} from '../../src/color';

describe('computed CSS gradient mapping', () => {
  it('maps the Inkling category stripe and preserves its transparent gutter', () => {
    const source = 'linear-gradient(to right, rgba(0, 0, 0, 0) 12px, ' +
      'color(srgb 0.952314 0.952314 0.952314) 12px)';
    const result = mapCssGradient(source, '#111416');

    expect(result).not.toBeNull();
    expect(result!.css).toContain('rgba(0, 0, 0, 0) 12px');
    expect(result!.css).not.toContain('0.952314');
    const background = parseCssColor(result!.readabilityBackground)!;
    const text = mapRoleColor(parseCssColor('#777')!, {
      role: 'text',
      against: background,
      minContrast: 4.5,
    });
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('maps multiple supported color syntaxes without changing gradient geometry', () => {
    const result = mapCssGradient(
      'linear-gradient(90deg, #fff 0%, hsl(0deg 0% 80%) 55%, rgb(20 80 160) 100%)',
      '#111416',
    );
    expect(result?.css).toContain('linear-gradient(90deg');
    expect(result?.css).toContain('55%');
    expect(result?.css).toContain('100%');
    expect(result?.css).not.toContain('#fff');
  });

  it('preserves URL layers, quoted filenames, and comments byte-for-byte', () => {
    const source = 'url("https://example.com/red.png"), ' +
      'url(icons/blue-mark.svg), /* white stays documentation */ ' +
      'linear-gradient(white, black)';
    const result = mapCssGradient(source, '#111416');

    expect(result?.css).toContain('url("https://example.com/red.png")');
    expect(result?.css).toContain('url(icons/blue-mark.svg)');
    expect(result?.css).toContain('/* white stays documentation */');
    expect(result?.css).not.toContain('linear-gradient(white, black)');
  });

  it('abstains on non-gradient paints and gradients without solid stops', () => {
    expect(mapCssGradient('url(hero.png)', '#111416')).toBeNull();
    expect(mapCssGradient('linear-gradient(transparent, transparent)', '#111416')).toBeNull();
  });
});
