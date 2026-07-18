import {mkdir, open, readFile, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

import {serializeJson, sha256File} from '../artifacts';
import {
  validateFrozenMetricSpec,
  type FrozenMetricSpec,
} from './metric-freeze-validation';
import type {PairedThemeMetricConfig} from './types';

export {
  FROZEN_IMPLEMENTATION_PATHS,
  validateFrozenMetricSpec,
  type FrozenMetricSpec,
} from './metric-freeze-validation';

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const HELD_OUT_SYSTEMS = ['carbon', 'fluent'] as const;

export interface MetricPinVerification {
  m0ManifestSha256: string;
  sceneManifestSha256: string;
  roleProfilesSourceSha256: string;
  implementationFiles: number;
}

export interface LoadedFrozenMetricSpec {
  spec: FrozenMetricSpec;
  config: PairedThemeMetricConfig;
  path: string;
  sha256: string;
  pins: MetricPinVerification;
}

export interface M2ComponentScore {d: number; c: number; r: number; e: number}
export interface M2FailureCounts {f: number; h2: number; h3: number}
export interface M2SystemGateInput {
  system: 'carbon' | 'fluent';
  baseline: M2ComponentScore;
  candidate: M2ComponentScore;
  newOrWorsenedFailures: M2FailureCounts;
}
export interface M2SystemGateResult {
  system: 'carbon' | 'fluent';
  passed: boolean;
  relativeImprovement: number | null;
  conditions: {
    baselineNonZero: boolean;
    minimumImprovement: boolean;
    colorNonRegression: boolean;
    contrastNonRegression: boolean;
    rankNonRegression: boolean;
    zeroF: boolean;
    zeroH2: boolean;
    zeroH3: boolean;
  };
}
export interface M2GateResult {passed: boolean; systems: readonly M2SystemGateResult[]}

export interface ExposureReceipt {
  schema: 'semantic-dark.held-out-exposure-receipt.v1';
  metricSpecSha256: string;
  freezeCommit: string;
  systems: readonly ['carbon', 'fluent'];
  logicalEvaluation: 1;
  replicates: 2;
  status: 'claimed-consumes-exposure';
  failureConsumesExposure: true;
  createdAt: string;
  pid: number;
}
export interface ExposureReceiptOptions {
  directory?: string;
  now?: () => Date;
  pid?: number;
}
export interface ExposureClaim {path: string; receipt: ExposureReceipt}

/** Convert the rational frozen contract into the evaluator's runtime config. */
export function metricConfigFromFrozenSpec(value: unknown): PairedThemeMetricConfig {
  const spec = validateFrozenMetricSpec(value);
  const denominator = spec.primary.composite.weights.denominator;
  return {
    status: 'frozen-v1',
    deltaEOkCap: spec.primary.color.cap,
    contrastLog2Cap: spec.primary.contrast.cap,
    rankTieEpsilon: spec.primary.rank.tieEpsilon,
    comparisonEpsilon: spec.safety.comparisonEpsilon,
    accentChromaThreshold: spec.secondary.accentChromaThreshold,
    textContrastFloor: spec.safety.textContrastFloor,
    nonTextContrastFloor: spec.safety.nonTextContrastFloor,
    surfaceSeparationFloor: spec.safety.surfaceSeparationFloor,
    componentWeights: {
      color: spec.primary.composite.weights.color / denominator,
      contrast: spec.primary.composite.weights.contrast / denominator,
      rank: spec.primary.composite.weights.rank / denominator,
    },
  };
}

/** Load one content-addressed normative spec and verify every referenced input. */
export async function loadFrozenMetricSpecFile(
  filePathValue: string,
  expectedSha256: string,
  repoRoot: string,
): Promise<LoadedFrozenMetricSpec> {
  digest(expectedSha256, 'metric spec digest');
  const filePath = await insideRepo(await realpath(path.resolve(repoRoot)), filePathValue);
  await assertDigest(filePath, expectedSha256);
  const spec = validateFrozenMetricSpec(JSON.parse(await readFile(filePath, 'utf8')));
  const pins = await verifyFrozenMetricSpecFiles(spec, repoRoot);
  return {spec, config: metricConfigFromFrozenSpec(spec), path: filePath, sha256: expectedSha256, pins};
}

/** Verify every content-addressed input without touching held-out packages. */
export async function verifyFrozenMetricSpecFiles(
  value: unknown,
  repoRootValue: string,
): Promise<MetricPinVerification> {
  const spec = validateFrozenMetricSpec(value);
  const repoRoot = await realpath(path.resolve(repoRootValue));
  const m0Path = await insideRepo(repoRoot, spec.baseline.m0Manifest);
  const scenePath = await insideRepo(repoRoot, spec.records.sceneManifest);
  const rolePath = await insideRepo(repoRoot, spec.baseline.roleProfilesSource);

  await assertDigest(m0Path, spec.baseline.m0ManifestSha256);
  await assertDigest(scenePath, spec.records.sceneManifestSha256);
  await assertDigest(rolePath, spec.baseline.roleProfilesSourceSha256);
  const m0 = record(JSON.parse(await readFile(m0Path, 'utf8')), 'M0 manifest');
  equal(m0.schema, 'semantic-dark.m0-manifest.v1', 'M0 manifest schema');
  const scenes = record(JSON.parse(await readFile(scenePath, 'utf8')), 'scene manifest');
  equal(scenes.schema, 'semantic-dark.paired-theme-scenes.v1', 'scene manifest schema');
  const baseline = record(m0.baseline, 'M0 manifest.baseline');
  const profiles = record(m0.role_profiles, 'M0 manifest.role_profiles');
  equal(baseline.commit, spec.baseline.engineCommit, 'M0 engine commit');
  equal(profiles.source, spec.baseline.roleProfilesSource, 'M0 role profile source');
  equal(profiles.source_sha256, spec.baseline.roleProfilesSourceSha256, 'M0 role profile source digest');
  equal(profiles.canonical_sha256, spec.baseline.roleProfilesCanonicalSha256,
    'M0 role profile canonical digest');

  for (const pin of spec.implementationPins.files) {
    await assertDigest(await insideRepo(repoRoot, pin.path), pin.sha256);
  }
  return {
    m0ManifestSha256: spec.baseline.m0ManifestSha256,
    sceneManifestSha256: spec.records.sceneManifestSha256,
    roleProfilesSourceSha256: spec.baseline.roleProfilesSourceSha256,
    implementationFiles: spec.implementationPins.files.length,
  };
}

/** Evaluate the preregistered per-system M2 gate; no macro compensation exists. */
export function evaluateM2Gate(value: unknown, inputs: readonly M2SystemGateInput[]): M2GateResult {
  const spec = validateFrozenMetricSpec(value);
  if (!Array.isArray(inputs) || inputs.length !== HELD_OUT_SYSTEMS.length) {
    throw new Error('M2 gate requires exactly Carbon and Fluent');
  }
  const bySystem = new Map(inputs.map((item) => [item.system, item]));
  if (bySystem.size !== HELD_OUT_SYSTEMS.length ||
      HELD_OUT_SYSTEMS.some((system) => !bySystem.has(system))) {
    throw new Error('M2 gate requires one result each for Carbon and Fluent');
  }
  const systems = HELD_OUT_SYSTEMS.map((system) => gateSystem(spec, bySystem.get(system)!));
  return {passed: systems.every((result) => result.passed), systems};
}

export function assertM2Gate(value: unknown, inputs: readonly M2SystemGateInput[]): M2GateResult {
  const result = evaluateM2Gate(value, inputs);
  if (!result.passed) {
    const failed = result.systems.filter((item) => !item.passed).map((item) => item.system);
    throw new Error(`M2 gate failed for: ${failed.join(', ')}`);
  }
  return result;
}

/**
 * Claim the sole held-out exposure before adapters or packages are loaded.
 * `wx` makes concurrent/repeated claims fail. A later action failure never
 * removes this marker, so an attempted exposure remains consumed.
 */
export async function createHeldOutExposureReceipt(
  value: unknown,
  metricSpecSha256: string,
  freezeCommit: string,
  options: ExposureReceiptOptions = {},
): Promise<ExposureClaim> {
  const spec = validateFrozenMetricSpec(value);
  digest(metricSpecSha256, 'metric spec digest'); commit(freezeCommit, 'freeze commit');
  const directory = path.resolve(options.directory ?? path.join(
    homedir(), 'scratch-data/semantic-dark-pairs/.exposure',
  ));
  await mkdir(directory, {recursive: true});
  const receipt: ExposureReceipt = {
    schema: 'semantic-dark.held-out-exposure-receipt.v1', metricSpecSha256, freezeCommit,
    systems: [...HELD_OUT_SYSTEMS], logicalEvaluation: spec.heldOutAccessPolicy.logicalEvaluations,
    replicates: spec.heldOutAccessPolicy.replicatesPerLogicalEvaluation,
    status: 'claimed-consumes-exposure', failureConsumesExposure: true,
    createdAt: (options.now ?? (() => new Date()))().toISOString(), pid: options.pid ?? process.pid,
  };
  const receiptPath = path.join(directory, `${metricSpecSha256}.json`);
  const handle = await open(receiptPath, 'wx', 0o600);
  try {
    await handle.writeFile(serializeJson(receipt), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {path: receiptPath, receipt};
}

export async function withHeldOutExposureReceipt<T>(
  value: unknown,
  metricSpecSha256: string,
  freezeCommit: string,
  action: (claim: ExposureClaim) => Promise<T>,
  options: ExposureReceiptOptions = {},
): Promise<T> {
  const claim = await createHeldOutExposureReceipt(
    value, metricSpecSha256, freezeCommit, options,
  );
  return action(claim);
}

function gateSystem(spec: FrozenMetricSpec, input: M2SystemGateInput): M2SystemGateResult {
  if (!HELD_OUT_SYSTEMS.includes(input.system)) throw new Error(`unsupported M2 system: ${input.system}`);
  const tolerance = spec.m2Gate.componentNonRegressionTolerance;
  const baseline = score(input.baseline, `${input.system} baseline`, tolerance);
  const candidate = score(input.candidate, `${input.system} candidate`, tolerance);
  const failures = failureCounts(
    input.newOrWorsenedFailures, `${input.system} new or worsened failures`,
  );
  const baselineNonZero = baseline.e !== 0;
  const relativeImprovement = baselineNonZero ? (baseline.e - candidate.e) / baseline.e : null;
  const conditions = {
    baselineNonZero,
    minimumImprovement: relativeImprovement !== null && relativeImprovement + tolerance >=
      spec.m2Gate.minimumRelativeImprovementPerSystem,
    colorNonRegression: candidate.d <= baseline.d + tolerance,
    contrastNonRegression: candidate.c <= baseline.c + tolerance,
    rankNonRegression: candidate.r <= baseline.r + tolerance,
    zeroF: failures.f === 0, zeroH2: failures.h2 === 0, zeroH3: failures.h3 === 0,
  };
  return {system: input.system, passed: Object.values(conditions).every(Boolean),
    relativeImprovement, conditions};
}

function score(value: M2ComponentScore, label: string, epsilon: number): M2ComponentScore {
  const item = record(value, label) as unknown as M2ComponentScore;
  for (const key of ['d', 'c', 'r', 'e'] as const) unit(item[key], `${label}.${key}`);
  const composed = (item.d + item.c + item.r) / 3;
  if (Math.abs(composed - item.e) > epsilon) throw new Error(`${label}.e does not match frozen D/C/R weights`);
  return item;
}

function failureCounts(value: M2FailureCounts, label: string): M2FailureCounts {
  const item = record(value, label) as unknown as M2FailureCounts;
  for (const key of ['f', 'h2', 'h3'] as const) {
    if (!Number.isInteger(item[key]) || item[key] < 0) throw new Error(`${label}.${key} must be a nonnegative integer`);
  }
  return item;
}

async function insideRepo(repoRoot: string, relative: string): Promise<string> {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error(`pin must be repo-relative: ${relative}`);
  const candidate = await realpath(path.resolve(repoRoot, relative));
  if (candidate !== repoRoot && !candidate.startsWith(`${repoRoot}${path.sep}`)) throw new Error(`pin escapes repository: ${relative}`);
  return candidate;
}

async function assertDigest(filePath: string, expected: string): Promise<void> {
  const actual = await sha256File(filePath);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} does not match the frozen spec`);
}

function unit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be in [0, 1]`);
  return value;
}

function digest(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function commit(value: string, label: string): void {
  if (!COMMIT.test(value)) throw new Error(`${label} must be a 40-character lowercase commit`);
}
