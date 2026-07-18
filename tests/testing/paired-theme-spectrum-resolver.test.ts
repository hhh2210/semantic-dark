import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {SPECTRUM_TOKEN_PATHS} from '../../src/testing/paired-theme/protocol-source';
import {
  createSpectrumColorResolver,
  type SpectrumTokenDocument,
} from '../../src/testing/paired-theme/spectrum-resolver';

const require = createRequire(import.meta.url);

describe('Spectrum cascade color resolver', () => {
  it('resolves the installed 0.12.0 token corpus by mode, independent of input order', () => {
    const documents = loadInstalledDocuments();
    const allTokens = documents.flat().filter(isRecord);
    const root = allTokens.find((token) =>
      isRecord(token.name) && token.name.property === 'accent-color-100');
    expect(root).toBeDefined();
    expect(typeof root!.uuid).toBe('string');
    expect(typeof root!.$ref).toBe('string');

    for (const mode of ['light', 'dark'] as const) {
      const member = allTokens.find((token) =>
        token.set_uuid === root!.$ref && isRecord(token.name) &&
        token.name.colorScheme === mode);
      expect(member).toBeDefined();
      const expected = {
        color: member!.value,
        resolutionPath: [root!.uuid, root!.$ref, member!.uuid],
      };
      const forward = createSpectrumColorResolver(documents, mode).resolve(root!.uuid as string);
      const reversedDocuments = [...documents]
        .reverse()
        .map((document) => [...document].reverse());
      const reversed = createSpectrumColorResolver(reversedDocuments, mode)
        .resolve(root!.uuid as string);
      expect(forward).toEqual(expected);
      expect(reversed).toEqual(expected);
    }
  });

  it('records direct token and set references in the resolution path', () => {
    const documents = [[
      alias('root', 'middle'),
      alias('middle', 'theme-set'),
      literal('light-member', '#ffffff', 'theme-set', 'light'),
      literal('dark-member', 'rgb(10, 20, 30)', 'theme-set', 'dark'),
    ]];
    expect(createSpectrumColorResolver(documents, 'dark').resolve('root')).toEqual({
      color: 'rgb(10, 20, 30)',
      resolutionPath: ['root', 'middle', 'theme-set', 'dark-member'],
    });
  });

  it('treats an omitted colorScheme as light and excludes explicit wireframe', () => {
    const documents = [[
      alias('root', 'theme-set'),
      literal('default-member', '#ffffff', 'theme-set'),
      literal('dark-member', '#111111', 'theme-set', 'dark'),
      {...literal('wireframe-member', '#eeeeee', 'theme-set'),
        name: {colorScheme: 'wireframe'}},
    ]];
    expect(createSpectrumColorResolver(documents, 'light').resolve('root')).toEqual({
      color: '#ffffff',
      resolutionPath: ['root', 'theme-set', 'default-member'],
    });
    expect(createSpectrumColorResolver(documents, 'dark').resolve('root')).toEqual({
      color: '#111111',
      resolutionPath: ['root', 'theme-set', 'dark-member'],
    });
  });

  it('hard-fails duplicate and ambiguous identifiers', () => {
    expect(() => createSpectrumColorResolver([
      [literal('duplicate', '#fff')],
      [literal('duplicate', '#000')],
    ], 'light')).toThrow(/Duplicate Spectrum token UUID: duplicate/);

    expect(() => createSpectrumColorResolver([[
      literal('theme-set', '#fff'),
      literal('member', '#000', 'theme-set', 'dark'),
    ]], 'dark')).toThrow(/Ambiguous Spectrum token\/set UUID: theme-set/);
  });

  it('hard-fails missing references, cycles, and invalid token definitions', () => {
    expect(() => createSpectrumColorResolver([[alias('root', 'missing')]], 'light')
      .resolve('root')).toThrow(/Missing Spectrum reference missing from root/);
    expect(() => createSpectrumColorResolver([[
      alias('a', 'b'), alias('b', 'a'),
    ]], 'light').resolve('a')).toThrow(/Spectrum reference cycle: a -> b -> a/);
    expect(() => createSpectrumColorResolver([[
      {uuid: 'both', value: '#fff', $ref: 'target'}, literal('target', '#000'),
    ]], 'light').resolve('both')).toThrow(/exactly one of value or \$ref/);
    expect(() => createSpectrumColorResolver([[
      {uuid: 'length', value: '12px'},
    ]], 'light').resolve('length')).toThrow(/does not resolve to a CSS color/);
  });

  it('hard-fails missing and ambiguous color-scheme members', () => {
    expect(() => createSpectrumColorResolver([[
      alias('root', 'theme-set'),
      literal('dark', '#000', 'theme-set', 'dark'),
    ]], 'light').resolve('root')).toThrow(/no member for colorScheme=light/);

    expect(() => createSpectrumColorResolver([[
      alias('root', 'theme-set'),
      literal('dark-b', '#111', 'theme-set', 'dark'),
      literal('dark-a', '#000', 'theme-set', 'dark'),
    ]], 'dark').resolve('root')).toThrow(
      /ambiguous members for colorScheme=dark: dark-a, dark-b/,
    );
  });
});

function loadInstalledDocuments(): SpectrumTokenDocument[] {
  const packageRoot = path.dirname(require.resolve('@adobe/spectrum-design-data/package.json'));
  return SPECTRUM_TOKEN_PATHS.map((name) =>
    JSON.parse(readFileSync(path.join(packageRoot, name), 'utf8')) as unknown[],
  );
}

function literal(
  uuid: string,
  value: string,
  setUuid?: string,
  mode?: 'light' | 'dark',
): Record<string, unknown> {
  return {
    uuid,
    value,
    ...(setUuid ? {set_uuid: setUuid} : {}),
    ...(mode ? {name: {colorScheme: mode}} : {}),
  };
}

function alias(uuid: string, reference: string): Record<string, unknown> {
  return {uuid, $ref: reference};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
