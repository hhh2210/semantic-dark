import {describe, expect, it} from 'vitest';

import {
  gamutMapOklch,
  hueDistanceDegrees,
  isSrgbInGamut,
  linearToSrgb,
  oklabToOklch,
  oklabToSrgbUnclipped,
  oklchToOklab,
  srgb,
  srgbToLinear,
  srgbToOklab,
  srgbToOklch,
} from '../../src/color/index';

function random(seed = 0x51f15e): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('sRGB and OKLab conversions', () => {
  it('round-trips random sRGB channels through linear light', () => {
    const next = random();
    for (let sample = 0; sample < 800; sample += 1) {
      const source = srgb(next(), next(), next(), next());
      const restored = linearToSrgb(srgbToLinear(source));
      expect(restored.r).toBeCloseTo(source.r, 12);
      expect(restored.g).toBeCloseTo(source.g, 12);
      expect(restored.b).toBeCloseTo(source.b, 12);
      expect(restored.a).toBe(source.a);
    }
  });

  it('round-trips random in-gamut colors through OKLab', () => {
    const next = random(0x0c01ab);
    for (let sample = 0; sample < 600; sample += 1) {
      const source = srgb(next(), next(), next(), next());
      const restored = oklabToSrgbUnclipped(srgbToOklab(source));
      expect(restored.r).toBeCloseTo(source.r, 5);
      expect(restored.g).toBeCloseTo(source.g, 5);
      expect(restored.b).toBeCloseTo(source.b, 5);
      expect(restored.a).toBe(source.a);
    }
  });

  it('matches the published OKLab red anchor', () => {
    const red = srgbToOklab(srgb(1, 0, 0));
    expect(red.l).toBeCloseTo(0.627955, 5);
    expect(red.a).toBeCloseTo(0.224863, 5);
    expect(red.b).toBeCloseTo(0.125846, 5);
  });

  it('round-trips OKLab and OKLCH polar coordinates', () => {
    const next = random(0x1c4c0de);
    for (let sample = 0; sample < 500; sample += 1) {
      const lab = {l: next(), a: next() * 0.5 - 0.25, b: next() * 0.5 - 0.25, alpha: next()};
      const restored = oklchToOklab(oklabToOklch(lab));
      expect(restored.l).toBeCloseTo(lab.l, 12);
      expect(restored.a).toBeCloseTo(lab.a, 12);
      expect(restored.b).toBeCloseTo(lab.b, 12);
      expect(restored.alpha).toBe(lab.alpha);
    }
  });

  it('gamut-maps arbitrary OKLCH by reducing chroma, not rotating hue', () => {
    const next = random(0x6a6d7574);
    for (let sample = 0; sample < 500; sample += 1) {
      const source = {l: next(), c: next() * 0.65, h: next() * 720 - 180, alpha: next()};
      const mapped = gamutMapOklch(source);
      expect(isSrgbInGamut(mapped)).toBe(true);
      expect(Number.isFinite(mapped.r + mapped.g + mapped.b + mapped.a)).toBe(true);

      const restored = srgbToOklch(mapped);
      expect(restored.l).toBeCloseTo(source.l, 5);
      // Hue is numerically undefined only extremely close to the neutral axis.
      if (restored.c > 1e-4) {
        expect(hueDistanceDegrees(restored.h, source.h)).toBeLessThan(0.002);
      }
      expect(restored.c).toBeLessThanOrEqual(source.c + 2e-6);
    }
  });
});
