import {describe, expect, it} from 'vitest';

import {formatCssColor, parseCssColor, srgb} from '../../src/color/index';

describe('CSS solid-color parsing', () => {
  it.each([
    ['#f80', srgb(1, 136 / 255, 0)],
    ['#ff880080', srgb(1, 136 / 255, 0, 128 / 255)],
    ['rgb(255, 128, 0, 0.25)', srgb(1, 128 / 255, 0, 0.25)],
    ['rgb(100% 50% 0% / 25%)', srgb(1, 0.5, 0, 0.25)],
    ['hsl(120deg 100% 25%)', srgb(0, 0.5, 0)],
    ['color(srgb 1 0.5 0 / 50%)', srgb(1, 0.5, 0, 0.5)],
    ['orange', srgb(1, 165 / 255, 0)],
  ])('parses %s', (input, expected) => {
    const parsed = parseCssColor(input);
    expect(parsed).not.toBeNull();
    expect(parsed!.r).toBeCloseTo(expected.r, 6);
    expect(parsed!.g).toBeCloseTo(expected.g, 6);
    expect(parsed!.b).toBeCloseTo(expected.b, 6);
    expect(parsed!.a).toBeCloseTo(expected.a, 6);
  });

  it('parses OKLab/OKLCH and rejects non-solid paints', () => {
    expect(parseCssColor('oklab(62.7955% 0.22486 0.12585)')!.r).toBeCloseTo(1, 3);
    expect(parseCssColor('oklch(62.7955% 0.25768 29.23)')!.r).toBeCloseTo(1, 3);
    expect(parseCssColor('none')).toBeNull();
    expect(parseCssColor('url(#paint)')).toBeNull();
    expect(parseCssColor('var(--brand)')).toBeNull();
    expect(parseCssColor('rgb(calc(1) 2 3)')).toBeNull();
  });

  it('round-trips serializer output without 8-bit quantization', () => {
    const source = srgb(0.1234567, 0.7654321, 0.3333333, 0.456789);
    const css = formatCssColor(source);
    const parsed = parseCssColor(css)!;
    expect(parsed.r).toBeCloseTo(source.r, 6);
    expect(parsed.g).toBeCloseTo(source.g, 6);
    expect(parsed.b).toBeCloseTo(source.b, 6);
    expect(parsed.a).toBeCloseTo(source.a, 6);
  });
});
