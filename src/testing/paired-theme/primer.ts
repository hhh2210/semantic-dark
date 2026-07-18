import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {
  NormalizedThemePair,
  NormalizedTokenName,
  PackagePin,
  PrimerProtocolSource,
} from './types';

const require = createRequire(import.meta.url);

const PRIMER_PIN: Readonly<PackagePin> = {
  name: '@primer/primitives',
  version: '11.9.0',
  integrity: 'sha512-yESOalhd7s7S3unV1V32v3Z0RszXiiz6pzy6hVI9xpdTh1q1Gt8vyDFxRlqIvuwc5ZaO1+gYQTDbjxb4nWBzMw==',
  license: 'MIT',
  repository: 'https://github.com/primer/primitives',
};

interface PrimerTokenDescriptor {
  sourceToken: string;
  path: readonly string[];
}

const PRIMER_TOKENS: Readonly<Record<NormalizedTokenName, PrimerTokenDescriptor>> = {
  canvas: token('bgColor', 'inset'),
  surface: token('bgColor', 'default'),
  surfaceRaised: token('bgColor', 'muted'),
  textPrimary: token('fgColor', 'default'),
  textSecondary: token('fgColor', 'muted'),
  tableHeader: token('bgColor', 'muted'),
  selectedSurface: token('bgColor', 'accent', 'muted'),
  border: token('borderColor', 'default'),
  focus: token('focus', 'outline-color'),
  dangerSurface: token('bgColor', 'danger', 'muted'),
  dangerText: token('fgColor', 'danger'),
};

/** Load Primer's pinned authored light/dark theme documents from the installed package. */
export function primerThemePair(source: PrimerProtocolSource): NormalizedThemePair {
  assertPrimerSource(source);
  const packageJsonPath = require.resolve('@primer/primitives/package.json');
  const packageRoot = path.dirname(packageJsonPath);
  assertInstalledPackage(readJson(packageJsonPath, 'Primer package metadata'));
  return parsePrimerThemePair(
    source,
    readJson(
      resolvePackagePath(packageRoot, source.lightPath),
      'Primer light theme',
    ),
    readJson(
      resolvePackagePath(packageRoot, source.darkPath),
      'Primer dark theme',
    ),
  );
}

/** Normalize already-loaded documents; exported so schema failures remain directly testable. */
export function parsePrimerThemePair(
  source: PrimerProtocolSource,
  lightDocument: unknown,
  darkDocument: unknown,
): NormalizedThemePair {
  assertPrimerSource(source);
  const light = assertThemeDocument(lightDocument, 'light');
  const dark = assertThemeDocument(darkDocument, 'dark');
  const tokens = Object.fromEntries(
    Object.entries(PRIMER_TOKENS).map(([name, descriptor]) => [name, {
      name,
      light: readResolvedColor(light, descriptor, 'light'),
      dark: readResolvedColor(dark, descriptor, 'dark'),
      sourceToken: descriptor.sourceToken,
      provenance: 'authored-token',
    }]),
  ) as NormalizedThemePair['tokens'];
  return {
    system: 'primer',
    split: 'development',
    source: source.package,
    tokens,
  };
}

function assertPrimerSource(source: PrimerProtocolSource): void {
  if (!isRecord(source) || source.system !== 'primer' || source.kind !== 'static-token-json' ||
      source.lightPath !== 'dist/docs/functional/themes/light.json' ||
      source.darkPath !== 'dist/docs/functional/themes/dark.json') {
    throw new Error('Primer protocol source differs from the frozen static-token contract');
  }
  assertPrimerPin(source.package);
}

function assertPrimerPin(source: PackagePin): void {
  if (!isRecord(source)) throw new Error('Primer source package pin must be an object');
  const keys = Object.keys(source).sort();
  const expectedKeys = Object.keys(PRIMER_PIN).sort();
  if (keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Primer source package pin has an unexpected metadata shape');
  }
  for (const key of expectedKeys as Array<keyof PackagePin>) {
    if (source[key] !== PRIMER_PIN[key]) {
      throw new Error(`Primer source package pin mismatch for ${key}`);
    }
  }
}

function assertInstalledPackage(value: unknown): void {
  if (!isRecord(value) || value.name !== PRIMER_PIN.name ||
      value.version !== PRIMER_PIN.version || value.license !== PRIMER_PIN.license ||
      installedRepository(value.repository) !== PRIMER_PIN.repository) {
    throw new Error('Installed Primer package metadata differs from the frozen 11.9.0 pin');
  }
}

function installedRepository(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.url === 'string') {
    return value.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }
  return undefined;
}

function assertThemeDocument(value: unknown, mode: 'light' | 'dark'): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Primer ${mode} theme must be an object`);
  return value;
}

function readResolvedColor(
  document: Readonly<Record<string, unknown>>,
  descriptor: PrimerTokenDescriptor,
  mode: 'light' | 'dark',
): string {
  const {sourceToken, path: expectedPath} = descriptor;
  if (!Object.hasOwn(document, sourceToken)) {
    throw new Error(`Primer ${mode} theme is missing ${sourceToken}`);
  }
  const token = document[sourceToken];
  if (!isRecord(token)) throw new Error(`Primer ${mode} token ${sourceToken} must be an object`);
  const expectedKey = `{${expectedPath.join('.')}}`;
  if (token.name !== sourceToken || token.key !== expectedKey || token.type !== 'color' ||
      !Array.isArray(token.path) || token.path.length !== expectedPath.length ||
      token.path.some((segment, index) => segment !== expectedPath[index])) {
    throw new Error(`Primer ${mode} token ${sourceToken} has mismatched identity metadata`);
  }
  if (typeof token.value !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(token.value)) {
    throw new Error(`Primer ${mode} token ${sourceToken} lacks a resolved color value`);
  }
  return token.value;
}

function token(...segments: readonly string[]): PrimerTokenDescriptor {
  return {sourceToken: segments.join('-'), path: segments};
}

function resolvePackagePath(packageRoot: string, relativePath: string): string {
  const resolved = path.resolve(packageRoot, relativePath);
  if (!resolved.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error('Primer token path escapes the installed package');
  }
  return resolved;
}

function readJson(filePath: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}`, {cause: error});
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
