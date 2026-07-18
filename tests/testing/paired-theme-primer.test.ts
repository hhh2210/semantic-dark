import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {serializeCanonicalJson, sha256Text} from '../../src/testing/artifacts';
import {
  parsePrimerThemePair,
  primerThemePair,
} from '../../src/testing/paired-theme/primer';
import type {PackagePin, PrimerProtocolSource} from '../../src/testing/paired-theme/types';

const require = createRequire(import.meta.url);
const PRIMER_PIN: PackagePin = {
  name: '@primer/primitives',
  version: '11.9.0',
  integrity: 'sha512-yESOalhd7s7S3unV1V32v3Z0RszXiiz6pzy6hVI9xpdTh1q1Gt8vyDFxRlqIvuwc5ZaO1+gYQTDbjxb4nWBzMw==',
  license: 'MIT',
  repository: 'https://github.com/primer/primitives',
};
const PRIMER_SOURCE: PrimerProtocolSource = {
  system: 'primer',
  kind: 'static-token-json',
  package: PRIMER_PIN,
  lightPath: 'dist/docs/functional/themes/light.json',
  darkPath: 'dist/docs/functional/themes/dark.json',
};

const EXPECTED = {
  canvas: ['bgColor-inset', '#f6f8fa', '#010409'],
  surface: ['bgColor-default', '#ffffff', '#0d1117'],
  surfaceRaised: ['bgColor-muted', '#f6f8fa', '#151b23'],
  textPrimary: ['fgColor-default', '#1f2328', '#f0f6fc'],
  textSecondary: ['fgColor-muted', '#59636e', '#9198a1'],
  tableHeader: ['bgColor-muted', '#f6f8fa', '#151b23'],
  selectedSurface: ['bgColor-accent-muted', '#ddf4ff', '#388bfd1a'],
  border: ['borderColor-default', '#d1d9e0', '#3d444d'],
  focus: ['focus-outline-color', '#0969da', '#1f6feb'],
  dangerSurface: ['bgColor-danger-muted', '#ffebe9', '#f851491a'],
  dangerText: ['fgColor-danger', '#d1242f', '#f85149'],
} as const;

describe('Primer paired-theme adapter', () => {
  it('loads the exact pinned authored values and source ids', () => {
    const theme = primerThemePair(PRIMER_SOURCE);
    expect(theme).toMatchObject({
      system: 'primer',
      split: 'development',
      source: PRIMER_PIN,
    });
    expect(Object.keys(theme.tokens)).toEqual(Object.keys(EXPECTED));
    for (const [name, [sourceToken, light, dark]] of Object.entries(EXPECTED)) {
      expect(theme.tokens[name as keyof typeof EXPECTED]).toEqual({
        name,
        light,
        dark,
        sourceToken,
        provenance: 'authored-token',
      });
    }
    expect(sha256Text(serializeCanonicalJson(theme.tokens))).toBe(
      '25b20161ece850eeafc8971ffa6e33421df0642dc8fd01fe14affe70c279f9dc',
    );
  });

  it('uses each document resolved value rather than its unresolved original alias', () => {
    const {light, dark} = loadDocuments();
    expect((light['bgColor-inset'] as TokenDocument).original?.$value).toBe('{bgColor.muted}');
    expect((dark['bgColor-inset'] as TokenDocument).original?.$value).toBe('{base.color.neutral.0}');
    const theme = parsePrimerThemePair(PRIMER_SOURCE, light, dark);
    expect(theme.tokens.canvas).toMatchObject({light: '#f6f8fa', dark: '#010409'});
  });

  it('hard-fails pin drift, missing tokens, malformed shapes, and mismatched token keys', () => {
    expect(() => primerThemePair({...PRIMER_SOURCE,
      package: {...PRIMER_PIN, version: '11.9.1'}})).toThrow(/pin mismatch for version/);

    const missing = loadDocuments();
    delete missing.light['fgColor-default'];
    expect(() => parsePrimerThemePair(PRIMER_SOURCE, missing.light, missing.dark))
      .toThrow(/light theme is missing fgColor-default/);

    const malformed = loadDocuments();
    malformed.dark['fgColor-muted'] = '#9198a1';
    expect(() => parsePrimerThemePair(PRIMER_SOURCE, malformed.light, malformed.dark))
      .toThrow(/dark token fgColor-muted must be an object/);

    const mismatched = loadDocuments();
    (mismatched.light['borderColor-default'] as TokenDocument).key = '{borderColor.muted}';
    expect(() => parsePrimerThemePair(PRIMER_SOURCE, mismatched.light, mismatched.dark))
      .toThrow(/light token borderColor-default has mismatched identity metadata/);

    const unresolved = loadDocuments();
    (unresolved.dark['bgColor-inset'] as TokenDocument).value = '{base.color.neutral.0}';
    expect(() => parsePrimerThemePair(PRIMER_SOURCE, unresolved.light, unresolved.dark))
      .toThrow(/dark token bgColor-inset lacks a resolved color value/);
  });
});

interface TokenDocument {
  key?: unknown;
  value?: unknown;
  original?: {$value?: unknown};
}

function loadDocuments(): {light: Record<string, unknown>; dark: Record<string, unknown>} {
  const packageRoot = path.dirname(require.resolve('@primer/primitives/package.json'));
  return {
    light: JSON.parse(readFileSync(
      path.join(packageRoot, 'dist/docs/functional/themes/light.json'),
      'utf8',
    )) as Record<string, unknown>,
    dark: JSON.parse(readFileSync(
      path.join(packageRoot, 'dist/docs/functional/themes/dark.json'),
      'utf8',
    )) as Record<string, unknown>,
  };
}
