import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';

import {
  type EvaluationSplit,
  type PackagePin,
  type SceneManifest,
} from '../types';
import {validateSceneManifest} from '../protocol';
import {
  assertValidatedV2EvaluationContract,
  requireRegisteredSystem,
  type V2SystemRegistryEntry,
  type ValidatedV2EvaluationContract,
} from './contract';
import {
  validateV2ProtocolSourceConfig,
  type V2ProtocolSourceConfig,
} from './protocol-source-config';
import {verifyV2PackageLock} from './package-lock';

const IDENTIFIER = /^[a-z0-9][a-z0-9-]*$/;
const loadedProtocols = new WeakSet<object>();

export interface V2RegisteredProtocol {
  schema: 'semantic-dark.paired-theme-protocol.v2';
  id: string;
  split: EvaluationSplit;
  adapterId: string;
  source: V2ProtocolSourceConfig;
  viewport: {width: number; height: number; deviceScaleFactor: number};
  locale: string;
  colorProfile: 'srgb';
  limits: {maxScenes: number; maxReviewedDecisions: number};
}

interface LoadedV2RegisteredProtocolData {
  metricSpecSha256: string;
  registry: Readonly<V2SystemRegistryEntry>;
  protocol: Readonly<V2RegisteredProtocol>;
  sourceConfig: V2ProtocolSourceConfig;
  scenes: Readonly<SceneManifest>;
  protocolPath: string;
  protocolSha256: string;
  sceneManifestPath: string;
  sceneManifestSha256: string;
  packageLockPath: string;
  packageLockSha256: string;
}

declare const loadedV2RegisteredProtocolBrand: unique symbol;

export type LoadedV2RegisteredProtocol = Readonly<LoadedV2RegisteredProtocolData> & {
  readonly [loadedV2RegisteredProtocolBrand]: true;
};

/** Load only the protocol registered by pinned spec bytes; no package export is accessed here. */
export async function loadV2RegisteredProtocol(
  contract: ValidatedV2EvaluationContract,
  systemId: string,
  repoRootValue: string,
): Promise<LoadedV2RegisteredProtocol> {
  assertValidatedV2EvaluationContract(contract);
  if (typeof systemId !== 'string' || !IDENTIFIER.test(systemId)) {
    throw new TypeError('V2 protocol systemId must be a lowercase identifier');
  }
  if (typeof repoRootValue !== 'string' || repoRootValue.length === 0) {
    throw new TypeError('V2 protocol repoRoot must be non-empty');
  }
  const registry = requireRegisteredSystem(contract, systemId,
    registeredSplit(contract, systemId));
  assertCommonScenePin(contract, registry);
  const repoRoot = await realpath(path.resolve(repoRootValue));
  const protocolPath = await containedFile(repoRoot, registry.protocolPath, 'protocol');
  const sceneManifestPath = await containedFile(
    repoRoot, registry.sceneManifestPath, 'scene manifest',
  );
  const [protocolBytes, sceneBytes] = await Promise.all([
    readFile(protocolPath), readFile(sceneManifestPath),
  ]);
  verifyHash(protocolBytes, registry.protocolSha256, `${systemId} protocol`);
  verifyHash(sceneBytes, registry.sceneManifestSha256, `${systemId} scene manifest`);
  const protocol = validateRegisteredProtocol(parseJson(protocolBytes, 'protocol'), registry);
  const scenes = validateExactCommonScenes(parseJson(sceneBytes, 'scene manifest'), protocol, contract);
  const packageLock = await verifyV2PackageLock(repoRoot, sourcePackagePins(protocol.source));
  const loaded = deepFreeze({
    metricSpecSha256: contract.metricSpecSha256,
    registry, protocol, sourceConfig: protocol.source, scenes, protocolPath,
    protocolSha256: registry.protocolSha256, sceneManifestPath,
    sceneManifestSha256: registry.sceneManifestSha256,
    packageLockPath: packageLock.path,
    packageLockSha256: packageLock.sha256,
  }) as unknown as LoadedV2RegisteredProtocol;
  loadedProtocols.add(loaded);
  return loaded;
}

function sourcePackagePins(source: V2ProtocolSourceConfig): readonly PackagePin[] {
  return source.kind === 'cascade-token-json'
    ? [source.package, source.schemaPackage]
    : [source.package];
}

