import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import type {EvaluationSplit} from '../types';
import type {
  LoadV2MetricSpecOptions,
  V2DenominatorContract,
  V2MetricConfig,
  V2MetricSpecDocument,
  V2SystemRegistryEntry,
  V2VariantRoles,
} from './contract';
import {validateV2ConfirmationRegistry} from './confirmation';
import {validateV2HumanReviewSpec} from './spec-human-review';
import {validateV2RecordsSpec} from './spec-records';
import {validateV2TuningSpec} from './spec-tuning';
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]*$/;
const loadedSpecs = new WeakSet<object>();
declare const validatedV2MetricSpecBrand: unique symbol;
export type ValidatedV2MetricSpec = Readonly<{
  path: string;
  sha256: string;
  document: Readonly<V2MetricSpecDocument>;
  readonly [validatedV2MetricSpecBrand]: true;
}>;
export async function loadValidatedV2MetricSpec(
  optionsValue: LoadV2MetricSpecOptions,
): Promise<ValidatedV2MetricSpec> {
  const options = object(optionsValue, 'v2 metric-spec load options');
  exactKeys(options, ['repoRoot', 'specPath', 'expectedSha256'], 'v2 metric-spec load options');
  const expectedSha256 = digest(options.expectedSha256, 'expected metric-spec SHA-256');
  const repoRoot = await realpath(path.resolve(nonEmpty(options.repoRoot, 'repoRoot')));
  const specPath = await containedFile(repoRoot, nonEmpty(options.specPath, 'specPath'));
  const bytes = await readFile(specPath);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`V2 metric-spec SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`V2 metric-spec JSON is invalid: ${String(error)}`);
  }
  const document = validateDocument(parsed);
  await verifyRegistryFiles(repoRoot, document.registry.systems);
  const result = deepFreeze({path: specPath, sha256: actualSha256, document}) as
    unknown as ValidatedV2MetricSpec;
  loadedSpecs.add(result);
  return result;
}
export function assertValidatedV2MetricSpec(value: ValidatedV2MetricSpec): void {
  if (!loadedSpecs.has(value)) {
    throw new Error('V2 metric spec was not loaded from externally pinned bytes');
  }
}
function validateDocument(value: unknown): V2MetricSpecDocument {
  // Baseline, exposure, and implementation pins require their own authenticated validators.
  const input = object(value, 'v2 metric spec');
  exactKeys(input, ['$schema', 'schema', 'id', 'version', 'status', 'baseline', 'registry',
    'records', 'evaluationContract', 'humanReview', 'tuning', 'exposure',
    'implementationPins'], 'v2 metric spec');
  if (input.schema !== 'semantic-dark.paired-theme-metric-spec.v2' ||
      input.id !== 'semantic-dark.paired-theme-metric.v2' || input.version !== 2 ||
      input.status !== 'frozen') {
    throw new Error('V2 metric spec envelope is not the frozen v2 identity');
  }
  const registryInput = object(input.registry, 'registry');
  exactKeys(registryInput, ['systems', 'confirmation'], 'registry');
  const systems = validateSystems(registryInput.systems);
  const confirmation = validateV2ConfirmationRegistry(registryInput.confirmation, systems);
  const evaluationContract = validateEvaluation(input.evaluationContract, systems);
  const records = validateV2RecordsSpec(input.records, systems, evaluationContract.denominators);
  const humanReview = validateV2HumanReviewSpec(input.humanReview);
  const tuning = validateV2TuningSpec(
    input.tuning,
    systems,
    evaluationContract.componentNonRegressionTolerance,
  );
  return deepFreeze({
    $schema: nonEmpty(input.$schema, '$schema'), schema: input.schema, id: input.id,
    version: input.version, status: input.status,
    baseline: object(input.baseline, 'baseline'), registry: {systems, confirmation},
    records, evaluationContract, humanReview, tuning,
    exposure: object(input.exposure, 'exposure'),
    implementationPins: object(input.implementationPins, 'implementationPins'),
  });
}
function validateSystems(value: unknown): readonly V2SystemRegistryEntry[] {
  if (!Array.isArray(value)) throw new TypeError('registry.systems must be an array');
  const ids = new Set<string>();
  const protocolPaths = new Set<string>();
  let lastPurpose = 0;
  const systems = value.map((item, index) => {
    const input = object(item, `registry.systems[${index}]`);
    exactKeys(input, ['id', 'split', 'purpose', 'adapterId', 'protocolPath',
      'protocolSha256', 'sceneManifestPath', 'sceneManifestSha256'],
    `registry.systems[${index}]`);
    const id = identifier(input.id, `registry.systems[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate v2 system id: ${id}`);
    ids.add(id);
    const purpose = systemPurpose(input.purpose, id);
    const split = evaluationSplit(input.split, id);
    if ((purpose === 'development') !== (split === 'development')) {
      throw new Error(`V2 system split/purpose mismatch for ${id}`);
    }
    const purposeOrder = purpose === 'development' ? 0 : purpose === 'primary-holdout' ? 1 : 2;
    if (purposeOrder < lastPurpose) throw new Error('V2 registry purpose groups are out of order');
    lastPurpose = purposeOrder;
    const protocolPath = relativeFile(input.protocolPath, `${id}.protocolPath`);
    if (protocolPaths.has(protocolPath)) throw new Error(`Duplicate v2 protocol path: ${protocolPath}`);
    protocolPaths.add(protocolPath);
    return {
      id, split, purpose, adapterId: identifier(input.adapterId, `${id}.adapterId`),
      protocolPath, protocolSha256: digest(input.protocolSha256, `${id}.protocolSha256`),
      sceneManifestPath: relativeFile(input.sceneManifestPath, `${id}.sceneManifestPath`),
      sceneManifestSha256: digest(input.sceneManifestSha256, `${id}.sceneManifestSha256`),
    };
  });
  return systems;
}
function validateEvaluation(
  value: unknown,
  systems: readonly V2SystemRegistryEntry[],
): V2MetricSpecDocument['evaluationContract'] {
  const input = object(value, 'evaluationContract');
  exactKeys(input, ['variants', 'replicatesPerSystem', 'denominators', 'metric',
    'componentNonRegressionTolerance'], 'evaluationContract');
  const variants = validateVariants(input.variants);
  const denominators = validateDenominators(input.denominators);
  const activeSystems = systems.filter((entry) => entry.purpose !== 'reserve').length;
  if (denominators.reviewedSystems !== activeSystems ||
      denominators.totalReviewedRows !== activeSystems * denominators.perArm.reviewed) {
    throw new Error('V2 reviewed-row denominators do not match the active registry');
  }
  return {
    variants, replicatesPerSystem: exactNumber(input.replicatesPerSystem, 2,
      'evaluationContract.replicatesPerSystem'),
    denominators, metric: validateMetric(input.metric),
    componentNonRegressionTolerance: nonNegativeFinite(
      input.componentNonRegressionTolerance, 'componentNonRegressionTolerance'),
  };
}

function validateVariants(value: unknown): V2MetricSpecDocument['evaluationContract']['variants'] {
  const input = object(value, 'evaluationContract.variants');
  exactKeys(input, ['ordered', 'roles'], 'evaluationContract.variants');
  const rolesInput = object(input.roles, 'evaluationContract.variants.roles');
  exactKeys(rolesInput, ['light', 'authoredDark', 'baselineCandidate', 'm2Candidate'],
    'evaluationContract.variants.roles');
  const roles: V2VariantRoles = {
    light: identifier(rolesInput.light, 'roles.light'),
    authoredDark: identifier(rolesInput.authoredDark, 'roles.authoredDark'),
    baselineCandidate: identifier(rolesInput.baselineCandidate, 'roles.baselineCandidate'),
    m2Candidate: identifier(rolesInput.m2Candidate, 'roles.m2Candidate'),
  };
  const expected = ['light', 'authored-dark', 'baseline-candidate', 'm2-candidate'];
  if (!Array.isArray(input.ordered) || input.ordered.length !== expected.length ||
      input.ordered.some((item, index) => item !== expected[index]) ||
      Object.values(roles).some((item, index) => item !== expected[index])) {
    throw new Error('V2 variants must be the four frozen conditions in order');
  }
  return {ordered: expected, roles};
}
function validateDenominators(value: unknown): V2DenominatorContract {
  const input = object(value, 'evaluationContract.denominators');
  exactKeys(input, ['scenesPerSystem', 'paintsPerVariant',
    'rawObservationsPerSystemPerReplicate', 'rawObservationsPerSystemAcrossReplicates',
    'perArm', 'comparison', 'reviewedSystems', 'totalReviewedRows'],
  'evaluationContract.denominators');
  const perArm = exactNumberMap(input.perArm, {reviewed: 10, color: 10, contrast: 6, rank: 3}, 'perArm');
  const comparison = exactNumberMap(input.comparison, {color: 20, contrast: 12, rank: 6}, 'comparison');
  return {
    scenesPerSystem: exactNumber(input.scenesPerSystem, 4, 'scenesPerSystem'),
    paintsPerVariant: exactNumber(input.paintsPerVariant, 15, 'paintsPerVariant'),
    rawObservationsPerSystemPerReplicate: exactNumber(
      input.rawObservationsPerSystemPerReplicate, 60, 'rawObservationsPerSystemPerReplicate'),
    rawObservationsPerSystemAcrossReplicates: exactNumber(
      input.rawObservationsPerSystemAcrossReplicates, 120, 'rawObservationsPerSystemAcrossReplicates'),
    perArm, comparison,
    reviewedSystems: exactNumber(input.reviewedSystems, 7, 'reviewedSystems'),
    totalReviewedRows: exactNumber(input.totalReviewedRows, 70, 'totalReviewedRows'),
  };
}

function validateMetric(value: unknown): V2MetricConfig {
  const input = object(value, 'evaluationContract.metric');
  exactKeys(input, ['status', 'deltaEOkCap', 'contrastLog2Cap', 'rankTieEpsilon',
    'comparisonEpsilon', 'accentChromaThreshold', 'textContrastFloor',
    'nonTextContrastFloor', 'surfaceSeparationFloor', 'componentWeights'],
  'evaluationContract.metric');
  if (input.status !== 'frozen-v2') throw new Error('V2 metric config must be frozen-v2');
  return {
    status: input.status,
    deltaEOkCap: exactNumber(input.deltaEOkCap, 0.1, 'metric.deltaEOkCap'),
    contrastLog2Cap: exactNumber(input.contrastLog2Cap, 1, 'metric.contrastLog2Cap'),
    rankTieEpsilon: exactNumber(input.rankTieEpsilon, 0.01, 'metric.rankTieEpsilon'),
    comparisonEpsilon: exactNumber(input.comparisonEpsilon, 0, 'metric.comparisonEpsilon'),
    accentChromaThreshold: exactNumber(input.accentChromaThreshold, 0.02, 'metric.accentChromaThreshold'),
    textContrastFloor: exactNumber(input.textContrastFloor, 4.5, 'metric.textContrastFloor'),
    nonTextContrastFloor: exactNumber(input.nonTextContrastFloor, 3, 'metric.nonTextContrastFloor'),
    surfaceSeparationFloor: exactNumber(input.surfaceSeparationFloor, 1.12, 'metric.surfaceSeparationFloor'),
    componentWeights: exactNumberMap(input.componentWeights,
      {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3}, 'metric.componentWeights'),
  };
}

async function verifyRegistryFiles(root: string, systems: readonly V2SystemRegistryEntry[]) {
  for (const system of systems) {
    await verifyFile(root, system.protocolPath, system.protocolSha256, `${system.id} protocol`);
    await verifyFile(root, system.sceneManifestPath, system.sceneManifestSha256,
      `${system.id} scene manifest`);
  }
}

async function verifyFile(root: string, relative: string, expected: string, label: string) {
  const file = await containedFile(root, relative);
  const actual = sha256(await readFile(file));
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch`);
}
async function containedFile(root: string, relative: string): Promise<string> {
  const candidate = await realpath(path.resolve(root, relativeFile(relative, 'file path')));
  const fromRoot = path.relative(root, candidate);
  if (fromRoot === '' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error(`Path escapes repository root: ${relative}`);
  }
  return candidate;
}
function relativeFile(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  if (path.isAbsolute(result) || result.includes('\\') ||
      path.posix.normalize(result) !== result || result.split('/').includes('..')) {
    throw new Error(`${label} must be a normalized repository-relative contained path`);
  }
  return result;
}
function exactNumberMap<T extends Record<string, number>>(
  value: unknown, expected: T, label: string,
): T {
  const input = object(value, label);
  exactKeys(input, Object.keys(expected), label);
  return Object.fromEntries(Object.entries(expected).map(([key, wanted]) =>
    [key, exactNumber(input[key], wanted, `${label}.${key}`)])) as T;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    throw new Error(`${label} has an unexpected shape`);
  }
}
function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be non-empty`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  if (!IDENTIFIER.test(result)) throw new TypeError(`${label} must be a lowercase identifier`);
  return result;
}
function digest(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  if (!SHA256.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}
function exactNumber(value: unknown, expected: number, label: string): number {
  if (value !== expected) throw new Error(`${label} must equal ${expected}`);
  return expected;
}
function nonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be finite and non-negative`);
  }
  return value;
}
function evaluationSplit(value: unknown, id: string): EvaluationSplit {
  if (value !== 'development' && value !== 'held-out') throw new Error(`Invalid split for ${id}`);
  return value;
}
function systemPurpose(value: unknown, id: string): V2SystemRegistryEntry['purpose'] {
  if (value !== 'development' && value !== 'primary-holdout' && value !== 'reserve') {
    throw new Error(`Invalid purpose for ${id}`);
  }
  return value;
}
function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
