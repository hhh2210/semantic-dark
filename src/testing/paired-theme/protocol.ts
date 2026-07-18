import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {NORMALIZED_TOKEN_NAMES, type PaintDecision, type PairedThemeProtocol, type SceneDefinition, type SceneManifest} from './types';

const ROLES = new Set(['background', 'surface', 'text', 'border', 'accent', 'svgFill', 'svgStroke']);
const PROPERTIES = new Set(['background-color', 'color', 'border-color', 'outline-color']);
const PSEUDOS = new Set<unknown>([null, '::before', '::after']);
const CONTRAST_KINDS = new Set(['none', 'text', 'non-text']);
const SCENE_KINDS = new Set(['surface-stack', 'table-selection', 'form-focus', 'status-alert']);
const TOKEN_NAMES = new Set<string>(NORMALIZED_TOKEN_NAMES);

export interface LoadedPairedThemeProtocol {
  protocol: PairedThemeProtocol;
  scenes: SceneManifest;
  protocolPath: string;
  sceneManifestPath: string;
}

export async function loadPairedThemeProtocol(protocolValue: string): Promise<LoadedPairedThemeProtocol> {
  const protocolPath = path.resolve(protocolValue);
  const protocol = validateProtocol(JSON.parse(await readFile(protocolPath, 'utf8')));
  const protocolDirectory = path.dirname(protocolPath);
  const sceneManifestPath = path.resolve(protocolDirectory, protocol.sceneManifest);
  if (sceneManifestPath === protocolDirectory ||
      !sceneManifestPath.startsWith(`${protocolDirectory}${path.sep}`)) {
    throw new Error('Scene manifest must stay inside the protocol directory');
  }
  const scenes = validateSceneManifest(
    JSON.parse(await readFile(sceneManifestPath, 'utf8')),
    protocol.limits,
  );
  return {protocol, scenes, protocolPath, sceneManifestPath};
}

export function validateProtocol(value: unknown): PairedThemeProtocol {
  const input = object(value, 'protocol');
  if (input.schema !== 'semantic-dark.paired-theme-protocol.v1') {
    throw new Error('Unsupported paired-theme protocol schema');
  }
  if (input.split !== 'development') throw new Error('M1a accepts development protocols only');
  validateSource(input.source);
  const viewport = object(input.viewport, 'protocol.viewport');
  const limits = object(input.limits, 'protocol.limits');
  const metric = object(input.metric, 'protocol.metric');
  const weights = object(metric.componentWeights, 'protocol.metric.componentWeights');
  const weightSum = number(weights.color, 'color weight') +
    number(weights.contrast, 'contrast weight') + number(weights.rank, 'rank weight');
  if (Math.abs(weightSum - 1) > 1e-12) throw new Error('Metric component weights must sum to one');
  if (metric.status !== 'development-draft' && metric.status !== 'frozen-v1') {
    throw new Error('Metric status must be development-draft or frozen-v1');
  }
  for (const [name, value] of [
    ['deltaEOkCap', metric.deltaEOkCap],
    ['contrastLog2Cap', metric.contrastLog2Cap],
    ['rankTieEpsilon', metric.rankTieEpsilon],
    ['comparisonEpsilon', metric.comparisonEpsilon],
    ['textContrastFloor', metric.textContrastFloor],
    ['nonTextContrastFloor', metric.nonTextContrastFloor],
    ['surfaceSeparationFloor', metric.surfaceSeparationFloor],
  ] as const) {
    if (number(value, name) <= 0) throw new Error(`${name} must be positive`);
  }
  if (number(metric.accentChromaThreshold, 'accentChromaThreshold') < 0) {
    throw new Error('accentChromaThreshold must be nonnegative');
  }
  const protocol = input as unknown as PairedThemeProtocol;
  if (!protocol.id || !protocol.sceneManifest || protocol.colorProfile !== 'srgb') {
    throw new Error('Protocol id, scene manifest, and sRGB profile are required');
  }
  if (number(viewport.width, 'viewport width') <= 0 ||
      number(viewport.height, 'viewport height') <= 0 ||
      number(viewport.deviceScaleFactor, 'device scale factor') <= 0) {
    throw new Error('Viewport dimensions and scale must be positive');
  }
  if (integer(limits.maxScenes, 'maxScenes') > 24 ||
      integer(limits.maxReviewedDecisions, 'maxReviewedDecisions') > 50) {
    throw new Error('Protocol exceeds the M1 scene or reviewed-decision ceiling');
  }
  return protocol;
}

