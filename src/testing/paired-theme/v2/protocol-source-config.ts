import path from 'node:path';

import {NORMALIZED_TOKEN_NAMES, type PackagePin} from '../types';
import type {V2ExportedThemeSelectors} from './exported-theme-source';

const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

export type V2ProtocolSourceConfig =
  | Readonly<{kind: 'generated-scheme'; package: PackagePin; generator: Readonly<{
    seed: string; variant: string; specVersion: string; platform: string; contrastLevel: number;
  }>}>
  | Readonly<{kind: 'static-token-json'; package: PackagePin; lightPath: string; darkPath: string}>
  | Readonly<{kind: 'cascade-token-json'; package: PackagePin; schemaPackage: PackagePin;
    tokenPaths: readonly string[]; modeSetPath: string; modes: Readonly<{light: string; dark: string}>;
    schema: Readonly<{specVersion: string; tokenSchemaId: string; modeSetSchemaId: string}>}>
  | Readonly<{kind: 'exported-theme-object'; package: PackagePin;
    selectors: V2ExportedThemeSelectors}>;

/** Validate committed adapter configuration without importing or resolving package exports. */
export function validateV2ProtocolSourceConfig(value: unknown): V2ProtocolSourceConfig {
  const input = object(value, 'v2 protocol source');
  const kind = input.kind;
  if (kind === 'generated-scheme') {
    exactKeys(input, ['kind', 'package', 'generator'], 'generated-scheme source');
    const generator = object(input.generator, 'generated-scheme generator');
    exactKeys(generator, ['seed', 'variant', 'specVersion', 'platform', 'contrastLevel'],
      'generated-scheme generator');
    if (typeof generator.seed !== 'string' || !/^#[0-9a-f]{6}$/i.test(generator.seed)) {
      throw new TypeError('generated-scheme seed must be a six-digit hex color');
    }
    return {kind, package: packagePin(input.package), generator: {
      seed: generator.seed, variant: nonEmpty(generator.variant, 'generator.variant'),
      specVersion: nonEmpty(generator.specVersion, 'generator.specVersion'),
      platform: nonEmpty(generator.platform, 'generator.platform'),
      contrastLevel: finite(generator.contrastLevel, 'generator.contrastLevel'),
    }};
  }
  if (kind === 'static-token-json') {
    exactKeys(input, ['kind', 'package', 'lightPath', 'darkPath'], 'static-token-json source');
    return {kind, package: packagePin(input.package),
      lightPath: packagePath(input.lightPath, 'lightPath'),
      darkPath: packagePath(input.darkPath, 'darkPath')};
  }
  if (kind === 'cascade-token-json') return cascadeSource(input);
  if (kind === 'exported-theme-object') {
    exactKeys(input, ['kind', 'package', 'selectors'], 'exported-theme-object source');
    return {kind, package: packagePin(input.package), selectors: selectors(input.selectors)};
  }
  throw new Error('Unsupported v2 protocol source kind');
}

function cascadeSource(input: Record<string, unknown>): V2ProtocolSourceConfig {
  exactKeys(input, ['kind', 'package', 'schemaPackage', 'tokenPaths', 'modeSetPath', 'modes',
    'schema'], 'cascade-token-json source');
  if (!Array.isArray(input.tokenPaths) || input.tokenPaths.length === 0) {
    throw new TypeError('cascade tokenPaths must be a non-empty array');
  }
  const tokenPaths = input.tokenPaths.map((item, index) => packagePath(item, `tokenPaths[${index}]`));
  if (new Set(tokenPaths).size !== tokenPaths.length) throw new Error('cascade tokenPaths must be unique');
  const modes = object(input.modes, 'cascade modes');
  exactKeys(modes, ['light', 'dark'], 'cascade modes');
  const schema = object(input.schema, 'cascade schema');
  exactKeys(schema, ['specVersion', 'tokenSchemaId', 'modeSetSchemaId'], 'cascade schema');
  return {kind: 'cascade-token-json', package: packagePin(input.package),
    schemaPackage: packagePin(input.schemaPackage), tokenPaths,
    modeSetPath: packagePath(input.modeSetPath, 'modeSetPath'),
    modes: {light: nonEmpty(modes.light, 'modes.light'), dark: nonEmpty(modes.dark, 'modes.dark')},
    schema: {specVersion: nonEmpty(schema.specVersion, 'schema.specVersion'),
      tokenSchemaId: absoluteUrl(schema.tokenSchemaId, 'schema.tokenSchemaId'),
      modeSetSchemaId: absoluteUrl(schema.modeSetSchemaId, 'schema.modeSetSchemaId')}};
}

function selectors(value: unknown): V2ExportedThemeSelectors {
  const input = object(value, 'exported-theme selectors');
  exactKeys(input, NORMALIZED_TOKEN_NAMES, 'exported-theme selectors');
  return Object.fromEntries(NORMALIZED_TOKEN_NAMES.map((name) => {
    const pair = object(input[name], `selectors.${name}`);
    exactKeys(pair, ['light', 'dark'], `selectors.${name}`);
    return [name, {light: exportPath(pair.light, `${name}.light`),
      dark: exportPath(pair.dark, `${name}.dark`)}];
  })) as V2ExportedThemeSelectors;
}

function packagePin(value: unknown): PackagePin {
  const input = object(value, 'package pin');
  exactKeys(input, ['name', 'version', 'integrity', 'license', 'repository'], 'package pin');
  const name = nonEmpty(input.name, 'package.name');
  const version = nonEmpty(input.version, 'package.version');
  const integrity = nonEmpty(input.integrity, 'package.integrity');
  if (!PACKAGE_NAME.test(name) || !VERSION.test(version) || !INTEGRITY.test(integrity)) {
    throw new Error('Invalid exact package name/version/integrity pin');
  }
  return {name, version, integrity, license: nonEmpty(input.license, 'package.license'),
    repository: absoluteUrl(input.repository, 'package.repository')};
}

function exportPath(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((part) =>
    typeof part !== 'string' || part.length === 0 || FORBIDDEN_PATH_PARTS.has(part))) {
    throw new TypeError(`${label} must be a safe non-empty export path`);
  }
  return [...value] as string[];
}

function packagePath(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  if (path.posix.normalize(result) !== result || path.isAbsolute(result) || result.includes('\\') ||
      result.split('/').includes('..')) throw new Error(`${label} must be package-relative`);
  return result;
}

function absoluteUrl(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  let parsed: URL;
  try { parsed = new URL(result); } catch { throw new TypeError(`${label} must be an absolute URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new TypeError(`${label} must be a credential-free HTTPS URL`);
  }
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be non-empty`);
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}
