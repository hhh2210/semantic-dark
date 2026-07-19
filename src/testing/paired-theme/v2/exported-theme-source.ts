import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

import {parseCssColor} from '../../../color';
import {
  NORMALIZED_TOKEN_NAMES,
  type EvaluationSplit,
  type NormalizedThemePair,
  type NormalizedTokenName,
  type PackagePin,
} from '../types';
import {
  assertLoadedV2RegisteredProtocol,
  type LoadedV2RegisteredProtocol,
} from './protocol';

const require = createRequire(import.meta.url);
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

export interface V2ExportPathPair {
  light: readonly string[];
  dark: readonly string[];
}

export type V2ExportedThemeSelectors = Readonly<Record<NormalizedTokenName, V2ExportPathPair>>;

interface V2ExportedThemeSource {
  system: string;
  split: EvaluationSplit;
  package: PackagePin;
  selectors: V2ExportedThemeSelectors;
}

export interface V2NormalizedThemePair extends Omit<NormalizedThemePair, 'system'> {
  system: string;
}

/** Load only from a registry-pinned protocol. Held-out callers must claim before invoking this. */
export function loadV2ExportedThemePair(
  loaded: LoadedV2RegisteredProtocol,
): Readonly<V2NormalizedThemePair> {
  const source = exportedSource(loaded);
  assertSource(source);
  assertPackageLockCurrent(loaded);
  const packageRoot = packageDirectory(source.package.name);
  assertInstalledPackage(readJson(path.join(packageRoot, 'package.json')), source.package);
  return parseV2ExportedThemePair(source, require(source.package.name) as unknown);
}

function parseV2ExportedThemePair(
  source: V2ExportedThemeSource,
  packageExports: unknown,
): Readonly<V2NormalizedThemePair> {
  assertSource(source);
  const tokens = Object.fromEntries(NORMALIZED_TOKEN_NAMES.map((name) => {
    const selector = source.selectors[name];
    const light = color(resolvePath(packageExports, selector.light, `${source.system}.${name}.light`),
      `${source.system}.${name}.light`);
    const dark = color(resolvePath(packageExports, selector.dark, `${source.system}.${name}.dark`),
      `${source.system}.${name}.dark`);
    return [name, {
      name,
      light,
      dark,
      sourceToken: `${selector.light.join('.')}|${selector.dark.join('.')}`,
      provenance: 'authored-token' as const,
      resolutionPath: {light: [...selector.light], dark: [...selector.dark]},
    }];
  })) as unknown as NormalizedThemePair['tokens'];
  return deepFreeze({system: source.system, split: source.split, source: source.package, tokens});
}

function exportedSource(loaded: LoadedV2RegisteredProtocol): V2ExportedThemeSource {
  assertLoadedV2RegisteredProtocol(loaded);
  if (loaded.sourceConfig.kind !== 'exported-theme-object') {
    throw new Error(`V2 protocol ${loaded.registry.id} is not an exported-theme-object source`);
  }
  return {
    system: loaded.registry.id,
    split: loaded.registry.split,
    package: loaded.sourceConfig.package,
    selectors: loaded.sourceConfig.selectors,
  };
}

function assertPackageLockCurrent(loaded: LoadedV2RegisteredProtocol): void {
  const actual = createHash('sha256').update(readFileSync(loaded.packageLockPath)).digest('hex');
  if (actual !== loaded.packageLockSha256) {
    throw new Error('V2 pnpm lockfile changed after protocol authentication');
  }
}

function assertSource(source: V2ExportedThemeSource): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source.system)) {
    throw new TypeError('V2 exported-theme system must be a lowercase identifier');
  }
  if (source.split !== 'development' && source.split !== 'held-out') {
    throw new TypeError('V2 exported-theme split is invalid');
  }
  const keys = Object.keys(source.selectors).sort();
  const expected = [...NORMALIZED_TOKEN_NAMES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('V2 exported-theme selectors must cover the exact normalized token registry');
  }
  for (const name of NORMALIZED_TOKEN_NAMES) {
    const selector = source.selectors[name] as V2ExportPathPair | undefined;
    if (selector === undefined || selector === null || typeof selector !== 'object' ||
        Array.isArray(selector) || Object.keys(selector).sort().join('/') !== 'dark/light') {
      throw new Error(`V2 exported-theme selector ${name} must contain exact light/dark paths`);
    }
    pathParts(selector.light, `${name}.light`);
    pathParts(selector.dark, `${name}.dark`);
  }
}

function pathParts(value: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((part) =>
    typeof part !== 'string' || part.length === 0 || FORBIDDEN_PATH_PARTS.has(part))) {
    throw new TypeError(`Invalid frozen export path for ${label}`);
  }
}

function resolvePath(root: unknown, parts: readonly string[], label: string): unknown {
  pathParts(parts, label);
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' ||
        !Object.prototype.hasOwnProperty.call(current, part)) {
      throw new Error(`Frozen export path is unresolved for ${label}: ${parts.join('.')}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function color(value: unknown, label: string): string {
  if (typeof value !== 'string' || !parseCssColor(value)) {
    throw new Error(`${label} does not resolve to a CSS color`);
  }
  return value;
}

function packageDirectory(packageName: string): string {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

function assertInstalledPackage(value: unknown, pin: PackagePin): void {
  const metadata = object(value, `${pin.name} package metadata`);
  if (metadata.name !== pin.name || metadata.version !== pin.version ||
      metadata.license !== pin.license || repository(metadata.repository) !== pin.repository) {
    throw new Error(`Installed package metadata differs from ${pin.name}@${pin.version}`);
  }
}

function repository(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value : object(value, 'package repository').url;
  return typeof raw === 'string'
    ? raw.replace(/^git\+/, '').replace(/\.git$/, '')
    : undefined;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