function validateSource(value: unknown): void {
  const source = object(value, 'protocol.source');
  if (source.system === 'material' && source.kind === 'generated-scheme') {
    exactKeys(source, ['system', 'kind', 'package', 'generator'], 'Material source');
    const packagePin = validatePackagePin(source.package);
    if (packagePin.name !== '@material/material-color-utilities' ||
        packagePin.version !== '0.4.0' || packagePin.license !== 'Apache-2.0') {
      throw new Error('Material source package differs from the audited 0.4.0 pin');
    }
    const generator = object(source.generator, 'Material generator');
    exactKeys(generator, ['seed', 'variant', 'specVersion', 'platform', 'contrastLevel'],
      'Material generator');
    if (typeof generator.seed !== 'string' || !/^#[0-9a-f]{6}$/i.test(generator.seed) ||
        generator.variant !== 'tonal-spot' || generator.specVersion !== '2021' ||
        generator.platform !== 'phone' || number(generator.contrastLevel, 'contrastLevel') !== 0) {
      throw new Error('Invalid Material generator configuration');
    }
    return;
  }
  if (source.system === 'primer' && source.kind === 'static-token-json') {
    exactKeys(source, ['system', 'kind', 'package', 'lightPath', 'darkPath'], 'Primer source');
    const packagePin = validatePackagePin(source.package);
    if (packagePin.name !== '@primer/primitives' || packagePin.version !== '11.9.0' ||
        packagePin.license !== 'MIT') {
      throw new Error('Primer source package differs from the audited 11.9.0 pin');
    }
    if (source.lightPath !== 'dist/docs/functional/themes/light.json' ||
        source.darkPath !== 'dist/docs/functional/themes/dark.json') {
      throw new Error('Primer source paths differ from the frozen resolved themes');
    }
    return;
  }
  throw new Error('M1 accepts only Material generated-scheme or Primer static-token-json input');
}