export function assertLoadedV2RegisteredProtocol(
  value: LoadedV2RegisteredProtocol,
): void {
  if (!loadedProtocols.has(value)) {
    throw new Error('V2 evaluation requires a protocol loaded from pinned registry bytes');
  }
}

function validateRegisteredProtocol(
  value: unknown,
  registry: Readonly<V2SystemRegistryEntry>,
): V2RegisteredProtocol {
  const input = object(value, 'v2 protocol');
  exactKeys(input, ['schema', 'id', 'split', 'adapterId', 'source', 'viewport', 'locale',
    'colorProfile', 'limits'], 'v2 protocol');
  if (input.schema !== 'semantic-dark.paired-theme-protocol.v2' ||
      input.id !== registry.id || input.split !== registry.split ||
      input.adapterId !== registry.adapterId) {
    throw new Error(`V2 protocol identity/split/adapter mismatch for ${registry.id}`);
  }
  if (input.colorProfile !== 'srgb' || input.locale !== 'en-US') {
    throw new Error('V2 protocol requires the frozen en-US/sRGB render environment');
  }
  const viewport = object(input.viewport, 'v2 protocol viewport');
  exactKeys(viewport, ['width', 'height', 'deviceScaleFactor'], 'v2 protocol viewport');
  const normalizedViewport = {
    width: positive(viewport.width, 'viewport.width'),
    height: positive(viewport.height, 'viewport.height'),
    deviceScaleFactor: positive(viewport.deviceScaleFactor, 'viewport.deviceScaleFactor'),
  };
  const limits = object(input.limits, 'v2 protocol limits');
  exactKeys(limits, ['maxScenes', 'maxReviewedDecisions'], 'v2 protocol limits');
  const normalizedLimits = {
    maxScenes: boundedInteger(limits.maxScenes, 'limits.maxScenes'),
    maxReviewedDecisions: boundedInteger(
      limits.maxReviewedDecisions, 'limits.maxReviewedDecisions',
    ),
  };
  return {
    schema: input.schema, id: registry.id, split: registry.split,
    adapterId: registry.adapterId, source: validateV2ProtocolSourceConfig(input.source),
    viewport: normalizedViewport, locale: input.locale, colorProfile: input.colorProfile,
    limits: normalizedLimits,
  };
}

function validateExactCommonScenes(
  value: unknown,
  protocol: V2RegisteredProtocol,
  contract: ValidatedV2EvaluationContract,
): SceneManifest {
  const scenes = validateSceneManifest(value, protocol.limits);
  const paintCount = scenes.scenes.reduce((sum, scene) => sum + scene.paints.length, 0);
  const reviewed = scenes.scenes.reduce((sum, scene) =>
    sum + scene.paints.filter((paint) => paint.reviewed).length, 0);
  const expected = contract.denominators;
  if (scenes.scenes.length !== expected.scenesPerSystem ||
      paintCount !== expected.paintsPerVariant || reviewed !== expected.perArm.reviewed) {
    throw new Error('V2 common scene manifest must contain exactly 4 scenes, 15 paints, and 10 reviewed decisions');
  }
  return scenes;
}

function assertCommonScenePin(
  contract: ValidatedV2EvaluationContract,
  selected: Readonly<V2SystemRegistryEntry>,
): void {
  if (contract.systems.some((entry) => entry.sceneManifestPath !== selected.sceneManifestPath ||
      entry.sceneManifestSha256 !== selected.sceneManifestSha256)) {
    throw new Error('V2 registry systems must share one common scene-manifest path and SHA-256');
  }
}

async function containedFile(root: string, relative: string, label: string): Promise<string> {
  const candidate = await realpath(path.resolve(root, relative));
  const fromRoot = path.relative(root, candidate);
  if (fromRoot === '' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error(`V2 ${label} path escapes repository root`);
  }
  return candidate;
}

function registeredSplit(contract: ValidatedV2EvaluationContract, systemId: string): EvaluationSplit {
  const entry = contract.systems.find((item) => item.id === systemId);
  if (!entry) throw new Error(`System ${systemId} is absent from the frozen v2 registry`);
  return entry.split;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; } catch {
    throw new Error(`V2 ${label} is not valid JSON`);
  }
}

function verifyHash(bytes: Uint8Array, expected: string, label: string): void {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`${label} SHA-256 mismatch`);
  }
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

function positive(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result <= 0) throw new TypeError(`${label} must be positive`);
  return result;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function boundedInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 24) {
    throw new Error(`${label} must be an integer in [1, 24]`);
  }
  return value as number;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
