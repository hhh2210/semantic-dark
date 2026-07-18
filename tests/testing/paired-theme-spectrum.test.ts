import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import spectrumProtocol from '../../fixtures/paired-theme/spectrum-v1.protocol.json';
import {parseCssColor} from '../../src/color';
import {normalizedTokenHash} from '../../src/testing/paired-theme/material';
import {validateProtocol} from '../../src/testing/paired-theme/protocol';
import {
  parseSpectrumThemePair,
  spectrumThemePair,
} from '../../src/testing/paired-theme/spectrum';
import type {SpectrumProtocolSource} from '../../src/testing/paired-theme/types';

const require = createRequire(import.meta.url);
const EXPECTED = {
  canvas: ['background-base-color', 'rgb(255, 255, 255)', 'rgb(17, 17, 17)'],
  surface: ['background-layer-1-color', 'rgb(248, 248, 248)', 'rgb(27, 27, 27)'],
  surfaceRaised: ['background-elevated-color', 'rgb(255, 255, 255)', 'rgb(34, 34, 34)'],
  textPrimary: ['neutral-content-color-default', 'rgb(41, 41, 41)', 'rgb(219, 219, 219)'],
  textSecondary: ['neutral-subdued-content-color-default', 'rgb(80, 80, 80)', 'rgb(175, 175, 175)'],
  tableHeader: ['background-base-color', 'rgb(255, 255, 255)', 'rgb(17, 17, 17)'],
  selectedSurface: ['table-selected-row-background-color + table-selected-row-background-opacity', 'rgb(59 99 251 / 0.1)', 'rgb(64 105 253 / 0.1)'],
  border: ['neutral-subdued-content-color-default', 'rgb(80, 80, 80)', 'rgb(175, 175, 175)'],
  focus: ['focus-indicator-color', 'rgb(75, 117, 255)', 'rgb(64, 105, 253)'],
  dangerSurface: ['negative-subtle-background-color-default', 'rgb(255, 235, 232)', 'rgb(87, 17, 7)'],
  dangerText: ['neutral-content-color-default', 'rgb(41, 41, 41)', 'rgb(219, 219, 219)'],
} as const;

describe('Spectrum paired-theme adapter', () => {
  it('resolves the pinned cascade into exact authored light/dark semantic pairs', () => {
    const source = spectrumSource();
    const theme = spectrumThemePair(source);
    expect(theme).toMatchObject({system: 'spectrum', split: 'development', source: source.package});
    for (const [name, [sourceToken, light, dark]] of Object.entries(EXPECTED)) {
      const token = theme.tokens[name as keyof typeof EXPECTED];
      expect(token).toMatchObject({name, sourceToken, light, dark, provenance: 'authored-token'});
      expect(token.resolutionPath?.light.length).toBeGreaterThan(1);
      expect(token.resolutionPath?.dark.length).toBeGreaterThan(1);
    }
    expect(parseCssColor(theme.tokens.selectedSurface.light)?.a).toBeCloseTo(0.1, 12);
    expect(theme.tokens.selectedSurface.resolutionPath?.light.at(-1)).toBe(
      '61b3aa04-0e7e-44b8-a4c8-8442a4ebf549',
    );
    expect(normalizedTokenHash(theme)).toBe(
      '654fbd12349f31a9d43c8097ee9ccf380e503ff4a353cff3c19695b472ec889a',
    );
  });

  it('preserves real cross-system differences instead of inventing uniform roles', () => {
    const theme = spectrumThemePair(spectrumSource());
    expect(theme.tokens.tableHeader.light).toBe(theme.tokens.canvas.light);
    expect(theme.tokens.tableHeader.dark).toBe(theme.tokens.canvas.dark);
    expect(theme.tokens.dangerText.sourceToken).toBe('neutral-content-color-default');
    expect(theme.tokens.surfaceRaised.dark).not.toBe(theme.tokens.surface.dark);
  });

  it('hard-fails missing selected color/opacity roots and protocol drift', () => {
    const source = spectrumSource();
    const missingOpacity = documents(source).map((document) => document.filter((value) =>
      !(isRecord(value) && value.uuid === '61b3aa04-0e7e-44b8-a4c8-8442a4ebf549'),
    ));
    expect(() => parseSpectrumThemePair(source, missingOpacity)).toThrow(/opacity root/);

    const missingColor = documents(source).map((document) => document.filter((value) =>
      !(isRecord(value) && value.uuid === 'b7537f50-bd49-44b6-a171-19943d443d24'),
    ));
    expect(() => parseSpectrumThemePair(source, missingColor)).toThrow(/Missing Spectrum reference/);

    expect(() => spectrumThemePair({...source, tokenPaths: [...source.tokenPaths].reverse()} as
      unknown as SpectrumProtocolSource)).toThrow(/token paths/);
  });
});

function spectrumSource(): SpectrumProtocolSource {
  const protocol = validateProtocol(spectrumProtocol);
  if (protocol.source.system !== 'spectrum') throw new Error('Expected Spectrum protocol');
  return protocol.source;
}

function documents(source: SpectrumProtocolSource): unknown[][] {
  const packageRoot = path.dirname(require.resolve('@adobe/spectrum-design-data/package.json'));
  return source.tokenPaths.map((tokenPath) => JSON.parse(readFileSync(
    path.join(packageRoot, tokenPath), 'utf8',
  )) as unknown[]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
