import {describe, expect, it} from 'vitest';

import {
  contrastRatio,
  hueDistanceDegrees,
  MINIMUM_SURFACE_SEPARATION,
  mapColor,
  mapRoleColor,
  mapRoleColorWithReport,
  parseCssColor,
  srgb,
  srgbToOklch,
} from '../../src/color/index';
import type {SvgColorTransformer} from '../../src/svg/types';

function random(seed = 0xd4a4b10c): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('semantic dark role mapping', () => {
  it('keeps background and surface roles inside their dark lightness bands', () => {
    const next = random();
    for (let sample = 0; sample < 400; sample += 1) {
      const source = srgb(next(), next(), next());
      const background = srgbToOklch(mapRoleColor(source, {role: 'background'}));
      const surface = srgbToOklch(mapRoleColor(source, {role: 'surface'}));
      expect(background.l).toBeGreaterThanOrEqual(0.08 - 2e-6);
      expect(background.l).toBeLessThanOrEqual(0.22 + 2e-6);
      expect(surface.l).toBeGreaterThanOrEqual(0.24 - 2e-6);
      expect(surface.l).toBeLessThanOrEqual(0.4 + 2e-6);
    }
  });

  it('keeps authored surface hierarchy visible above the dark canvas', () => {
    const canvas = parseCssColor('#111416')!;
    const sources = [1, 0.92, 0.72, 0.48, 0.16];
    const mapped = sources.map((channel) =>
      mapRoleColor(srgb(channel, channel, channel), {role: 'surface', against: canvas}),
    );

    for (const surface of mapped) {
      expect(contrastRatio(surface, canvas)).toBeGreaterThanOrEqual(MINIMUM_SURFACE_SEPARATION);
    }
    for (let index = 1; index < mapped.length; index += 1) {
      expect(srgbToOklch(mapped[index]!).l).toBeGreaterThan(srgbToOklch(mapped[index - 1]!).l);
    }
  });

  it('guarantees text and important non-text contrast against mapped backgrounds', () => {
    const next = random(0xc057aa17);
    for (let sample = 0; sample < 350; sample += 1) {
      const background = mapRoleColor(srgb(next(), next(), next()), {role: 'background'});
      const source = srgb(next(), next(), next(), next());
      const text = mapRoleColor(source, {role: 'text', against: background});
      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);

      for (const role of ['border', 'accent', 'svgFill', 'svgStroke'] as const) {
        const mapped = mapRoleColor(source, {role, against: background});
        expect(contrastRatio(mapped, background)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('preserves hue whenever the mapped color retains meaningful chroma', () => {
    const next = random(0x0c11c0de);
    for (let sample = 0; sample < 300; sample += 1) {
      const source = srgb(next(), next(), next());
      const mapped = mapRoleColor(source, {role: 'accent'});
      const sourceLch = srgbToOklch(source);
      const mappedLch = srgbToOklch(mapped);
      if (sourceLch.c > 1e-4 && mappedLch.c > 1e-4) {
        expect(hueDistanceDegrees(sourceLch.h, mappedLch.h)).toBeLessThan(0.003);
      }
      expect(mappedLch.c).toBeLessThanOrEqual(sourceLch.c + 2e-6);
    }
  });

  it('exposes achieved constraints in the detailed report', () => {
    const background = srgb(0.03, 0.03, 0.03);
    const report = mapRoleColorWithReport(srgb(0.1, 0.1, 0.1, 0.05), {
      role: 'text',
      against: background,
    });
    expect(report.role).toBe('text');
    expect(report.minimumContrast).toBe(4.5);
    expect(report.achievedContrast).toBeGreaterThanOrEqual(4.5);
    expect(report.color.a).toBe(1);
  });

  it('normalizes DOM and SVG role aliases onto the shared engine', () => {
    const source = srgb(0.2, 0.5, 0.9);
    expect(mapRoleColor(source, {role: 'text-fill'})).toEqual(mapRoleColor(source, {role: 'text'}));
    expect(mapRoleColor(source, {role: 'text-outline'})).toEqual(mapRoleColor(source, {role: 'svgStroke'}));
    expect(mapRoleColor(source, {role: 'graphic', property: 'fill'})).toEqual(
      mapRoleColor(source, {role: 'svgFill'}),
    );
    expect(mapRoleColor(source, {role: 'graphic', property: 'stroke'})).toEqual(
      mapRoleColor(source, {role: 'svgStroke'}),
    );
  });
});

describe('mapColor integration wrapper', () => {
  it('returns parseable CSS with thresholds intact after serialization', () => {
    const background = mapColor('#fff', {role: 'background'});
    const text = mapColor('rgba(0, 0, 0, 0.1)', {
      role: 'text',
      background,
      minContrast: 4.5,
      preserveHue: true,
    });
    const border = mapColor('rebeccapurple', {role: 'border', background});
    expect(contrastRatio(parseCssColor(text)!, parseCssColor(background)!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseCssColor(border)!, parseCssColor(background)!)).toBeGreaterThanOrEqual(3);
  });

  it('passes unresolved paints through unchanged', () => {
    for (const paint of ['none', 'url(#gradient)', 'var(--brand)', 'currentColor']) {
      expect(mapColor(paint, {role: 'graphic-fill'})).toBe(paint);
    }
  });

  it('is parameter-compatible with the SVG transformer request shape', () => {
    const transformer: SvgColorTransformer = {mapColor};
    const output = transformer.mapColor('#268bd2', {
      role: 'graphic',
      property: 'stroke',
      background: '#121212',
      sourceBackground: '#fff',
      preserveHue: true,
      minContrast: 3,
    });
    expect(contrastRatio(parseCssColor(output)!, parseCssColor('#121212')!)).toBeGreaterThanOrEqual(3);
  });
});
