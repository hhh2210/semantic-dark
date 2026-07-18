import {describe, expect, it} from 'vitest';

import {
  compositeSrgb,
  compositeSrgbLinearLight,
  contrastRatio,
  ensureContrast,
  ensureContrastWithReport,
  hueDistanceDegrees,
  relativeLuminance,
  srgb,
  srgbToOklch,
} from '../../src/color/index';

function random(seed = 0xc017a57): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

describe('alpha compositing', () => {
  it('handles transparent, opaque, and half-alpha source-over anchors', () => {
    const background = srgb(0.1, 0.2, 0.3);
    expect(compositeSrgb(srgb(0.9, 0.8, 0.7, 0), background)).toEqual(background);
    expect(compositeSrgb(srgb(0.9, 0.8, 0.7), background)).toEqual(srgb(0.9, 0.8, 0.7));
    expect(compositeSrgb(srgb(1, 1, 1, 0.5), srgb(0, 0, 0))).toEqual(srgb(0.5, 0.5, 0.5));
  });

  it('provides explicit linear-light compositing', () => {
    const result = compositeSrgbLinearLight(srgb(1, 1, 1, 0.5), srgb(0, 0, 0));
    expect(result.r).toBeCloseTo(0.735357, 5);
    expect(result.g).toBeCloseTo(result.r, 12);
    expect(result.b).toBeCloseTo(result.r, 12);
  });

  it('is associative for random source-over layers', () => {
    const next = random();
    for (let sample = 0; sample < 300; sample += 1) {
      const a = srgb(next(), next(), next(), next());
      const b = srgb(next(), next(), next(), next());
      const c = srgb(next(), next(), next(), next());
      const left = compositeSrgb(a, compositeSrgb(b, c));
      const right = compositeSrgb(compositeSrgb(a, b), c);
      expect(left.r).toBeCloseTo(right.r, 11);
      expect(left.g).toBeCloseTo(right.g, 11);
      expect(left.b).toBeCloseTo(right.b, 11);
      expect(left.a).toBeCloseTo(right.a, 11);
    }
  });
});

describe('WCAG contrast constraints', () => {
  it('matches luminance and contrast anchors', () => {
    expect(relativeLuminance(srgb(0, 0, 0))).toBe(0);
    expect(relativeLuminance(srgb(1, 1, 1))).toBeCloseTo(1, 12);
    expect(contrastRatio(srgb(0, 0, 0), srgb(1, 1, 1))).toBeCloseTo(21, 12);
    expect(contrastRatio(srgb(1, 1, 1), srgb(0, 0, 0))).toBeCloseTo(21, 12);
  });

  it('finds a 4.5:1 solution for arbitrary opaque foreground/background pairs', () => {
    const next = random(0x4c4f4f50);
    for (let sample = 0; sample < 400; sample += 1) {
      const foreground = srgb(next(), next(), next());
      const background = srgb(next(), next(), next());
      const adjusted = ensureContrast(foreground, background, 4.5);
      expect(contrastRatio(adjusted, background)).toBeGreaterThanOrEqual(4.5 - 1e-7);

      const before = srgbToOklch(foreground);
      const after = srgbToOklch(adjusted);
      if (before.c > 1e-4 && after.c > 1e-4) {
        expect(hueDistanceDegrees(before.h, after.h)).toBeLessThan(0.003);
      }
    }
  });

  it('raises opacity only when lightness alone cannot satisfy the threshold', () => {
    const foreground = srgb(0.8, 0.2, 0.1, 0.05);
    const background = srgb(0.05, 0.05, 0.05);
    const report = ensureContrastWithReport(foreground, background, 4.5);
    expect(report.attainable).toBe(true);
    expect(report.color.a).toBe(1);
    expect(report.ratio).toBeGreaterThanOrEqual(4.5 - 1e-7);
  });

  it('reports an impossible constrained-alpha request instead of claiming success', () => {
    const report = ensureContrastWithReport(
      srgb(1, 1, 1, 0.01),
      srgb(0, 0, 0),
      7,
      {allowAlphaIncrease: false},
    );
    expect(report.attainable).toBe(false);
    expect(report.color.a).toBeCloseTo(0.01, 12);
  });
});
