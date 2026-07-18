import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseCssColor} from '../../color';
import {validateProtocolSource} from './protocol-source';
import {NORMALIZED_TOKEN_NAMES, type HeldOutProtocolSource, type NormalizedThemePair, type PackagePin} from './types';

const require = createRequire(import.meta.url);

/** Load a preregistered held-out export pair. Call only after the exposure receipt exists. */
export function loadHeldOutThemePair(source: HeldOutProtocolSource): NormalizedThemePair {
  validateProtocolSource(source);
  const packageRoot = packageDirectory(source.package.name);
  assertInstalledPackage(readJson(path.join(packageRoot, 'package.json')), source.package);
  return parseHeldOutThemePair(source, require(source.package.name) as unknown);
}

/** Normalize exact, precommitted selector names without consulting color similarity. */
export function parseHeldOutThemePair(
  source: HeldOutProtocolSource,
  packageExports: unknown,
): NormalizedThemePair {
  validateProtocolSource(source);
  const exports = object(packageExports, `${source.system} package exports`);
  const light = object(exports[source.lightExport], `${source.system}.${source.lightExport}`);
  const dark = object(exports[source.darkExport], `${source.system}.${source.darkExport}`);
  const tokens = Object.fromEntries(NORMALIZED_TOKEN_NAMES.map((name) => {
    const selector = source.tokens[name];
    const lightValue = color(light[selector], `${source.system}.${source.lightExport}.${selector}`);
    const darkValue = color(dark[selector], `${source.system}.${source.darkExport}.${selector}`);
    return [name, {
      name, light: lightValue, dark: darkValue, sourceToken: selector,
      provenance: 'authored-token' as const,
      resolutionPath: {light: [source.lightExport, selector], dark: [source.darkExport, selector]},
    }];
  })) as unknown as NormalizedThemePair['tokens'];
  return {system: source.system, split: 'held-out', source: source.package, tokens};
}

function color(value: unknown, label: string): string {
  if (typeof value !== 'string' || !parseCssColor(value)) {
    throw new Error(`${label} is not a CSS color`);
  }
  return value;
}

function packageDirectory(packageName: string): string {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

function assertInstalledPackage(value: unknown, pin: PackagePin): void {
  const metadata = object(value, `${pin.name} package metadata`);
  if (metadata.name !== pin.name || metadata.version !== pin.version || metadata.license !== pin.license ||
      repository(metadata.repository) !== pin.repository) {
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
