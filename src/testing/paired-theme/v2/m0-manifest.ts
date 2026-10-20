import {readFile, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

import {BASELINE_ROLE_PROFILES_SEMANTIC_SHA256} from '../../../color/role-profiles';
import {BASELINE_ROLE_PROFILE_FILE_SHA256, loadBaselineRoleProfile} from '../profile-fixture';
import {verifyM0V2A3Evidence, type VerifiedM0V2A3Evidence} from './m0-a3-evidence';
import {verifyM0V2EvidencePair, type VerifiedM0V2Evidence} from './m0-evidence-loader';
import {
  discoverM0V2PinClosure,
  m0V2ImplementationPinSetSha256,
} from './m0-pin-closure';
import {
  assertM0V2CommitLineage,
  assertM0V2GitRoot,
  containedM0V2RepoFile,
  sha256,
  verifyM0V2GitBlob,
  verifyM0V2ImplementationPins,
  verifyM0V2RepositoryPin,
} from './m0-repository';
import {assertM0V2JsonSchema} from './m0-schema';
import {
  M0_V1_MANIFEST_PATH,
  M0_V1_MANIFEST_SHA256,
  M0_V2_BASELINE_PROFILE_PATH,
  M0_V2_ENGINE_INTERVENTION_COMMIT,
  M0_V2_MANIFEST_PATH,
  M0_V2_MANIFEST_SCHEMA_PATH,
  type M0V2Manifest,
} from './m0-types';
import {readM0V2EvaluatorCommit, validateM0V2Manifest} from './m0-validation';
import {SHA256_PATTERN} from './m0-validation-primitives';
import {verifyM0V1ProfileLineage, type M0V1ProfileLineage} from './m0-v1-lineage';

const DEFAULT_EVIDENCE_ROOT = path.join(
  homedir(), 'scratch-data', 'semantic-dark-pairs', 'logs', 'm0-v2',
);
const DEFAULT_A3_ROOT = path.join(
  homedir(), 'scratch-data', 'semantic-dark-pairs', 'probes', 'spectrum-1.12',
);

export interface LoadM0V2ManifestOptions {
  repoRoot: string;
  manifestPath: string;
  expectedSha256: string;
  evidenceRoot?: string;
  a3EvidenceRoot?: string;
}

/** Fixed-root seam intended for the eventually branded metric-spec baseline pin. */
export interface FixedM0V2ManifestPin {
  path: typeof M0_V2_MANIFEST_PATH;
  sha256: string;
}

export interface M0V2Provenance {
  repoRoot: string;
  manifest: {path: string; sha256: string};
  predecessor: {path: string; sha256: string; profile: M0V1ProfileLineage};
  baselineProfile: {path: string; fileSha256: string; semanticSha256: string};
  commits: M0V2Manifest['commits'];
  implementationPins: M0V2Manifest['implementationPins'];
  evidence: {verify: VerifiedM0V2Evidence; e2e: VerifiedM0V2Evidence};
  environment: M0V2Manifest['environment'];
  a3: VerifiedM0V2A3Evidence;
}

export interface LoadedM0V2Manifest {
  document: Readonly<M0V2Manifest>;
  provenance: Readonly<M0V2Provenance>;
}

const loadedManifests = new WeakSet<object>();

export async function loadFixedM0V2Manifest(
  repoRoot: string,
  pin: FixedM0V2ManifestPin,
): Promise<LoadedM0V2Manifest> {
  if (!pin || pin.path !== M0_V2_MANIFEST_PATH || !SHA256_PATTERN.test(pin.sha256)) {
    throw new TypeError('Frozen spec has an invalid fixed M0-v2 manifest pin');
  }
  return loadM0V2Manifest({repoRoot, manifestPath: M0_V2_MANIFEST_PATH,
    expectedSha256: pin.sha256});
}

/** Authenticate manifest bytes, historical values, implementation closure, and real completions. */
export async function loadM0V2Manifest(
  optionsValue: LoadM0V2ManifestOptions,
): Promise<LoadedM0V2Manifest> {
  const options = validateOptions(optionsValue);
  const repoRoot = await realpath(path.resolve(options.repoRoot));
  await assertM0V2GitRoot(repoRoot);
  const manifestPath = await containedM0V2RepoFile(repoRoot, options.manifestPath, 'manifest');
  if (slash(path.relative(repoRoot, manifestPath)) !== M0_V2_MANIFEST_PATH) {
    throw new Error(`M0-v2 manifest must be loaded from ${M0_V2_MANIFEST_PATH}`);
  }
  const manifestBytes = await readFile(manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  if (manifestSha256 !== options.expectedSha256) {
    throw new Error(`M0-v2 manifest SHA-256 mismatch: expected ${options.expectedSha256}, received ${manifestSha256}`);
  }
  const parsed = parseJson(manifestBytes, 'M0-v2 manifest');
  await assertM0V2JsonSchema(path.join(repoRoot, M0_V2_MANIFEST_SCHEMA_PATH),
    parsed, 'M0-v2 manifest');
  const evaluatorCommit = readM0V2EvaluatorCommit(parsed);
  const closure = await discoverM0V2PinClosure(repoRoot, evaluatorCommit);
  const document = validateM0V2Manifest(parsed, closure);
  await assertM0V2CommitLineage(repoRoot, document);

  const predecessorPath = await verifyPredecessor(repoRoot, document);
  const predecessorProfile = await verifyM0V1ProfileLineage(repoRoot, predecessorPath);
  const baselineProfile = await verifyBaselineProfile(repoRoot, document);
  const expectedPinSet = m0V2ImplementationPinSetSha256(
    document.implementationPins.files,
    document.implementationPins.evaluatorTreeSha1,
  );
  if (expectedPinSet !== document.implementationPins.pinSetSha256) {
    throw new Error('M0-v2 implementation pin-set SHA-256 mismatch');
  }
  await verifyM0V2ImplementationPins(repoRoot, document);

  const evidenceRoot = await realpath(path.resolve(expandHome(options.evidenceRoot)));
  const a3Root = await realpath(path.resolve(expandHome(options.a3EvidenceRoot)));
  const evidence = await verifyM0V2EvidencePair(repoRoot, evidenceRoot, document);
  const a3 = await verifyM0V2A3Evidence(a3Root, document);
  if (a3.chromeVersion !== evidence.e2e.completion.tools.chrome?.version) {
    throw new Error('M0-v2 A3 and e2e Chrome versions differ');
  }
  const result = deepFreeze({document, provenance: {
    repoRoot,
    manifest: {path: manifestPath, sha256: manifestSha256},
    predecessor: {path: predecessorPath, sha256: document.predecessor.sha256,
      profile: predecessorProfile},
    baselineProfile,
    commits: document.commits,
    implementationPins: document.implementationPins,
    evidence,
    environment: document.environment,
    a3,
  }}) as LoadedM0V2Manifest;
  loadedManifests.add(result);
  return result;
}

export function assertLoadedM0V2Manifest(value: LoadedM0V2Manifest): void {
  if (!loadedManifests.has(value)) {
    throw new Error('M0-v2 provenance must be loaded from externally pinned manifest bytes');
  }
}

async function verifyPredecessor(root: string, document: Readonly<M0V2Manifest>) {
  const predecessorPath = await verifyM0V2RepositoryPin(root, document.predecessor.path,
    document.predecessor.sha256, 'predecessor manifest');
  if (document.predecessor.path !== M0_V1_MANIFEST_PATH ||
      document.predecessor.sha256 !== M0_V1_MANIFEST_SHA256) {
    throw new Error('M0-v2 predecessor does not bind the historical v1 manifest');
  }
  for (const commit of [M0_V2_ENGINE_INTERVENTION_COMMIT, document.commits.evaluator]) {
    await verifyM0V2GitBlob(root, commit, document.predecessor.path,
      document.predecessor.sha256, `v1 predecessor at ${commit}`);
  }
  return predecessorPath;
}

async function verifyBaselineProfile(root: string, document: Readonly<M0V2Manifest>) {
  const resolvedPath = await verifyM0V2RepositoryPin(root, document.baselineProfile.path,
    document.baselineProfile.fileSha256, 'baseline profile');
  if (document.baselineProfile.path !== M0_V2_BASELINE_PROFILE_PATH ||
      document.baselineProfile.fileSha256 !== BASELINE_ROLE_PROFILE_FILE_SHA256 ||
      document.baselineProfile.semanticSha256 !== BASELINE_ROLE_PROFILES_SEMANTIC_SHA256) {
    throw new Error('M0-v2 baseline profile pins differ from the frozen baseline');
  }
  const loaded = await loadBaselineRoleProfile(root);
  for (const commit of [M0_V2_ENGINE_INTERVENTION_COMMIT, document.commits.evaluator]) {
    await verifyM0V2GitBlob(root, commit, document.baselineProfile.path,
      document.baselineProfile.fileSha256, `baseline profile at ${commit}`);
  }
  return {path: resolvedPath, fileSha256: loaded.fileSha256,
    semanticSha256: loaded.semanticSha256};
}

function validateOptions(value: LoadM0V2ManifestOptions) {
  const input = value as unknown as Record<string, unknown>;
  const allowed = ['repoRoot', 'manifestPath', 'expectedSha256', 'evidenceRoot', 'a3EvidenceRoot'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(input).some((key) => !allowed.includes(key)) ||
      !['repoRoot', 'manifestPath', 'expectedSha256'].every((key) => key in input) ||
      typeof value.repoRoot !== 'string' || !value.repoRoot ||
      typeof value.manifestPath !== 'string' || !value.manifestPath ||
      !SHA256_PATTERN.test(value.expectedSha256)) {
    throw new TypeError('M0-v2 load options are invalid');
  }
  for (const key of ['evidenceRoot', 'a3EvidenceRoot'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key])) {
      throw new TypeError(`M0-v2 ${key} must be non-empty`);
    }
  }
  return {...value, evidenceRoot: value.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT,
    a3EvidenceRoot: value.a3EvidenceRoot ?? DEFAULT_A3_ROOT};
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; } catch (error) {
    throw new Error(`${label} is not valid JSON`, {cause: error});
  }
}
function expandHome(value: string): string { return value.replace(/^~(?=$|\/)/, homedir()); }
function slash(value: string): string { return value.split(path.sep).join('/'); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
