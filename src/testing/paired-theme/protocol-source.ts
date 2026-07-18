const MATERIAL_PACKAGE = {
  name: '@material/material-color-utilities',
  version: '0.4.0',
  integrity: 'sha512-dlq6VExJReb8dhjj3a/yTigr3ncNwoFmL5Iy2ENtbDX03EmNeOEdZ+vsaGrj7RTuO+mB7L58II4LCsl4NpM8uw==',
  license: 'Apache-2.0',
  repository: 'https://github.com/material-foundation/material-color-utilities',
} as const;

const PRIMER_PACKAGE = {
  name: '@primer/primitives', version: '11.9.0',
  integrity: 'sha512-yESOalhd7s7S3unV1V32v3Z0RszXiiz6pzy6hVI9xpdTh1q1Gt8vyDFxRlqIvuwc5ZaO1+gYQTDbjxb4nWBzMw==',
  license: 'MIT', repository: 'https://github.com/primer/primitives',
} as const;

const SPECTRUM_PACKAGE = {
  name: '@adobe/spectrum-design-data', version: '0.12.0',
  integrity: 'sha512-R1Nso0lDPrev//uBuxWlTsCZ1aJtlNxnF0rTnEYr9ykgzeMI9sw9nWakmqWFcy+KzF39kncDxkIOG6en/UyWQA==',
  license: 'Apache-2.0', repository: 'https://github.com/adobe/spectrum-design-data',
} as const;

const SPECTRUM_SCHEMA_PACKAGE = {
  name: '@adobe/design-data-spec', version: '2.8.0',
  integrity: 'sha512-4S1ZKkVEb6VCv9xZO2Uvp2R7yxjGSsUCRJXRaEriOS0GgNMD1N/sW2p0vf8QVIs6bJSbFxAQOsRwuKbbFskirg==',
  license: 'Apache-2.0', repository: 'https://github.com/adobe/spectrum-design-data',
} as const;

export const SPECTRUM_TOKEN_PATHS = [
  'tokens/color-palette.tokens.json',
  'tokens/semantic-color-palette.tokens.json',
  'tokens/color-aliases.tokens.json',
  'tokens/color-component.tokens.json',
] as const;

export function validateProtocolSource(value: unknown): void {
  const source = object(value, 'protocol.source');
  if (source.system === 'material' && source.kind === 'generated-scheme') {
    exactKeys(source, ['system', 'kind', 'package', 'generator'], 'Material source');
    validatePackagePin(source.package, MATERIAL_PACKAGE, 'Material');
    const generator = object(source.generator, 'Material generator');
    exactKeys(generator, ['seed', 'variant', 'specVersion', 'platform', 'contrastLevel'],
      'Material generator');
    if (typeof generator.seed !== 'string' || !/^#[0-9a-f]{6}$/i.test(generator.seed) ||
        generator.variant !== 'tonal-spot' || generator.specVersion !== '2021' ||
        generator.platform !== 'phone' || generator.contrastLevel !== 0) {
      throw new Error('Invalid Material generator configuration');
    }
    return;
  }
  if (source.system === 'primer' && source.kind === 'static-token-json') {
    exactKeys(source, ['system', 'kind', 'package', 'lightPath', 'darkPath'], 'Primer source');
    validatePackagePin(source.package, PRIMER_PACKAGE, 'Primer');
    if (source.lightPath !== 'dist/docs/functional/themes/light.json' ||
        source.darkPath !== 'dist/docs/functional/themes/dark.json') {
      throw new Error('Primer source paths differ from the frozen resolved themes');
    }
    return;
  }
  if (source.system === 'spectrum' && source.kind === 'cascade-token-json') {
    exactKeys(source, ['system', 'kind', 'package', 'schemaPackage', 'tokenPaths',
      'modeSetPath', 'modes', 'schema'], 'Spectrum source');
    validatePackagePin(source.package, SPECTRUM_PACKAGE, 'Spectrum');
    validatePackagePin(source.schemaPackage, SPECTRUM_SCHEMA_PACKAGE, 'Spectrum schema');
    exactArray(source.tokenPaths, SPECTRUM_TOKEN_PATHS, 'Spectrum token paths');
    if (source.modeSetPath !== 'mode-sets/color-scheme.json') {
      throw new Error('Spectrum mode-set path differs from the frozen source');
    }
    exactRecord(source.modes, {light: 'light', dark: 'dark'}, 'Spectrum modes');
    exactRecord(source.schema, {
      specVersion: '1.0.0-draft',
      tokenSchemaId: 'https://opensource.adobe.com/spectrum-design-data/schemas/v0/token.schema.json',
      modeSetSchemaId: 'https://opensource.adobe.com/spectrum-design-data/schemas/v0/mode-set.schema.json',
    }, 'Spectrum schema contract');
    return;
  }
  throw new Error('M1 accepts only Material, Primer, or Spectrum reference sources');
}

function validatePackagePin(
  value: unknown,
  expected: Readonly<Record<string, string>>,
  label: string,
): void {
  exactRecord(value, expected, `${label} package pin`);
}

function exactRecord(
  value: unknown,
  expected: Readonly<Record<string, unknown>>,
  label: string,
): void {
  const record = object(value, label);
  exactKeys(record, Object.keys(expected), label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (record[key] !== expectedValue) throw new Error(`${label} mismatch for ${key}`);
  }
}

function exactArray(value: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length !== expected.length ||
      value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} differ from the frozen ordered list`);
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
