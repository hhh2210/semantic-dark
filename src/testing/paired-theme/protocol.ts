import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadFrozenMetricSpecFile, type FrozenMetricSpec} from './metric-freeze';
import {NORMALIZED_TOKEN_NAMES, type PaintDecision, type PairedThemeMetricConfig, type PairedThemeProtocol, type SceneDefinition, type SceneManifest} from './types';
import {validateProtocolSource} from './protocol-source';

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
  metricSpecPath: string;
  metricSpecSha256: string;
  metricSpec: FrozenMetricSpec;
  metric: PairedThemeMetricConfig;
}

export async function loadPairedThemeProtocol(
  protocolValue: string,
  repoRootValue = process.cwd(),
): Promise<LoadedPairedThemeProtocol> {
  const protocolPath = path.resolve(protocolValue);
  const protocol = validateProtocol(JSON.parse(await readFile(protocolPath, 'utf8')));
  const protocolDirectory = path.dirname(protocolPath);
  const sceneManifestPath = resolveSceneManifestPath(protocolPath, protocol.sceneManifest);
  const scenes = validateSceneManifest(
    JSON.parse(await readFile(sceneManifestPath, 'utf8')),
    protocol.limits,
  );
  const metricSpecPath = path.resolve(protocolDirectory, protocol.metricSpec.path);
  const repoRoot = path.resolve(repoRootValue);
  const frozen = await loadFrozenMetricSpecFile(
    path.relative(repoRoot, metricSpecPath), protocol.metricSpec.sha256, repoRoot,
  );
  if (frozen.spec.id !== protocol.metricSpec.id) throw new Error('Metric spec id mismatch');
  return {protocol, scenes, protocolPath, sceneManifestPath, metricSpecPath,
    metricSpecSha256: frozen.sha256, metricSpec: frozen.spec, metric: frozen.config};
}

export function resolveSceneManifestPath(protocolPath: string, sceneManifest: string): string {
  const protocolDirectory = path.dirname(path.resolve(protocolPath));
  const sceneManifestPath = path.resolve(protocolDirectory, sceneManifest);
  if (sceneManifestPath === protocolDirectory ||
      !sceneManifestPath.startsWith(`${protocolDirectory}${path.sep}`)) {
    throw new Error('Scene manifest must stay inside the protocol directory');
  }
  return sceneManifestPath;
}

export function validateProtocol(value: unknown): PairedThemeProtocol {
  const input = object(value, 'protocol');
  exactKeys(input, ['schema', 'id', 'split', 'source', 'sceneManifest', 'viewport', 'locale',
    'colorProfile', 'limits', 'metricSpec'], 'protocol');
  if (input.schema !== 'semantic-dark.paired-theme-protocol.v1') {
    throw new Error('Unsupported paired-theme protocol schema');
  }
  if (input.split !== 'development' && input.split !== 'held-out') {
    throw new Error('Paired-theme split must be development or held-out');
  }
  validateProtocolSource(input.source);
  const source = object(input.source, 'protocol.source');
  const development = source.system === 'material' || source.system === 'primer' ||
    source.system === 'spectrum';
  if ((input.split === 'development') !== development) {
    throw new Error(`Source ${String(source.system)} does not belong to split ${input.split}`);
  }
  const viewport = object(input.viewport, 'protocol.viewport');
  const limits = object(input.limits, 'protocol.limits');
  const metricSpec = object(input.metricSpec, 'protocol.metricSpec');
  exactKeys(metricSpec, ['id', 'path', 'sha256'], 'protocol.metricSpec');
  if (metricSpec.id !== 'semantic-dark.paired-theme-metric.v1' ||
      metricSpec.path !== '../evaluation/metric-spec.v1.json' ||
      typeof metricSpec.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(metricSpec.sha256)) {
    throw new Error('Protocol metric spec reference differs from the frozen contract');
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

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
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