function validatePackagePin(value: unknown): Record<string, unknown> {
  const packagePin = object(value, 'source package pin');
  exactKeys(packagePin, ['name', 'version', 'integrity', 'license', 'repository'],
    'source package pin');
  for (const key of ['name', 'version', 'integrity', 'license', 'repository'] as const) {
    if (typeof packagePin[key] !== 'string' || packagePin[key].length === 0) {
      throw new Error(`Package pin ${key} must be a non-empty string`);
    }
  }
  return packagePin;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

export function validateSceneManifest(
  value: unknown,
  limits: PairedThemeProtocol['limits'],
): SceneManifest {
  const input = object(value, 'scene manifest');
  if (input.schema !== 'semantic-dark.paired-theme-scenes.v1' || !Array.isArray(input.scenes)) {
    throw new Error('Unsupported paired-theme scene manifest');
  }
  if (input.scenes.length === 0 || input.scenes.length > limits.maxScenes) {
    throw new Error(`Scene count must be in [1, ${limits.maxScenes}]`);
  }
  const scenes = input.scenes.map((scene, index) => validateScene(scene, index));
  const sceneIds = new Set<string>();
  const paintIds = new Set<string>();
  const pairIds = new Set<string>();
  let reviewed = 0;
  for (const scene of scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    for (const paint of scene.paints) {
      if (paintIds.has(paint.id)) throw new Error(`Duplicate paint id: ${paint.id}`);
      paintIds.add(paint.id);
      if (paint.reviewed) reviewed += 1;
    }
    for (const pair of scene.surfacePairs) {
      if (pairIds.has(pair.id)) throw new Error(`Duplicate surface pair id: ${pair.id}`);
      pairIds.add(pair.id);
    }
    validateBackdropDag(scene);
  }
  if (reviewed === 0 || reviewed > limits.maxReviewedDecisions) {
    throw new Error(`Reviewed decision count must be in [1, ${limits.maxReviewedDecisions}]`);
  }
  return {schema: 'semantic-dark.paired-theme-scenes.v1', scenes};
}

function validateScene(value: unknown, index: number): SceneDefinition {
  const input = object(value, `scene[${index}]`);
  if (typeof input.id !== 'string' || typeof input.title !== 'string' ||
      typeof input.kind !== 'string' || !SCENE_KINDS.has(input.kind) ||
      !Array.isArray(input.paints) || !Array.isArray(input.surfacePairs)) {
    throw new Error(`Invalid scene at index ${index}`);
  }
  const sceneId = input.id;
  const paints = input.paints.map((paint, paintIndex) => validatePaint(paint, sceneId, paintIndex));
  const localIds = new Set(paints.map((paint) => paint.id));
  const localPairIds = new Set<string>();
  for (const pairValue of input.surfacePairs) {
    const pair = object(pairValue, `${input.id}.surfacePair`);
    if (typeof pair.id !== 'string' || pair.id.length === 0 ||
        typeof pair.lowerPaintId !== 'string' ||
        typeof pair.upperPaintId !== 'string' || !localIds.has(pair.lowerPaintId) ||
        !localIds.has(pair.upperPaintId) || pair.lowerPaintId === pair.upperPaintId) {
      throw new Error(`Invalid surface pair in scene ${input.id}`);
    }
    if (localPairIds.has(pair.id)) throw new Error(`Duplicate surface pair id: ${pair.id}`);
    localPairIds.add(pair.id);
  }
  return input as unknown as SceneDefinition;
}

function validatePaint(value: unknown, sceneId: string, index: number): PaintDecision {
  const input = object(value, `${sceneId}.paint[${index}]`);
  if (typeof input.id !== 'string' || typeof input.component !== 'string' ||
      typeof input.state !== 'string' || typeof input.property !== 'string' ||
      !PROPERTIES.has(input.property) || !PSEUDOS.has(input.pseudo) ||
      typeof input.role !== 'string' || !ROLES.has(input.role) ||
      typeof input.token !== 'string' || !TOKEN_NAMES.has(input.token) ||
      !(input.backdropPaintId === null || typeof input.backdropPaintId === 'string') ||
      typeof input.contrastKind !== 'string' || !CONTRAST_KINDS.has(input.contrastKind) ||
      typeof input.reviewed !== 'boolean') {
    throw new Error(`Invalid paint decision ${sceneId}[${index}]`);
  }
  return input as unknown as PaintDecision;
}

function validateBackdropDag(scene: SceneDefinition): void {
  const byId = new Map(scene.paints.map((paint) => [paint.id, paint]));
  for (const paint of scene.paints) {
    if (paint.backdropPaintId && !byId.has(paint.backdropPaintId)) {
      throw new Error(`Unknown backdrop ${paint.backdropPaintId} for ${paint.id}`);
    }
    const seen = new Set<string>([paint.id]);
    let current = paint;
    while (current.backdropPaintId) {
      if (seen.has(current.backdropPaintId)) {
        throw new Error(`Backdrop cycle in scene ${scene.id}: ${[...seen, current.backdropPaintId].join(' -> ')}`);
      }
      seen.add(current.backdropPaintId);
      current = byId.get(current.backdropPaintId)!;
    }
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function integer(value: unknown, label: string): number {
  const result = number(value, label);
  if (!Number.isInteger(result) || result <= 0) throw new TypeError(`${label} must be a positive integer`);
  return result;
}
